// The demo Floor: a simulated swarm for Brightwork Cleaning, answered from memory. Each poll moves the simulation
// on a step: agents pick up work, call tools, hand cards on and draft emails for the desk. Approving an email in the
// demo moves its lead, exactly as it would for real, because cards take their stage from the record.
import { PRESETS, preset, stageFor, nearestPreset, estimateActions, KPIS, withOrchestrator } from "../../../packages/core/swarms.ts";
import { isPass } from "./pass.js";
import { applyOrgChanges, defaultBadges, toolsFor, role as roleOf } from "../../../packages/core/badges.ts";
import { PLANS } from "../../../packages/core/templates.ts";
import { staffFor } from "./workspace/demo/legacy.js";

const SIM = { swarms: [], seq: 1000 };
const now = () => new Date().toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const NEW_COMPANIES = [
  ["Deansgate Physio Ltd", "hello@deansgatephysio.example"], ["Spinningfields Law LLP", "office@spinningfieldslaw.example"], ["Ancoats Dental Studio Ltd", null],
  ["Chorlton Architects Ltd", "studio@chorltonarch.example"], ["Salford Optometry Ltd", "eyes@salfordopto.example"], ["Castlefield Co-Work Ltd", null],
  ["Piccadilly Pensions Ltd", "admin@piccpensions.example"], ["Hulme Vets Ltd", "reception@hulmevets.example"],
];
const TOOLS = {
  prospector: ["find-companies", "company-research", "read-page", "save-lead", "save-contact"],
  outreach: ["list-leads", "read-page", "propose-email", "log-activity"],
  inbox: ["list-inbox", "triage-message", "propose-email", "update-deal"],
  briefing: ["recent-activity", "notify-owner"],
  credit: ["list-invoices", "propose-email", "log-activity"],
  watch: ["uk-check"],
  orchestrator: ["list-team", "check-tasks", "assign-task"],
};

function agentFor(s, a) {
  // Every role on a Floor is done by one of the business's six agents; extra roles are that agent's sub-agents.
  let ag = s.agents.find((x) => x.id === staffFor(a));
  if (!ag) {
    ag = { id: "agt_" + a.key + "_" + (SIM.seq++), template: a.template, name: a.name, status: "running", rhythm: a.rhythm, autonomy: "approve_all", created_at: now(), engine: "llm", glyph: "spark", category: "Run", settings: {}, monthly_cap: 300, brief: a.role };
    s.agents.push(ag);
  }
  ag.swarm_id = "set";
  if (!(ag.swarm_keys || []).includes(a.key)) ag.swarm_keys = [...(ag.swarm_keys || []), a.key];
  ag.swarm_key = ag.swarm_keys[0]; ag.role = ag.swarm_keys.length > 1 ? `${ag.role}; ${a.role.toLowerCase()}` : a.role;
  return ag;
}

// Brightwork's own team on the Floor: the six agents, and the stages their work moves through.
const BRIGHTWORK = { blueprint: {
  name: "Brightwork team", sector: "Commercial cleaning", goals: ["Win more office contracts", "Get paid on time", "Answer every enquiry within the hour"],
  agents: [
    { key: "orchestrator", name: "Bea", role: "Briefing: writes the weekly briefing and hands out work", template: "orchestrator", rhythm: "weekdays" },
    { key: "outreach", name: "Maya", role: "Sales: finds leads, writes first emails and follows up quotes", template: "outreach", rhythm: "weekdays" },
    { key: "inbox", name: "Theo", role: "Customer service: reads every enquiry and drafts the reply", template: "inbox", rhythm: "on_event" },
    { key: "credit", name: "Rosa", role: "Credit control: chases every invoice until it's paid", template: "credit-control", rhythm: "weekdays" },
    { key: "finance", name: "Fern", role: "Finance: raises invoices, records bills, keeps the cash forecast", template: "bookkeeping", rhythm: "weekdays" },
    { key: "ops", name: "Owen", role: "Operations: jobs, the rota and supplies", template: "bookings", rhythm: "weekdays" },
  ],
  stages: [
    { key: "found", name: "Found", group: "Sales", agent: "outreach", rule: { source: "lead", status: ["new"] } },
    { key: "contacted", name: "Contacted", group: "Sales", agent: "outreach", rule: { source: "lead", status: ["contacted"] } },
    { key: "replied", name: "Replied", group: "Sales", agent: "inbox", rule: { source: "lead", status: ["replied"] } },
    { key: "won", name: "Won", group: "Sales", agent: "ops", rule: { source: "lead", status: ["won"] }, done: true },
    { key: "due", name: "Due", group: "Cash", agent: "finance", rule: { source: "invoice", state: ["due"] } },
    { key: "overdue", name: "Overdue", group: "Cash", agent: "credit", rule: { source: "invoice", state: ["overdue", "disputed"] } },
    { key: "reminded", name: "Reminded", group: "Cash", agent: "credit", rule: { source: "invoice", state: ["reminded"] } },
    { key: "paid", name: "Paid", group: "Cash", agent: "finance", rule: { source: "invoice", state: ["paid"] }, done: true },
    { key: "new", name: "New", group: "Inbox", agent: "inbox", rule: { source: "message", status: ["new"] } },
    { key: "triaged", name: "Being answered", group: "Inbox", agent: "inbox", rule: { source: "message", status: ["triaged"] } },
    { key: "answered", name: "Answered", group: "Inbox", agent: "inbox", rule: { source: "message", status: ["replied"] }, done: true },
  ],
  handoffs: [{ from: "outreach", to: "inbox", when: "A lead replies" }, { from: "inbox", to: "ops", when: "A customer signs" }, { from: "finance", to: "credit", when: "An invoice goes overdue" }],
  kpis: ["new_leads_week", "replies_week", "overdue_pence", "inbox_waiting"], skin: "floor", needs: [],
} };

function createSwarm(s, key, name) {
  const p = key === "brightwork" ? BRIGHTWORK : preset(key);
  const bp = withOrchestrator(JSON.parse(JSON.stringify(p.blueprint)));
  const sw = { id: "swm_demo" + (SIM.seq++), name: name || bp.name, preset: key, bp, status: "running", created_at: now(), events: [], stages: {}, sim: {}, last_brief_at: null, tasks: [] };
  for (const x of s.agents) { x.swarm_keys = []; x.role = undefined; }
  const staffed = new Map();
  for (const a of bp.agents) { const ag = agentFor(s, a); staffed.set(ag.id, ag); }
  sw.agents = [...staffed.values()].map((ag) => ({ ...ag, swarm_keys: [...ag.swarm_keys], swarm_id: sw.id }));
  for (const a of sw.agents) { const real = s.agents.find((x) => x.id === a.id); if (real) real.swarm_id = sw.id; }
  const root = sw.agents.find((a) => a.template === "orchestrator");
  for (const a of sw.agents) {
    const b = defaultBadges({ template: a.template, tools: bp.agents.find((x) => x.key === a.swarm_key)?.tools || [], engine: a.template === "customer-watch" ? "watch" : "llm" });
    Object.assign(a, { badge_role: b.role, skills: b.skills, reports_to: a === root ? null : root?.id || null, locked: a.template === "customer-watch" });
  }
  const by = (k) => agentOf(sw, k);
  const task = (k, title, status, from, mins) => by(k) && sw.tasks.push({ id: "tsk_d" + (SIM.seq++), agent_id: by(k).id, assigned_by: from === "You" ? "owner" : root?.id, from, title, status, result: status === "done" ? "Done: drafted and sent for approval." : null, created_at: ago(mins * 60000), updated_at: ago(mins * 60000) });
  task("prospector", "Find law firms in M2", "doing", root?.name || "Orchestrator", 20);
  task("outreach", "Follow up Peel Street Accountants", "todo", root?.name || "Orchestrator", 35);
  task("inbox", "Reply to the quote request from Salford Quays Media", "done", "You", 90);
  task("credit", "Chase INV-1047", "doing", root?.name || "Orchestrator", 15);
  if (!bp.goals.length) bp.goals = ["Get paid on time"];
  SIM.swarms.unshift(sw);
  event(sw, { kind: "created", summary: `${sw.name} spun up with ${sw.agents.length} agents` });
  derive(s, sw, true);
  return sw;
}

function event(sw, e) { sw.events.push({ id: ++SIM.seq, at: now(), detail: null, agent_id: null, item_id: null, ...e }); if (sw.events.length > 200) sw.events.shift(); }
const agentOf = (sw, key) => sw.agents.find((a) => a.swarm_key === key || (a.swarm_keys || []).includes(key));

/** Cards from the records, like the server's sync: a changed record moves its card and becomes an event. */
function derive(s, sw, quiet) {
  const items = [];
  const kinds = new Set(sw.bp.stages.map((x) => x.rule?.source).filter(Boolean));
  const src = { lead: kinds.has("lead") ? s.leads : [], invoice: kinds.has("invoice") ? s.invoices : [], message: kinds.has("message") ? s.inbox : [] };
  for (const [kind, recs] of Object.entries(src)) {
    for (const r of recs) {
      const st = stageFor(sw.bp.stages, kind, r);
      const key = kind + ":" + r.id;
      if (!st) { delete sw.stages[key]; continue; }
      const owner = agentOf(sw, st.agent);
      const title = kind === "lead" ? r.company : kind === "invoice" ? `${r.customer} · ${r.ref}` : r.subject || r.from_addr;
      const prev = sw.stages[key];
      if (prev && prev.stage !== st.key && !quiet) {
        const from = sw.bp.stages.find((x) => x.key === prev.stage);
        event(sw, { kind: "moved", agent_id: owner?.id, item_id: "wi_" + key, summary: `${title}: ${from?.name || prev.stage} to ${st.name}`, detail: { from_stage: prev.stage, to_stage: st.key, from_agent: prev.agent, to_agent: owner?.id } });
      }
      if (!prev || prev.stage !== st.key) sw.stages[key] = { stage: st.key, agent: owner?.id, at: prev ? now() : r.created_at || r.received_at || ago(86400000) };
      items.push({ id: "wi_" + key, agent_id: sw.stages[key].agent, stage: st.key, title, status: st.done ? "done" : "open", value_pence: kind === "invoice" ? r.amount_pence : null, ref_kind: kind, ref_id: r.id, note: null, updated_at: sw.stages[key].at });
    }
  }
  if (quiet && items.length) event(sw, { kind: "created", summary: `Loaded ${items.length} cards from your records` });
  return items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

/** One step of the simulation. */
function tick(s, sw) {
  if (sw.status !== "running") return;
  const llm = sw.agents.filter((a) => (TOOLS[a.swarm_key] || a.template === "custom") && a.status !== "paused");
  for (const a of llm) {
    const sim = (sw.sim[a.id] ||= { state: "idle", left: 0 });
    if (sim.state === "working") {
      sim.left--;
      if (sim.left > 0) {
        const tool = pick(TOOLS[a.swarm_key] || ["read-page"]);
        sim.tool = tool; sim.toolAt = Date.now();
        event(sw, { kind: "tool", agent_id: a.id, summary: tool });
      } else { sim.state = "idle"; finish(s, sw, a); }
    } else if (Math.random() < 0.22) {
      sim.state = "working"; sim.left = 2 + Math.floor(Math.random() * 3);
      event(sw, { kind: "run_started", agent_id: a.id, summary: `${a.name} started` });
    }
  }
}

function finish(s, sw, a) {
  const k = a.swarm_key;
  const mine = (sw.tasks || []).find((t) => t.agent_id === a.id && t.status === "doing");
  if (mine) { mine.status = "done"; mine.result = "Done."; mine.updated_at = now(); event(sw, { kind: "task_done", agent_id: a.id, summary: `${a.name} finished: ${mine.title}` }); }
  if (a.template === "orchestrator") {
    const free = sw.agents.filter((x) => x !== a && !x.locked && x.status !== "paused" && !sw.tasks.some((t) => t.agent_id === x.id && ["todo", "doing"].includes(t.status)));
    const to = pick(free.length ? free : [null]);
    if (!to) return event(sw, { kind: "run_done", agent_id: a.id, summary: "Everyone is busy; nothing new to assign" });
    const title = pick({ prospector: ["Find dental practices in M3", "Qualify two architects in Ancoats"], outreach: ["Write to the newest qualified lead", "Follow up last week's emails"], inbox: ["Clear the inbox before noon"], credit: ["Chase anything over 30 days"], briefing: ["Draft Monday's note"] }[to.swarm_key] || ["Take the next most useful step"]);
    sw.tasks.unshift({ id: "tsk_d" + (SIM.seq++), agent_id: to.id, assigned_by: a.id, from: a.name, title, status: "doing", result: null, created_at: now(), updated_at: now() });
    event(sw, { kind: "task", agent_id: a.id, summary: `${a.name} gave ${to.name}: ${title}`, detail: { from_agent: a.id, to_agent: to.id } });
    sw.sim[to.id] = { state: "working", left: 2 + Math.floor(Math.random() * 2) };
    return;
  }
  if (k === "prospector") {
    const fresh = NEW_COMPANIES.find(([c]) => !s.leads.some((l) => l.company === c));
    if (!fresh) return event(sw, { kind: "run_done", agent_id: a.id, summary: "No new companies matched today" });
    const [company, email] = fresh;
    s.leads.unshift({ id: "lead_sim" + (SIM.seq++), agent_id: a.id, company, number: null, email, contact_name: null, website: email ? "https://" + email.split("@")[1] : null, status: "new", notes: "Found by the prospector", last_contact_at: null, created_at: now(), emails_sent: 0 });
    derive(s, sw);
    event(sw, { kind: "created", agent_id: a.id, summary: `${a.name} found ${company}` });
    const out = agentOf(sw, "outreach");
    if (email && out) {
      event(sw, { kind: "handoff", agent_id: a.id, summary: `${a.name} handed ${company} to ${out.name}`, detail: { from_agent: a.id, to_agent: out.id } });
      sw.sim[out.id] = { state: "working", left: 2 };
    }
  } else if (k === "outreach") {
    const lead = s.leads.find((l) => l.status === "new" && l.email && !s.actions.some((x) => x.status === "proposed" && x.payload.lead_id === l.id));
    if (!lead) return event(sw, { kind: "run_done", agent_id: a.id, summary: "Nothing new to write to" });
    const id = "act_sim" + (SIM.seq++);
    s.actions.unshift({ id, agent_id: a.id, run_id: null, title: `Email ${lead.company}`, reason: "A qualified lead from the prospector, with a published email.", payload: { to: lead.email, subject: `Cleaning for ${lead.company.replace(/ (Ltd|LLP)$/, "")}`, body: `Hello,\n\nI run Brightwork Cleaning, a Manchester firm that looks after offices and clinics across the city centre.\n\nWould a short visit next week to see your space and give you a fixed monthly price be useful?\n\nDana Price, Brightwork Cleaning`, lead_id: lead.id }, status: "proposed", created_at: now() });
    event(sw, { kind: "proposed", agent_id: a.id, summary: `${a.name} drafted an email to ${lead.email}` });
  } else if (k === "inbox") {
    const lead = s.leads.find((l) => l.status === "contacted");
    if (lead && Math.random() < 0.5) { lead.status = "replied"; event(sw, { kind: "run_done", agent_id: a.id, summary: `${lead.company} replied: interested` }); derive(s, sw); }
    else event(sw, { kind: "run_done", agent_id: a.id, summary: "Inbox clear" });
  } else if (k === "credit") {
    const inv = s.invoices.find((i) => i.status === "unpaid" && i.days_overdue > 0 && i.reminders === 0 && !s.actions.some((x) => x.status === "proposed" && x.payload.invoice_id === i.id));
    if (inv) {
      s.actions.unshift({ id: "act_sim" + (SIM.seq++), agent_id: a.id, title: `Reminder for ${inv.ref}`, reason: `${inv.customer}: ${inv.days_overdue} days overdue, first reminder.`, payload: { to: inv.email, subject: `Invoice ${inv.ref}`, body: `Hello,\n\nA quick note that invoice ${inv.ref} is now overdue. If it's on its way, thank you.\n\nDana Price, Brightwork Cleaning`, invoice_id: inv.id }, status: "proposed", created_at: now() });
      event(sw, { kind: "proposed", agent_id: a.id, summary: `${a.name} drafted a reminder for ${inv.ref}` });
    } else event(sw, { kind: "run_done", agent_id: a.id, summary: "No new overdue invoices" });
  } else event(sw, { kind: "run_done", agent_id: a.id, summary: `${a.name} finished` });
}

function kpi(s, key) {
  const week = ago(7 * 864e5), today = now().slice(0, 10);
  switch (key) {
    case "new_leads_week": return s.leads.filter((l) => l.created_at >= week).length;
    case "emails_sent_week": return s.actions.filter((x) => x.status === "sent" && (x.decided_at || "") >= week).length + 4;
    case "replies_week": return s.leads.filter((l) => l.status === "replied").length;
    case "won_month": return s.leads.filter((l) => l.status === "won").length;
    case "overdue_pence": return s.invoices.filter((i) => i.status === "unpaid" && i.due_date < today).reduce((n, i) => n + i.amount_pence, 0);
    case "oldest_unpaid_days": return Math.max(0, ...s.invoices.filter((i) => i.status === "unpaid").map((i) => i.days_overdue));
    case "inbox_waiting": return s.inbox.filter((m) => m.status === "new").length;
    case "open_alerts": return s.alerts.filter((a) => a.state === "open").length;
    case "tasks_open": return s.tasks.filter((t) => t.status === "open").length;
    default: return 0;
  }
}

function state(s, sw, since) {
  tick(s, sw);
  const items = derive(s, sw);
  const proposed = s.actions.filter((x) => x.status === "proposed" && sw.agents.some((a) => a.id === x.agent_id));
  const stations = sw.agents.map((a) => {
    const real = s.agents.find((x) => x.id === a.id) || a;
    const sim = sw.sim[a.id] || { state: "idle" };
    const waiting = proposed.filter((x) => x.agent_id === a.id).length;
    const toolNow = sim.state === "working" && sim.toolAt && Date.now() - sim.toolAt < 4500;
    const st = real.status === "paused" ? "paused" : sim.state === "working" ? (toolNow ? "tool" : "working") : waiting ? "needs_you" : "idle";
    const open = items.filter((i) => i.agent_id === a.id && i.status === "open");
    return { id: a.id, key: a.swarm_key, name: a.name, role: a.role, template: a.template, glyph: "spark", engine: "llm", status: real.status, rhythm: a.rhythm, autonomy: real.autonomy || "approve_all", state: st, tool: toolNow ? sim.tool : null, waiting, queue: open.length, current: open[0] ? { id: open[0].id, title: open[0].title } : null, last_run: null };
  });
  const evs = sw.events.filter((e) => e.id > (since || 0)).slice(-60);
  return {
    swarm: { id: sw.id, name: sw.name, sector: sw.bp.sector, preset: sw.preset, status: sw.status, skin: sw.bp.skin, layout: {}, created_at: sw.created_at, last_brief_at: sw.last_brief_at },
    blueprint: { stages: sw.bp.stages, handoffs: sw.bp.handoffs, goals: sw.bp.goals, agents: sw.bp.agents },
    stations, items,
    kpis: sw.bp.kpis.map((k) => ({ key: k, label: KPIS[k].label, unit: KPIS[k].unit, value: kpi(s, k) })),
    desk: { approvals: proposed.map((x) => ({ id: x.id, agent: sw.agents.find((a) => a.id === x.agent_id)?.name, agent_id: x.agent_id, title: x.title, reason: x.reason, payload: x.payload, created_at: x.created_at })), tasks: s.tasks.filter((t) => t.status === "open").map((t) => ({ ...t, agent: s.agents.find((a) => a.id === t.agent_id)?.name || null })), failed: [] },
    events: evs, cursor: sw.events.at(-1)?.id || 0,
    usage: { actions_month: 412 + sw.events.filter((e) => e.kind === "tool").length, allowance: PLANS.trial.actions },
  };
}

function brief(s, sw) {
  const waiting = s.actions.filter((x) => x.status === "proposed").length;
  sw.last_brief_at = now();
  event(sw, { kind: "brief", summary: "Brief read out" });
  return `Since your last brief, your agents found ${s.leads.filter((l) => l.created_at >= ago(864e5)).length} new leads and moved ${sw.events.filter((e) => e.kind === "moved" || e.kind === "handoff").length} cards on. ${waiting ? `${waiting} emails are waiting for your approval.` : "Nothing is waiting for your approval."} New leads this week: ${kpi(s, "new_leads_week")}.`;
}

function orgOf(s, sw) {
  const used = s.agents.filter((a) => a.template !== "orchestrator").length;
  const stagesOf = (a) => sw.bp.stages.filter((x) => (a.swarm_keys || [a.swarm_key]).includes(x.agent)).map((x) => x.name);
  return {
    swarm: { id: sw.id, name: sw.name, goals: sw.bp.goals, skin: sw.bp.skin },
    root: sw.agents.find((a) => a.template === "orchestrator")?.id || null,
    agents: sw.agents.map((a) => {
      const real = s.agents.find((x) => x.id === a.id) || a;
      return { id: a.id, key: a.swarm_key, name: a.name, template: a.template, engine: a.locked ? "watch" : "llm", role: a.badge_role, skills: a.skills, autonomy: real.autonomy || "approve_all", rhythm: a.rhythm, reports_to: a.reports_to, locked: !!a.locked, stages: stagesOf(a), status: real.status || "running", tools: a.locked ? 0 : toolsFor(a.badge_role, a.skills).length + 7 };
    }),
    tasks: sw.tasks,
    limits: { agents_used: used, agents_allowed: (PLANS[s.org.plan] || PLANS.trial).agents + 4, plan: (PLANS[s.org.plan] || PLANS.trial).name },
  };
}

const previewOf = (s, bp) => {
  const reuse = bp.agents.filter((a) => a.template !== "custom" && s.agents.some((x) => x.template === a.template && !x.swarm_id)).length;
  const after = s.agents.length + bp.agents.length - reuse, plan = PLANS[s.org.plan] || PLANS.trial, actions = estimateActions(bp);
  return { agents: bp.agents.length, orchestrator: true, reuses: [], new_agents: bp.agents.length - reuse, plan: plan.name, plan_agents: plan.agents + 4, agents_after: after, fits: true, actions_a_month: actions, allowance: plan.actions, within_allowance: actions <= plan.actions, needs: bp.needs };
};

/** Answer a Floor request in the demo, or return undefined for paths that aren't the Floor's. */
export function floorDemo(method, p, q, body, s, fail) {
  let m;
  if (!SIM.swarms.length && !SIM.booted) { SIM.booted = true; createSwarm(s, "brightwork", "Brightwork team"); }
  const find = (id) => SIM.swarms.find((w) => w.id === id) || fail(404, "Swarm not found.");
  if (method === "GET" && p === "/swarm-presets") return { presets: PRESETS.map((x) => ({ key: x.key, title: x.title, for: x.for, summary: x.summary, locked: isPass() ? null : x.locked || null, skin: x.blueprint.skin, agents: x.blueprint.agents.map(({ key, name, role, template, rhythm }) => ({ key, name, role, template, rhythm })), stages: x.blueprint.stages.map((y) => y.name), handoffs: x.blueprint.handoffs, kpis: x.blueprint.kpis })), voice: false };
  if (method === "GET" && p === "/swarms") return { swarms: SIM.swarms.map((w) => ({ id: w.id, name: w.name, sector: w.bp.sector, preset: w.preset, status: w.status, created_at: w.created_at, agents: w.agents.length, open_items: derive(s, w).filter((i) => i.status === "open").length })) };
  if (method === "POST" && p === "/swarms/plan") {
    const pr = nearestPreset(body?.description || "");
    return { blueprint: pr.blueprint, preview: previewOf(s, pr.blueprint), source: "preset", preset: pr.key, note: `In the demo, swarms come from the presets. In your own workspace, Claude designs one for your business. Closest here: ${pr.title}.` };
  }
  if (method === "POST" && p === "/swarms/preview") { const pr = preset(body?.preset) || fail(404, "Preset not found."); return { preview: previewOf(s, pr.blueprint) }; }
  if (method === "POST" && p === "/swarms") {
    const key = body?.preset || nearestPreset(body?.description || "").key;
    const pr = preset(key);
    if (pr.locked && !isPass()) fail(409, pr.locked);
    return { id: createSwarm(s, key).id, hired: pr.blueprint.agents.length, reused: 0 };
  }
  if (method === "GET" && (m = p.match(/^\/swarms\/([^/]+)$/))) return state(s, find(m[1]), Number(q.since || 0));
  if (method === "PATCH" && (m = p.match(/^\/swarms\/([^/]+)$/))) {
    const sw = find(m[1]);
    if (body?.status) { sw.status = body.status; for (const a of sw.agents) { const r = s.agents.find((x) => x.id === a.id); if (r) r.status = body.status; } event(sw, { kind: "ask", summary: body.status === "paused" ? "You paused the swarm" : "You resumed the swarm" }); }
    return { ok: true };
  }
  if (method === "GET" && (m = p.match(/^\/swarms\/([^/]+)\/org$/))) return orgOf(s, find(m[1]));
  if (method === "PATCH" && (m = p.match(/^\/swarms\/([^/]+)\/org$/))) {
    const sw = find(m[1]), before = orgOf(s, sw);
    const r = applyOrgChanges(before.agents, body?.changes || [], before.limits);
    if (!r.ok) fail(409, r.error);
    const ids = {};
    for (const a of r.agents) {
      let ag = sw.agents.find((x) => x.id === a.id);
      if (!ag) {
        const role = roleOf(a.role);
        ag = { id: "agt_d" + (SIM.seq++), template: a.role === "orchestrator" ? "orchestrator" : "custom", name: a.name, status: "running", rhythm: a.rhythm, autonomy: a.autonomy, created_at: now(), engine: "llm", glyph: "spark", category: "Run", settings: {}, monthly_cap: 300, brief: role.about, swarm_id: sw.id, swarm_key: role.key + "-" + SIM.seq, role: role.about };
        ids[a.id] = ag.id; s.agents.push(ag); sw.agents.push(ag);
      }
      const real = s.agents.find((x) => x.id === ag.id);
      Object.assign(ag, { badge_role: a.role, skills: a.skills, rhythm: a.rhythm, name: a.name });
      if (real) real.autonomy = a.autonomy;
    }
    for (const a of r.agents) { const ag = sw.agents.find((x) => x.id === (ids[a.id] || a.id)); ag.reports_to = a.reports_to ? ids[a.reports_to] || a.reports_to : null; }
    const keep = new Set(r.agents.map((a) => ids[a.id] || a.id));
    for (const a of sw.agents.filter((x) => !keep.has(x.id))) { const i = s.agents.findIndex((x) => x.id === a.id); if (i >= 0) s.agents.splice(i, 1); }
    sw.agents = sw.agents.filter((x) => keep.has(x.id));
    event(sw, { kind: "org", summary: r.summaries.length === 1 ? r.summaries[0] : `You changed the team: ${r.summaries.length} changes` });
    return { ...orgOf(s, sw), applied: r.summaries };
  }
  if (method === "POST" && (m = p.match(/^\/swarms\/([^/]+)\/goals$/))) {
    const sw = find(m[1]), goal = String(body?.text || "").trim().slice(0, 120);
    sw.bp.goals = [...sw.bp.goals.filter((g) => g !== goal), goal].slice(-5);
    event(sw, { kind: "goal", summary: `New goal: ${goal}` });
    const o = sw.agents.find((a) => a.template === "orchestrator");
    if (o) sw.sim[o.id] = { state: "working", left: 2 };
    return { type: "instruct", say: `Goal saved. ${o?.name || "The orchestrator"} is planning the work.` };
  }
  if (method === "POST" && (m = p.match(/^\/swarms\/([^/]+)\/tasks$/))) {
    const sw = find(m[1]), a = sw.agents.find((x) => x.id === body?.agent_id) || fail(404, "Agent not found.");
    const t = { id: "tsk_d" + (SIM.seq++), agent_id: a.id, assigned_by: "owner", from: "You", title: body.title, status: "doing", result: null, created_at: now(), updated_at: now() };
    sw.tasks.unshift(t); sw.sim[a.id] = { state: "working", left: 3 };
    event(sw, { kind: "task", agent_id: a.id, summary: `You gave ${a.name}: ${body.title}` });
    return { task_id: t.id, run_id: null };
  }
  if (method === "POST" && (m = p.match(/^\/swarms\/([^/]+)\/brief$/))) return { text: brief(s, find(m[1])) };
  if (method === "POST" && (m = p.match(/^\/swarms\/([^/]+)\/ask$/))) {
    const sw = find(m[1]), t = String(body?.text || "").trim();
    event(sw, { kind: "ask", summary: `You asked: ${t.slice(0, 120)}` });
    if (/^(brief me|briefing|what('?s| has) (happened|changed)|catch me up)/i.test(t)) return { type: "brief", say: brief(s, sw) };
    const gm = t.match(/^\/?(?:new\s+)?goal\s*[:\-]?\s+(.{3,})$/i);
    if (gm) return floorDemo("POST", `/swarms/${sw.id}/goals`, {}, { text: gm[1] }, s, fail);
    let mm;
    if ((mm = t.match(/^\/?(pause|resume)\s+(.+)$/i))) {
      const a = sw.agents.find((x) => x.name.toLowerCase().startsWith(mm[2].toLowerCase()) || x.swarm_key === mm[2].toLowerCase());
      return a ? { type: "change", say: `${mm[1][0].toUpperCase() + mm[1].slice(1).toLowerCase()} ${a.name}? Confirm on screen.`, change: { action: mm[1].toLowerCase(), agent_id: a.id, agent: a.name } } : { type: "answer", say: `There's no agent called ${mm[2]} here.` };
    }
    if (/\?\s*$|^(how|what|who|when|which)\b/i.test(t)) return { type: "answer", say: `Right now: ${kpi(s, "new_leads_week")} new leads this week, ${s.actions.filter((x) => x.status === "proposed").length} emails waiting for you, and ${s.leads.filter((l) => l.status === "replied").length} companies talking to you.` };
    const target = sw.agents.find((a) => t.toLowerCase().includes("@" + a.swarm_key) || t.toLowerCase().includes(a.name.toLowerCase().split(" ")[0])) || agentOf(sw, "prospector") || sw.agents[0];
    sw.sim[target.id] = { state: "working", left: 3 };
    event(sw, { kind: "run_started", agent_id: target.id, summary: `${target.name} started (asked)` });
    return { type: "instruct", say: `${target.name} is on it.`, agent: { id: target.id, name: target.name } };
  }
  if (method === "PATCH" && (m = p.match(/^\/work-items\/wi_lead:(.+)$/))) {
    const lead = s.leads.find((l) => l.id === m[1]);
    const sw = SIM.swarms[0], st = sw?.bp.stages.find((x) => x.key === body?.stage);
    if (lead && st?.rule?.source === "lead") lead.status = st.rule.status[0];
    return { ok: true };
  }
  if (method === "PATCH" && p.startsWith("/work-items/")) fail(409, "This card follows its record; change the record instead.");
  if (method === "GET" && p === "/crm/companies") {
    const term = (q.q || "").toLowerCase();
    return { companies: s.leads.filter((l) => !term || l.company.toLowerCase().includes(term)).map((l) => ({ id: l.id, company: l.company, number: l.number, email: l.email, website: l.website, status: l.status, created_at: l.created_at, last_contact_at: l.last_contact_at, contacts: l.contacts?.length || 0, open_pence: (l.deals || []).filter((d) => d.status === "open").reduce((n, d) => n + d.value_pence, 0), last_activity_at: l.last_contact_at || l.created_at })) };
  }
  if (method === "GET" && (m = p.match(/^\/crm\/companies\/([^/]+)$/))) {
    const l = s.leads.find((x) => x.id === m[1]) || fail(404, "Company not found.");
    const emails = s.actions.filter((x) => x.payload.lead_id === l.id);
    const timeline = [...(l.timeline || []), ...emails.filter((x) => x.status === "sent").map((x) => ({ kind: "email", summary: `Email sent: ${x.payload.subject}`, actor: x.decided_by, at: x.decided_at || x.created_at })), { kind: "lead", summary: l.notes || "Saved as a lead", actor: "Outreach", at: l.created_at }].sort((a, b) => (a.at < b.at ? 1 : -1));
    return { company: l, contacts: l.contacts || [], deals: l.deals || [], timeline, emails };
  }
  if (method === "POST" && p === "/crm/notes") { const l = s.leads.find((x) => x.id === body.lead_id) || fail(404, "Company not found."); (l.timeline ||= []).unshift({ kind: body.kind || "note", summary: body.summary, actor: "dana@brightwork.example", at: now() }); return { ok: true }; }
  if (method === "POST" && p === "/crm/contacts") { const l = s.leads.find((x) => x.id === body.lead_id) || fail(404, "Company not found."); (l.contacts ||= []).push({ id: "con_" + (SIM.seq++), name: body.name, role: body.role || null, email: body.email || null, phone: null }); return { contact_id: "con", created: true }; }
  if (method === "POST" && p === "/crm/deals") { const l = s.leads.find((x) => x.id === body.lead_id) || fail(404, "Company not found."); (l.deals ||= []).unshift({ id: "deal_" + (SIM.seq++), title: body.title, value_pence: body.value_pence || 0, stage: "open", status: "open", updated_at: now() }); (l.timeline ||= []).unshift({ kind: "deal", summary: `Deal opened: ${body.title}`, actor: "dana@brightwork.example", at: now() }); return { deal_id: "deal", status: "open" }; }
  if (method === "PATCH" && (m = p.match(/^\/crm\/deals\/([^/]+)$/))) {
    for (const l of s.leads) for (const d of l.deals || []) if (d.id === m[1]) { Object.assign(d, body, { updated_at: now() }); if (body.status === "won") { l.status = "won"; (l.timeline ||= []).unshift({ kind: "won", summary: `${d.title}: won`, actor: "dana@brightwork.example", at: now() }); } }
    return { ok: true };
  }
  if (method === "POST" && p === "/crm/companies") { const id = "lead_m" + (SIM.seq++); s.leads.unshift({ id, company: body.company, status: "new", email: null, created_at: now(), emails_sent: 0 }); return { id }; }
  if (p.startsWith("/voice/")) { const e = new Error("Voice uses your browser in the demo."); e.status = 503; e.code = "voice_off"; throw e; }
  return undefined;
}
