// Outbound email. MAIL_MODE: "outbox" (local development: stored in dev_outbox),
// "cloudflare" (Cloudflare Email Service binding SEND_EMAIL), or "http" (any provider with a JSON send endpoint).
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, run } from "./db";

export type Mail = { to: string; subject: string; text: string; replyTo?: string };

export async function sendMail(env: Env, m: Mail): Promise<"sent" | "suppressed" | "dry_run"> {
  const sup = await one(env, "SELECT email FROM suppression WHERE email = ?", m.to.toLowerCase());
  if (sup) return "suppressed";
  const mode = env.MAIL_MODE || "outbox";
  if (mode === "outbox") {
    await run(env, "INSERT INTO dev_outbox (id, to_addr, subject, body, at) VALUES (?,?,?,?,?)", newId("mail"), m.to, m.subject, m.text, nowIso());
    return "sent";
  }
  if (env.SENDS_LIVE !== "true") return "dry_run";
  if (mode === "cloudflare") {
    // Cloudflare Email Service binding. Confirm the binding's current call shape when enabling.
    await env.SEND_EMAIL.send({ to: m.to, from: env.MAIL_FROM, subject: m.subject, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
    return "sent";
  }
  const res = await fetch(env.MAIL_HTTP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.MAIL_HTTP_KEY },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
  return "sent";
}
