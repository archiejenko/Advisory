// Inbound email: "check@" requests. Only users of a workspace get a reply; everyone else is ignored.
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, run, audit } from "./db";
import { checkInput } from "./truth";
import { sendMail } from "./mail";
import { wakeOnEvent } from "./agents";
import PostalMime from "postal-mime";

/** Pull the request out of a message: the subject, else the first non-empty body line. */
export function requestFrom(subject: string, text: string): string {
  const s = subject.replace(/^(re|fwd?|fw):\s*/gi, "").replace(/^check\s*/i, "").trim();
  if (s.length >= 3) return s;
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith(">"));
  return (line || "").slice(0, 300);
}

const MAX_RAW = 5 * 1024 * 1024;

/** Decode an HTML-only message into readable text. */
export function htmlToText(html: string) {
  return html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/ ?\n\s*/g, "\n").trim();
}

/** Parse a raw message (MIME: multipart, base64, quoted-printable, HTML) into its subject and plain text. */
export async function parseMessage(raw: ArrayBuffer | string): Promise<{ subject: string; text: string }> {
  const m = await PostalMime.parse(raw);
  const text = (m.text && m.text.trim()) || (m.html ? htmlToText(m.html) : "");
  return { subject: m.subject || "", text: text.replace(/\r\n/g, "\n").trim() };
}

export function briefText(env: Env, b: any): string {
  if (b.status !== "matched") {
    return [`We couldn't match "${b.input}" to one company.`, b.message, "", ...(b.candidates || []).map((c: any) => `${c.name} (${c.number}), ${c.status}`), "", "Reply with the company number to get the brief."].join("\n");
  }
  return [
    `New-client brief: ${b.match.name} (${b.match.number})`, "",
    b.flags.length ? `Flags to review: ${b.flags.map((f: any) => f.text).join("; ")}.` : "Flags: none. Active, filings up to date, no insolvency notices.", "",
    ...b.rows.map(([k, v, n]: [string, string, number]) => `${k}: ${v} [${n}]`), "",
    "[1] Companies House  [2] The Gazette  [3] FCA register",
    `Checked ${b.checked_at}. Response ${b.response_id}, signed.`,
  ].join("\n");
}

export async function onEmail(message: ForwardableEmailMessage, env: Env) {
  const from = (message.from || "").toLowerCase();
  // Mail to <alias>@INBOUND_DOMAIN is a business's enquiries inbox: store it and wake its inbox agent.
  const local = (message.to || "").toLowerCase().split("@")[0];
  const org = local && local !== "check" ? await one<any>(env, "SELECT id FROM org WHERE inbox_alias = ?", local) : null;
  if (message.rawSize > MAX_RAW) { message.setReject?.("Message too large"); return; }
  if (org) {
    const parsed = await parseMessage(await new Response(message.raw).arrayBuffer());
    const subject = parsed.subject || message.headers.get("subject") || "";
    const body = parsed.text;
    const id = newId("msg");
    await run(env, "INSERT INTO inbox_message (id, org_id, from_addr, subject, body, received_at) VALUES (?,?,?,?,?,?)", id, org.id, from, subject.slice(0, 300), body.slice(0, 20000), nowIso());
    // A reply from someone we emailed marks that lead as replied.
    await run(env, "UPDATE lead SET status = 'replied' WHERE org_id = ? AND email = ? AND status IN ('new','contacted')", org.id, from);
    if (/^\s*(stop|unsubscribe)\b/i.test(body)) {
      await run(env, "INSERT OR IGNORE INTO suppression (email, reason, at) VALUES (?,?,?)", from, "reply_stop", nowIso());
      await run(env, "UPDATE lead SET status = 'unsubscribed' WHERE org_id = ? AND email = ?", org.id, from);
    }
    await wakeOnEvent(env, org.id, "inbox", `New message from ${from}: ${subject}`);
    return;
  }
  const user = await one<any>(env, "SELECT u.id, u.email, m.org_id FROM user u JOIN membership m ON m.user_id = u.id WHERE u.email = ? LIMIT 1", from);
  if (!user) return; // not a customer: drop silently, never reply to strangers
  const parsed = await parseMessage(await new Response(message.raw).arrayBuffer());
  const input = requestFrom(parsed.subject || message.headers.get("subject") || "", parsed.text);
  if (input.length < 2) return;
  const b: any = await checkInput(env, input);
  await run(env, "INSERT INTO brief (id, org_id, input, number, body, response_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    newId("brf"), user.org_id, input, b.match?.number ?? null, JSON.stringify(b), b.response_id, user.id, nowIso());
  await run(env, "INSERT INTO usage_event (id, org_id, kind, number, units, cost_pence, payment, at) VALUES (?,?,?,?,1,0,'internal',?)", newId("use"), user.org_id, "brief", b.match?.number ?? null, nowIso());
  await audit(env, user.org_id, user.id, "brief_by_email", b.response_id);
  await sendMail(env, { to: user.email, subject: `Brief: ${b.match?.name || input}`, text: briefText(env, b) });
}
