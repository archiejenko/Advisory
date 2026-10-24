// Actions that reach the outside world. Agents propose; the owner approves; we send.
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, run, audit } from "./db";
import { HttpError } from "./http";
import { sendMail } from "./mail";
import { emitForAgent } from "./swarm";
import { logActivity, leadForEmail } from "./crm";
import { loadOs } from "./osbuilder";
import { effectiveAutonomy, templateAutonomy, moduleSetting, type OsConfig, type Autonomy } from "../../../../packages/core/osconfig";
import { modulesFor } from "../../../../packages/core/os";

/** For an OS role agent: the most permissive autonomy among the modules it keeps that are run here. */
function osRoleAutonomy(os: OsConfig, agent: any): Autonomy | undefined {
  if (agent.template !== "os") return undefined;
  let role = ""; try { role = JSON.parse(agent.settings || "{}").role || ""; } catch {}
  const rank = { suggest: 0, approve: 1, auto: 2 } as const;
  let best: Autonomy = "suggest";
  for (const f of modulesFor(role)) { const s = moduleSetting(os, f.key); if (s?.mode === "here" && rank[s.autonomy] > rank[best]) best = s.autonomy; }
  return best;
}

export type EmailPayload = { to: string; subject: string; body: string; lead_id?: string; invoice_id?: string; message_id?: string; handover?: boolean };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

/** Create an email action. Sends straight away only when the agent's autonomy allows it. */
export async function proposeEmail(env: Env, ctx: { orgId: string; agentId: string; runId?: string }, p: EmailPayload & { reason?: string }) {
  const to = String(p.to || "").trim().toLowerCase();
  if (!EMAIL.test(to)) throw new HttpError(400, "invalid_email", "That isn't a valid email address. Never guess one: save the lead without an email and create a task instead.");
  if (!p.subject?.trim() || !p.body?.trim()) throw new HttpError(400, "invalid_email", "An email needs a subject and a body.");
  if (await one(env, "SELECT email FROM suppression WHERE email = ?", to)) throw new HttpError(409, "suppressed", `${to} has asked not to be contacted. Don't email them.`);
  const agent = await one<any>(env, "SELECT * FROM agent WHERE id = ? AND org_id = ?", ctx.agentId, ctx.orgId);
  if (!agent) throw new HttpError(404, "not_found", "Agent not found.");
  const payload: EmailPayload = { to, subject: p.subject.trim().slice(0, 200), body: p.body.trim().slice(0, 5000), ...(p.lead_id ? { lead_id: p.lead_id } : {}), ...(p.invoice_id ? { invoice_id: p.invoice_id } : {}), ...(p.message_id ? { message_id: p.message_id } : {}), ...(p.handover ? { handover: true } : {}) };
  // Check the references belong to this business
  if (payload.lead_id && !(await one(env, "SELECT id FROM lead WHERE id = ? AND org_id = ?", payload.lead_id, ctx.orgId))) throw new HttpError(404, "not_found", "No lead with that id.");
  if (payload.invoice_id && !(await one(env, "SELECT id FROM invoice WHERE id = ? AND org_id = ?", payload.invoice_id, ctx.orgId))) throw new HttpError(404, "not_found", "No invoice with that id.");
  if (payload.message_id && !(await one(env, "SELECT id FROM inbox_message WHERE id = ? AND org_id = ?", payload.message_id, ctx.orgId))) throw new HttpError(404, "not_found", "No message with that id.");
  const id = newId("act");
  await run(env, "INSERT INTO agent_action (id, org_id, agent_id, run_id, kind, title, payload, reason, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, ctx.orgId, ctx.agentId, ctx.runId ?? null, "email", `Email ${to}: ${payload.subject}`, JSON.stringify(payload), p.reason?.slice(0, 500) ?? null, "proposed", nowIso());
  await emitForAgent(env, ctx.agentId, { runId: ctx.runId, kind: "proposed", summary: `${agent.name} drafted an email to ${to}`, detail: { action_id: id } });
  const auto = await mayAutoSend(env, agent, payload, ctx.runId);
  if (auto === true) {
    const r = await executeAction(env, ctx.orgId, id, "agent");
    return { action_id: id, status: r.status };
  }
  return { action_id: id, status: "waiting_for_approval", ...(auto ? { note: auto } : {}) };
}

/**
 * Is `to` the person this email is about? Agents read text from strangers (inbound mail, web pages), so an
 * instruction hidden there could ask for mail to any address. Without a person approving it, an email only
 * goes to an address already tied to the record it names: the lead's own email (for a lead that existed
 * before this run, so a lead saved from an injected page doesn't count), the invoice's customer email, or
 * the sender of the inbox message being answered.
 */
export async function boundRecipient(env: Env, orgId: string, p: EmailPayload, runId?: string) {
  const to = p.to.toLowerCase();
  if (p.message_id) {
    const m = await one<any>(env, "SELECT from_addr FROM inbox_message WHERE id = ? AND org_id = ?", p.message_id, orgId);
    if (m && String(m.from_addr).toLowerCase() === to) return true;
  }
  if (p.invoice_id) {
    const i = await one<any>(env, "SELECT email FROM invoice WHERE id = ? AND org_id = ?", p.invoice_id, orgId);
    if (i?.email && String(i.email).toLowerCase() === to) return true;
  }
  if (p.lead_id) {
    const l = await one<any>(env, "SELECT email, created_at FROM lead WHERE id = ? AND org_id = ?", p.lead_id, orgId);
    if (l?.email && String(l.email).toLowerCase() === to) {
      if (!runId) return true;
      const r = await one<any>(env, "SELECT COALESCE(started_at, created_at) AS t FROM agent_run WHERE id = ?", runId);
      if (!r || l.created_at < r.t) return true;
    }
  }
  return false;
}

const HELD = "Held for the owner's approval: emails only go out on their own to the lead, customer or sender this email is about.";

/** auto: send when the recipient is bound. approve_first: follow-ups and second reminders go on their own once the first was approved. */
async function mayAutoSend(env: Env, agent: any, p: EmailPayload, runId?: string): Promise<true | string | null> {
  if (p.handover) return "Handovers to a provider always wait for a person to approve them.";
  const os = await loadOs(env, agent.org_id);
  if (os?.ai_paused) return "The AI Team is paused: this waits for a person.";
  const level = effectiveAutonomy(agent.autonomy, os ? templateAutonomy(os, agent.template) ?? osRoleAutonomy(os, agent) : undefined);
  if (level !== agent.autonomy) return "Held by Your OS: this app is set to approve before anything leaves the business.";
  if (agent.autonomy !== "auto" && agent.autonomy !== "approve_first") return null;
  if (!(await boundRecipient(env, agent.org_id, p, runId))) return HELD;
  if (agent.autonomy === "auto") return true;
  if (p.invoice_id && (await one(env, "SELECT id FROM invoice WHERE id = ? AND org_id = ? AND reminders >= 1", p.invoice_id, agent.org_id))) return true;
  if (p.lead_id && (await one(env, "SELECT id FROM agent_action WHERE org_id = ? AND status = 'sent' AND json_extract(payload, '$.lead_id') = ? AND json_extract(payload, '$.to') = ?", agent.org_id, p.lead_id, p.to))) return true;
  return null;
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
  await emitForAgent(env, a.agent_id, { kind: "sent", summary: `Email sent to ${p.to}: ${p.subject}`, detail: { action_id: actionId, by: decidedBy } });
  const leadId = p.lead_id || (await leadForEmail(env, orgId, p.to));
  if (leadId) {
    const ag = await one<any>(env, "SELECT name FROM agent WHERE id = ?", a.agent_id);
    await logActivity(env, { orgId, leadId, agentId: a.agent_id, actor: decidedBy === "agent" ? ag?.name || "Agent" : decidedBy, kind: "email", summary: `Email sent to ${p.to}: ${p.subject}`, refKind: "action", refId: actionId });
  }
  return { status: "sent", result };
}

export async function rejectAction(env: Env, orgId: string, actionId: string, decidedBy: string) {
  const r = await run(env, "UPDATE agent_action SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ? AND org_id = ? AND status = 'proposed'", decidedBy, nowIso(), actionId, orgId);
  if (!r.meta.changes) throw new HttpError(409, "already_decided", "This action was already decided.");
  await audit(env, orgId, decidedBy, "action_rejected", actionId);
}
