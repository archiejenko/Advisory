// The business core's CRM: a company is a lead row; contacts, deals and one activity timeline hang off it.
// Agents and people write to the same records, and every write that matters lands on the timeline.
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, all, run } from "./db";
import { HttpError } from "./http";

export type ActivityKind = "note" | "email" | "reply" | "call" | "stage" | "payment" | "lead" | "deal" | "won";

/** Add a line to a company's timeline. Never throws: the timeline must not break the work it records. */
export async function logActivity(env: Env, a: { orgId: string; leadId?: string | null; dealId?: string | null; contactId?: string | null; agentId?: string | null; actor: string; kind: ActivityKind; summary: string; refKind?: string; refId?: string }) {
  try {
    await run(env, "INSERT INTO activity (id, org_id, lead_id, deal_id, contact_id, agent_id, actor, kind, summary, ref_kind, ref_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      newId("atv"), a.orgId, a.leadId ?? null, a.dealId ?? null, a.contactId ?? null, a.agentId ?? null, a.actor.slice(0, 120), a.kind, a.summary.slice(0, 500), a.refKind ?? null, a.refId ?? null, nowIso());
  } catch (e) { console.error("activity not logged", e); }
}

/** The company (lead) an email address belongs to, through the lead itself or one of its contacts. */
export async function leadForEmail(env: Env, orgId: string, email: string): Promise<string | null> {
  const e = email.toLowerCase();
  const l = await one<any>(env, "SELECT id FROM lead WHERE org_id = ? AND lower(email) = ? LIMIT 1", orgId, e);
  if (l) return l.id;
  const c = await one<any>(env, "SELECT lead_id FROM contact WHERE org_id = ? AND lower(email) = ? AND lead_id IS NOT NULL LIMIT 1", orgId, e);
  return c?.lead_id ?? null;
}

export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

export async function saveContact(env: Env, orgId: string, c: { lead_id?: string | null; name: string; role?: string | null; email?: string | null; phone?: string | null; source?: string | null }, by: { actor: string; agentId?: string | null }) {
  const name = String(c.name || "").trim().slice(0, 120);
  if (!name) throw new HttpError(400, "invalid_request", "A contact needs a name.");
  const email = c.email ? String(c.email).trim().toLowerCase().slice(0, 200) : null;
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, "invalid_email", "That isn't a valid email address.");
  if (c.lead_id && !(await one(env, "SELECT id FROM lead WHERE id = ? AND org_id = ?", c.lead_id, orgId))) throw new HttpError(404, "not_found", "No company with that id.");
  const existing = await one<any>(env, "SELECT id FROM contact WHERE org_id = ? AND COALESCE(lead_id, '') = COALESCE(?, '') AND lower(name) = lower(?)", orgId, c.lead_id ?? null, name);
  if (existing) {
    await run(env, "UPDATE contact SET role = COALESCE(?, role), email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ? AND org_id = ?",
      c.role?.slice(0, 120) ?? null, email, c.phone?.slice(0, 40) ?? null, existing.id, orgId);
    return { contact_id: existing.id, created: false };
  }
  const id = newId("con");
  await run(env, "INSERT INTO contact (id, org_id, lead_id, name, role, email, phone, source, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id, orgId, c.lead_id ?? null, name, c.role?.slice(0, 120) ?? null, email, c.phone?.slice(0, 40) ?? null, c.source?.slice(0, 40) ?? null, by.actor, nowIso());
  if (c.lead_id) await logActivity(env, { orgId, leadId: c.lead_id, contactId: id, agentId: by.agentId, actor: by.actor, kind: "note", summary: `Contact added: ${name}${c.role ? `, ${c.role}` : ""}` });
  return { contact_id: id, created: true };
}

/** Create or move a deal. Winning a deal marks its company as won. */
export async function saveDeal(env: Env, orgId: string, d: { deal_id?: string; lead_id?: string | null; contact_id?: string | null; title?: string; value_pence?: number; stage?: string; status?: "open" | "won" | "lost"; expected_close?: string | null }, by: { actor: string; agentId?: string | null }) {
  const now = nowIso();
  if (d.lead_id && !(await one(env, "SELECT id FROM lead WHERE id = ? AND org_id = ?", d.lead_id, orgId))) throw new HttpError(404, "not_found", "No company with that id.");
  if (d.contact_id && !(await one(env, "SELECT id FROM contact WHERE id = ? AND org_id = ?", d.contact_id, orgId))) throw new HttpError(404, "not_found", "No contact with that id.");
  if (d.value_pence !== undefined && (!Number.isInteger(d.value_pence) || d.value_pence < 0 || d.value_pence > 1e11)) throw new HttpError(400, "invalid_request", "Give the value in whole pence.");
  const close = d.expected_close && /^\d{4}-\d{2}-\d{2}$/.test(d.expected_close) ? d.expected_close : null;
  let id = d.deal_id;
  let before: any = null;
  if (id) {
    before = await one<any>(env, "SELECT * FROM deal WHERE id = ? AND org_id = ?", id, orgId);
    if (!before) throw new HttpError(404, "not_found", "No deal with that id.");
    await run(env, "UPDATE deal SET title = COALESCE(?, title), value_pence = COALESCE(?, value_pence), stage = COALESCE(?, stage), status = COALESCE(?, status), contact_id = COALESCE(?, contact_id), expected_close = COALESCE(?, expected_close), updated_at = ? WHERE id = ? AND org_id = ?",
      d.title?.slice(0, 200) ?? null, d.value_pence ?? null, d.stage?.slice(0, 40) ?? null, d.status ?? null, d.contact_id ?? null, close, now, id, orgId);
  } else {
    const title = String(d.title || "").trim().slice(0, 200);
    if (!title) throw new HttpError(400, "invalid_request", "A new deal needs a title.");
    id = newId("deal");
    await run(env, "INSERT INTO deal (id, org_id, lead_id, contact_id, title, value_pence, stage, status, agent_id, expected_close, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id, orgId, d.lead_id ?? null, d.contact_id ?? null, title, d.value_pence ?? 0, d.stage?.slice(0, 40) || "open", d.status || "open", by.agentId ?? null, close, now, now);
  }
  const after = await one<any>(env, "SELECT * FROM deal WHERE id = ?", id);
  const leadId = after.lead_id;
  const money = (p: number) => "£" + (p / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 });
  if (!before) await logActivity(env, { orgId, leadId, dealId: id, agentId: by.agentId, actor: by.actor, kind: "deal", summary: `Deal opened: ${after.title}, ${money(after.value_pence)}` });
  else if (before.status !== after.status || before.stage !== after.stage) await logActivity(env, { orgId, leadId, dealId: id, agentId: by.agentId, actor: by.actor, kind: after.status === "won" ? "won" : "stage", summary: `${after.title}: ${after.status === "open" ? after.stage : after.status}` });
  if (after.status === "won" && before?.status !== "won" && leadId) await run(env, "UPDATE lead SET status = 'won' WHERE id = ? AND org_id = ?", leadId, orgId);
  return { deal_id: id, status: after.status, stage: after.stage };
}

/** One company with everything about it, for the Floor's company view. */
export async function companyView(env: Env, orgId: string, leadId: string) {
  const lead = await one<any>(env, "SELECT * FROM lead WHERE id = ? AND org_id = ?", leadId, orgId);
  if (!lead) throw new HttpError(404, "not_found", "Company not found.");
  const [contacts, deals, timeline, emails] = await Promise.all([
    all<any>(env, "SELECT id, name, role, email, phone, source, created_at FROM contact WHERE org_id = ? AND lead_id = ? ORDER BY created_at", orgId, leadId),
    all<any>(env, "SELECT id, title, value_pence, stage, status, expected_close, updated_at FROM deal WHERE org_id = ? AND lead_id = ? ORDER BY updated_at DESC", orgId, leadId),
    all<any>(env, "SELECT a.kind, a.summary, a.actor, a.at, g.name AS agent FROM activity a LEFT JOIN agent g ON g.id = a.agent_id WHERE a.org_id = ? AND a.lead_id = ? ORDER BY a.at DESC LIMIT 100", orgId, leadId),
    all<any>(env, "SELECT id, title, status, created_at FROM agent_action WHERE org_id = ? AND json_extract(payload, '$.lead_id') = ? ORDER BY created_at DESC LIMIT 20", orgId, leadId),
  ]);
  return { company: lead, contacts, deals, timeline, emails };
}

export async function companies(env: Env, orgId: string, q?: string) {
  return all<any>(env, `SELECT l.id, l.company, l.number, l.email, l.website, l.status, l.created_at, l.last_contact_at,
      (SELECT COUNT(*) FROM contact c WHERE c.org_id = l.org_id AND c.lead_id = l.id) AS contacts,
      (SELECT COALESCE(SUM(value_pence), 0) FROM deal d WHERE d.org_id = l.org_id AND d.lead_id = l.id AND d.status = 'open') AS open_pence,
      (SELECT MAX(at) FROM activity a WHERE a.org_id = l.org_id AND a.lead_id = l.id) AS last_activity_at
    FROM lead l WHERE l.org_id = ? ${q ? "AND l.company LIKE ?" : ""} ORDER BY COALESCE(last_activity_at, l.created_at) DESC LIMIT 300`, orgId, ...(q ? [`%${q.slice(0, 60)}%`] : []));
}
