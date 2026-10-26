// Outbound email. MAIL_MODE: "outbox" (local development: stored in dev_outbox),
// "cloudflare" (Cloudflare Email Service binding SEND_EMAIL), or "http" (any provider with a JSON send endpoint).
import { newId, nowIso } from "../../../../packages/core/util";
import { fetchT } from "./fetch";
import { type Env, one, run } from "./db";

/**
 * "transactional": mail a person asked for or must get (sign-in links, invites, receipts, their own briefs, the
 * operator's alerts). It always sends, and the outreach suppression list doesn't apply to it.
 * "outbound" (the default): mail an agent or an alert sends on a business's behalf. It is held while SENDS_LIVE
 * isn't "true", and never goes to a suppressed address.
 * "service": an agent's email that isn't marketing (an invoice reminder, a reply to someone who wrote in). Held like
 * outbound mail, but an outreach opt-out doesn't stop it.
 */
export type MailKind = "transactional" | "outbound" | "service";
export type Mail = { to: string; subject: string; text: string; replyTo?: string; kind?: MailKind };

export async function sendMail(env: Env, m: Mail): Promise<"sent" | "suppressed" | "dry_run"> {
  const transactional = m.kind === "transactional";
  if (!transactional && m.kind !== "service" && (await one(env, "SELECT email FROM suppression WHERE email = ?", m.to.toLowerCase()))) return "suppressed";
  const mode = env.MAIL_MODE || "outbox";
  if (mode === "outbox") {
    await run(env, "INSERT INTO dev_outbox (id, to_addr, subject, body, at) VALUES (?,?,?,?,?)", newId("mail"), m.to, m.subject, m.text, nowIso());
    return "sent";
  }
  if (!transactional && env.SENDS_LIVE !== "true") return "dry_run";
  if (mode === "cloudflare") {
    // Cloudflare Email Service binding. Confirm the binding's current call shape when enabling.
    await env.SEND_EMAIL.send({ to: m.to, from: env.MAIL_FROM, subject: m.subject, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
    return "sent";
  }
  const res = await fetchT(env.MAIL_HTTP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.MAIL_HTTP_KEY },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
  return "sent";
}
