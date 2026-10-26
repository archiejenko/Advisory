// The AI Team (Floor) screens were built against the older in-memory demo API (demo.js, floorDemo.js). This keeps
// that API's agents, leads, invoices, inbox and drafts in step with the workspace store, so the Floor shows the same
// six agents and the same records as every other screen, and approving on the Floor approves in the store.
import { getState, approve, reject } from "./store";

const TPL = { agt_sales: "outreach", agt_cs: "inbox", agt_credit: "credit-control", agt_ops: "bookings", agt_fin: "bookkeeping", agt_brief: "briefing" };
const BY_TEMPLATE = {
  outreach: "agt_sales", "lead-finder": "agt_sales", research: "agt_sales", social: "agt_sales",
  inbox: "agt_cs", reviews: "agt_cs", "credit-control": "agt_credit", "customer-watch": "agt_credit", "customer-check": "agt_credit",
  briefing: "agt_brief", orchestrator: "agt_brief", bookkeeping: "agt_fin", bookings: "agt_ops",
};
/** Which of the six agents does a role on a Floor blueprint. Extra roles become that agent's sub-agents. */
export function staffFor(bp) {
  if (BY_TEMPLATE[bp.template]) return BY_TEMPLATE[bp.template];
  const t = `${bp.key} ${bp.name} ${bp.role || ""}`.toLowerCase();
  if (/prospect|lead|sales|outreach|quote|proposal/.test(t)) return "agt_sales";
  if (/inbox|enquir|support|review|complain|customer service/.test(t)) return "agt_cs";
  if (/credit|chase|debt|overdue|receiv/.test(t)) return "agt_credit";
  if (/book|ledger|bill|cash|financ|vat|payroll|invoice/.test(t)) return "agt_fin";
  if (/rota|shift|job|site|stock|schedul|operat|crew/.test(t)) return "agt_ops";
  if (/brief|orchestr|report|manager/.test(t)) return "agt_brief";
  return "agt_sales";
}

export function syncFromStore(s) {
  const st = getState();
  // Agents: the same six, keeping whatever the Floor has attached to them.
  const keep = new Map((s.agents || []).map((a) => [a.id, a]));
  s.agents = st.agents.map((a) => Object.assign(keep.get(a.id) || { settings: {}, monthly_cap: 300, engine: "llm", category: "Run", glyph: "spark", created_at: st.now, run_hour: 8 }, {
    id: a.id, template: TPL[a.id], name: a.name, brief: a.description, status: st.paused ? "paused" : "running", rhythm: a.id === "agt_brief" ? "weekly" : "weekdays",
    autonomy: a.autonomy.every((r) => r.mode === "auto") ? "auto" : "approve_first",
    // Credits: the mode each agent runs in. Theo reads every enquiry closely, so he's on Deep.
    engine: "llm", mode: a.mode || "standard", monthly_budget: a.monthlyBudget ?? null,
  }));
  const co = (id) => st.companies.find((c) => c.id === id);
  const replied = new Set(st.conversations.filter((c) => c.origin === "reply" && c.messages.some((m) => m.direction === "in")).map((c) => c.companyId));
  const emailed = new Set(st.conversations.filter((c) => c.messages.some((m) => m.direction === "out")).map((c) => c.companyId));
  const recentWin = new Set(st.deals.filter((d) => d.stage === "won" && d.value > 0 && Date.parse(d.updatedAt) > Date.parse(st.now) - 30 * 86400e3).map((d) => d.companyId));
  s.leads = st.companies.filter((c) => c.status !== "customer" || recentWin.has(c.id)).map((c) => ({
    id: c.id, agent_id: "agt_sales", company: c.name, number: null, email: c.email, contact_name: null, website: c.website, notes: c.notes, created_at: c.createdAt,
    status: c.status === "lost" ? "lost" : recentWin.has(c.id) ? "won" : replied.has(c.id) ? "replied" : emailed.has(c.id) ? "contacted" : "new",
    last_contact_at: null, emails_sent: emailed.has(c.id) ? 1 : 0,
  }));
  const now = Date.parse(st.now);
  s.invoices = st.invoices.filter((i) => i.status !== "draft" && (i.status !== "paid" || Date.parse(i.paidAt) > now - 14 * 86400e3)).map((i) => {
    const r = i.chaseLog.filter((c) => c.kind === "reminder");
    return { id: i.id, ref: i.id, customer: co(i.companyId).name, email: co(i.companyId).email, amount_pence: i.total, due_date: i.dueAt.slice(0, 10), status: i.status === "paid" ? "paid" : "unpaid",
      reminders: r.length, last_reminder_at: r.at(-1)?.at || null, created_at: i.issuedAt, days_overdue: Math.round((now - Date.parse(i.dueAt)) / 86400e3) };
  });
  s.inbox = st.conversations.filter((c) => !c.id.startsWith("cv_h")).map((c) => ({
    id: c.id, from_addr: c.messages[0].from, subject: c.subject, body: c.messages.at(-1).body, summary: c.subject, urgency: c.status === "new" ? "high" : "normal", category: c.origin,
    status: c.status === "new" ? "new" : c.status === "open" ? "triaged" : "replied", received_at: c.messages[0].at,
  }));
  s.actions = st.approvals.filter((a) => a.status !== "pending" ? Date.parse(a.decidedAt || a.createdAt) > now - 7 * 86400e3 : true).map((a) => ({
    id: a.id, agent_id: a.agentId, run_id: null, title: a.title, reason: a.reason, created_at: a.createdAt, decided_at: a.decidedAt,
    status: a.status === "pending" ? "proposed" : a.status === "rejected" ? "rejected" : "sent",
    payload: a.preview.kind === "email" ? { to: a.preview.to, subject: a.preview.subject, body: a.preview.body } : a.preview.kind === "message" ? { to: a.preview.channel, subject: a.title, body: a.preview.body } : { to: "", subject: a.preview.summary, body: a.preview.detail },
  }));
}

/** Decisions made on the Floor go through the store, so they reach every screen and can be undone. */
export function decideInStore(id, how, edits) {
  const a = getState().approvals.find((x) => x.id === id);
  if (!a) return false;
  if (how === "approve") approve(id, edits && a.preview.kind === "email" ? { preview: { ...a.preview, ...edits } } : undefined);
  else reject(id);
  return true;
}
