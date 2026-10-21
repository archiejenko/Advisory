// Actions that reach the outside world. Agents propose; the owner approves; we send.
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, run, audit } from "./db";
import { HttpError } from "./http";
import { sendMail } from "./mail";

export type EmailPayload = { to: string; subject: string; body: string; lead_id?: string; invoice_id?: string; message_id?: string };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

/** Create an email action. Sends straight away only when the agent's autonomy allows it. */
export async function proposeEmail(env: Env, ctx: { orgId: string; agentId: string; runId?: string }, p: EmailPayload & { reason?: string }) {
  const to = String(p.to || "").trim().toLowerCase();
  if (!EMAIL.test(to)) throw new HttpError(400, "invalid_email", "That isn't a valid email address. Never guess one: save the lead without an email and create a task instead.");
  if (!p.subject?.trim() || !p.body?.trim()) throw new HttpError(400, "invalid_email", "An email needs a subject and a body.");
  if (await one(env, "SELECT email FROM suppression WHERE email = ?", to)) throw new HttpError(409, "suppressed", `${to} has asked not to be contacted. Don't email them.`);
  const agent = await one<any>(env, "SELECT * FROM agent WHERE id = ? AND org_id = ?", ctx.agentId, ctx.orgId);
  if (!agent) throw new HttpError(404, "not_found", "Agent not found.");
  const payload: EmailPayload = { to, subject: p.subject.trim().slice(0, 200), body: p.body.trim().slice(0, 5000), ...(p.lead_id ? { lead_id: p.lead_id } : {}), ...(p.invoice_id ? { invoice_id: p.invoice_id } : {}), ...(p.message_id ? { message_id: p.message_id } : {}) };
  // Check the references belong to this business
  if (payload.lead_id && !(await one(env, "SELECT id FROM lead WHERE id = ? AND org_id = ?", payload.lead_id, ctx.orgId))) throw new HttpError(404, "not_found", "No lead with that id.");
  if (payload.invoice_id && !(await one(env, "SELECT id FROM invoice WHERE id = ? AND org_id = ?", payload.invoice_id, ctx.orgId))) throw new HttpError(404, "not_found", "No invoice with that id.");
  if (payload.message_id && !(await one(env, "SELECT id FROM inbox_message WHERE id = ? AND org_id = ?", payload.message_id, ctx.orgId))) throw new HttpError(404, "not_found", "No message with that id.");
  const id = newId("act");
  await run(env, "INSERT INTO agent_action (id, org_id, agent_id, run_id, kind, title, payload, reason, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, ctx.orgId, ctx.agentId, ctx.runId ?? null, "email", `Email ${to}: ${payload.subject}`, JSON.stringify(payload), p.reason?.slice(0, 500) ?? null, "proposed", nowIso());
  if (await mayAutoSend(env, agent, payload)) {
    const r = await executeAction(env, ctx.orgId, id, "agent");
    return { action_id: id, status: r.status };
  }
  return { action_id: id, status: "waiting_for_approval" };
}

/** approve_first: follow-ups and second reminders go on their own once the first was approved. */
async function mayAutoSend(env: Env, agent: any, p: EmailPayload) {
  if (agent.autonomy === "auto") return true;
  if (agent.autonomy !== "approve_first") return false;
  if (p.invoice_id) return !!(await one(env, "SELECT id FROM invoice WHERE id = ? AND reminders >= 1", p.invoice_id));
  if (p.lead_id) return !!(await one(env, "SELECT id FROM agent_action WHERE org_id = ? AND status = 'sent' AND json_extract(payload, '$.lead_id') = ?", agent.org_id, p.lead_id));
  return false;
}

/** Send an approved action, once. */
export async function executeAction(env: Env, orgId: string, actionId: string, decidedBy: string, edits?: { subject?: string; body?: string }) {
  const a = await one<any>(env, "SELECT * FROM agent_action WHERE id = ? AND org_id = ?", actionId, orgId);
  if (!a) throw new HttpError(404, "not_found", "Action not found.");
  if (a.status !== "proposed") throw new HttpError(409, "already_decided", `This action was already ${a.status}.`);
  const p: EmailPayload = { ...JSON.parse(a.payload), ...(edits?.subject ? { subject: edits.subject } : {}), ...(edits?.body ? { body: edits.body } : {}) };
  // Claim it first so a double click can't send twice
  const claim = await run(env, "UPDATE agent_action SET status = 'sent', decided_by = ?, decided_at = ?, payload = ? WHERE id = ? AND status = 'proposed'", decidedBy, nowIso(), JSON.stringify(p), actionId);
  if (!claim.meta.changes) throw new HttpError(409, "already_decided", "This action was already decided.");
  const org = await one<any>(env, "SELECT name FROM org WHERE id = ?", orgId);
  const owner = await one<any>(env, "SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1", orgId);
  const footer = p.lead_id
    ? `\n\n--\n${org.name}\nIf you'd rather not hear from us, reply STOP or unsubscribe here: ${env.APP_URL}#/unsubscribe?e=${encodeURIComponent(p.to)}`
    : "";
  let result: string;
  try {
    result = await sendMail(env, { to: p.to, subject: p.subject, text: p.body + footer, replyTo: owner?.email });
  } catch (e: any) {
    await run(env, "UPDATE agent_action SET status = 'failed', result = ? WHERE id = ?", String(e.message).slice(0, 300), actionId);
    throw new HttpError(502, "send_failed", "The email didn't send: " + e.message);
  }
  if (result === "suppressed") {
    await run(env, "UPDATE agent_action SET status = 'failed', result = 'suppressed' WHERE id = ?", actionId);
    return { status: "failed", result };
  }
  await run(env, "UPDATE agent_action SET result = ? WHERE id = ?", result, actionId);
  if (p.lead_id) await run(env, "UPDATE lead SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, last_contact_at = ? WHERE id = ? AND org_id = ?", nowIso(), p.lead_id, orgId);
  if (p.invoice_id) await run(env, "UPDATE invoice SET reminders = reminders + 1, last_reminder_at = ? WHERE id = ? AND org_id = ?", nowIso(), p.invoice_id, orgId);
  if (p.message_id) await run(env, "UPDATE inbox_message SET status = 'replied' WHERE id = ? AND org_id = ?", p.message_id, orgId);
  await audit(env, orgId, decidedBy, "action_sent", actionId, { to: p.to });
  return { status: "sent", result };
}

export async function rejectAction(env: Env, orgId: string, actionId: string, decidedBy: string) {
  const r = await run(env, "UPDATE agent_action SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ? AND org_id = ? AND status = 'proposed'", decidedBy, nowIso(), actionId, orgId);
  if (!r.meta.changes) throw new HttpError(409, "already_decided", "This action was already decided.");
  await audit(env, orgId, decidedBy, "action_rejected", actionId);
}
