// Structured logs: one JSON line per event, so Workers Logs can filter by event, org, run or job, and the operator
// hears about failures that would otherwise only sit in a log.
import type { Env } from "./db";
import { hit } from "./limits";
import { sendMail } from "./mail";

export function logError(event: string, fields: Record<string, unknown>, err?: unknown) {
  const e = err as any;
  console.error(JSON.stringify({ level: "error", event, ...fields, ...(err !== undefined ? { error: String(e?.message ?? e).slice(0, 500), stack: typeof e?.stack === "string" ? e.stack.split("\n").slice(0, 6).join("\n") : undefined } : {}), at: new Date().toISOString() }));
}

/** Email the operator about a kind of failure, at most once an hour per kind. Never throws. */
export async function alertOperator(env: Env, kind: string, subject: string, text: string) {
  try {
    if (!env.OPERATOR_EMAIL || !(await hit(env, "op_alert", kind, 1))) return;
    await sendMail(env, { kind: "transactional", to: env.OPERATOR_EMAIL, subject, text: `${text}\n\nSee Workers Logs for event "${kind}". This alert is sent at most once an hour.` });
  } catch (e) { console.error("operator alert failed", kind, e); }
}
