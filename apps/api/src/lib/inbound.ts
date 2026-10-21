// Inbound email: "check@" requests. Only users of a workspace get a reply; everyone else is ignored.
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, run, audit } from "./db";
import { checkInput } from "./truth";
import { sendMail } from "./mail";
import { wakeOnEvent } from "./agents";

/** Pull the request out of a message: the subject, else the first non-empty body line. */
export function requestFrom(subject: string, text: string): string {
  const s = subject.replace(/^(re|fwd?|fw):\s*/gi, "").replace(/^check\s*/i, "").trim();
  if (s.length >= 3) return s;
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith(">"));
  return (line || "").slice(0, 300);
}

function plainBody(raw: string): string {
  const i = raw.search(/\r?\n\r?\n/);
  return i >= 0 ? raw.slice(i).trim() : raw;
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
  if (org) {
    const raw = await new Response(message.raw).text();
    const subject = message.headers.get("subject") || "";
    const id = newId("msg");
    await run(env, "INSERT INTO inbox_message (id, org_id, from_addr, subject, body, received_at) VALUES (?,?,?,?,?,?)", id, org.id, from, subject.slice(0, 300), plainBody(raw).slice(0, 20000), nowIso());
    // A reply from someone we emailed marks that lead as replied.
    await run(env, "UPDATE lead SET status = 'replied' WHERE org_id = ? AND email = ? AND status IN ('new','contacted')", org.id, from);
    if (/^\s*(stop|unsubscribe)\b/i.test(plainBody(raw))) {
      await run(env, "INSERT OR IGNORE INTO suppression (email, reason, at) VALUES (?,?,?)", from, "reply_stop", nowIso());
      await run(env, "UPDATE lead SET status = 'unsubscribed' WHERE org_id = ? AND email = ?", org.id, from);
    }
    await wakeOnEvent(env, org.id, "inbox", `New message from ${from}: ${subject}`);
    return;
  }
  const user = await one<any>(env, "SELECT u.id, u.email, m.org_id FROM user u JOIN membership m ON m.user_id = u.id WHERE u.email = ? LIMIT 1", from);
  if (!user) return; // not a customer: drop silently, never reply to strangers
  const raw = await new Response(message.raw).text();
  const input = requestFrom(message.headers.get("subject") || "", plainBody(raw));
  if (input.length < 2) return;
  const b: any = await checkInput(env, input);
  await run(env, "INSERT INTO brief (id, org_id, input, number, body, response_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    newId("brf"), user.org_id, input, b.match?.number ?? null, JSON.stringify(b), b.response_id, user.id, nowIso());
  await run(env, "INSERT INTO usage_event (id, org_id, kind, number, units, cost_pence, payment, at) VALUES (?,?,?,?,1,0,'internal',?)", newId("use"), user.org_id, "brief", b.match?.number ?? null, nowIso());
  await audit(env, user.org_id, user.id, "brief_by_email", b.response_id);
  await sendMail(env, { to: user.email, subject: `Brief: ${b.match?.name || input}`, text: briefText(env, b) });
}
