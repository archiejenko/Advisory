// The demo workspace: the same pages as the live workspace, answered from memory instead of the API.
// Example business and fictional companies. Changes last until the page reloads.
import { TEMPLATES, RHYTHM_LABEL, PLANS } from "../../../packages/core/templates.ts";
import { ALERTS, CLIENTS, PROSPECTS } from "./data.js";

const H = 3600e3, D = 24 * H;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();
// The next weekday (or Monday, for weekly) at an hour, UK time near enough for a demo.
const nextAt = (hour, weekly) => { const d = new Date(); d.setHours(hour, 0, 0, 0); do d.setDate(d.getDate() + 1); while (weekly ? d.getDay() !== 1 : [0, 6].includes(d.getDay())); return d.toISOString(); };
const day = (n) => new Date(Date.now() + n * D).toISOString().slice(0, 10);
let seq = 100;
const id = (p) => `${p}_demo${++seq}`;

const PROFILE = {
  what: "Commercial and office cleaning on daily or weekly contracts",
  customers: "offices, dental practices and small clinics with 10 to 80 staff",
  area: "Manchester and Salford",
  tone: "warm and plain-spoken, no jargon",
  sign_off: "Dana Price, Brightwork Cleaning",
  website: "brightwork.example",
};
export const DEMO_ME = {
  demo: true,
  user: { id: "usr_demo", email: "dana@brightwork.example", name: "Dana Price" },
  role: "owner",
  org: { id: "org_demo", name: "Brightwork Cleaning Ltd", profile: PROFILE, plan: "trial", inbox_address: "brightwork-k7q2@in.agenthouse.example", markup_pct: 0, prospect_districts: ["M1", "M2", "M3", "M15", "M50"], prospect_sic: ["69", "86"], prospect_min_age: 3 },
  subscription: { status: "trialing" },
};

const tpl = (k) => TEMPLATES.find((t) => t.key === k);
const agent = (o) => ({ settings: {}, status: "running", run_hour: 8, autonomy: "approve_all", channel_id: null, monthly_cap: 300, last_run_at: null, next_run_at: null, created_at: ago(9 * D), ...o, engine: tpl(o.template).engine, category: tpl(o.template).category, glyph: tpl(o.template).glyph, brief: o.brief || tpl(o.template).brief({ name: DEMO_ME.org.name, ...PROFILE }) });

function seed() {
  const agents = [
    agent({ id: "agt_out", template: "outreach", name: "Outreach", rhythm: "weekdays", autonomy: "approve_first", channel_id: "chn_team", last_run_at: ago(5 * H), next_run_at: nextAt(8) }),
    agent({ id: "agt_inb", template: "inbox", name: "Inbox", rhythm: "on_event", last_run_at: ago(40 * 60e3) }),
    agent({ id: "agt_cc", template: "credit-control", name: "Credit control", rhythm: "weekdays", run_hour: 9, autonomy: "approve_first", last_run_at: ago(4 * H), next_run_at: nextAt(9) }),
    agent({ id: "agt_watch", template: "customer-watch", name: "Customer and supplier watch", rhythm: "on_event", channel_id: "chn_team", last_run_at: ago(14 * H) }),
    agent({ id: "agt_res", template: "research", name: "Research", rhythm: "on_demand", last_run_at: ago(2 * D) }),
    agent({ id: "agt_brief", template: "briefing", name: "Weekly briefing", rhythm: "weekly", run_hour: 7, autonomy: "auto", last_run_at: ago(2 * D), next_run_at: nextAt(7, true) }),
  ];
  const leads = [
    ["Ashworth Hale Solicitors Ltd", "09112783", "hello@ashworthhale.example", "contacted", "28 staff on Deansgate; their careers page says they're moving to a bigger office in January.", 2 * D],
    ["Peel Street Accountants Ltd", "10284419", "office@peelstreet.example", "new", "Accountancy practice, 15 staff, M3. Website lists a new clinic-style meeting suite.", 5 * H],
    ["Castlefield Dental Care Ltd", "11893350", "practice@castlefielddental.example", "replied", "Two-surgery dental practice; reviews mention the waiting room.", 4 * D],
    ["Whalley Range Physio Ltd", "12011784", "info@wrphysio.example", "contacted", "Physio clinic with three treatment rooms, opened a second site in 2025.", 3 * D],
    ["Salford Quays Media Ltd", "10556201", null, "new", "Agency of about 40 staff at MediaCity. No public email; a contact form only.", 5 * H],
    ["Ancoats Architects LLP", "OC412233", "studio@ancoatsarch.example", "won", "Studio of 22 on Redhill Street. Signed a weekly contract.", 12 * D],
    ["Didsbury Family Dental Ltd", "09876120", "reception@didsburydental.example", "lost", "Already on a two-year contract with another cleaner.", 15 * D],
    ["Northern Quarter Studios Ltd", "11320045", "hi@nqstudios.example", "contacted", "Co-working space, 3 floors, growing membership.", 6 * D],
  ].map(([company, number, email, status, notes, t], i) => ({ id: "lead_" + i, agent_id: "agt_out", company, number, email, contact_name: null, website: email ? "https://" + email.split("@")[1] : null, status, notes, last_contact_at: status === "new" ? null : ago(t - H), created_at: ago(t), emails_sent: status === "new" ? 0 : status === "contacted" ? 1 : 2 }));
  const invoices = [
    ["INV-1042", "Quayside Opticians Ltd", "accounts@quayside.example", 64000, -23, "unpaid", 1],
    ["INV-1047", "Tarnbrook Logistics Ltd", "finance@tarnbrook.example", 128000, -9, "unpaid", 0],
    ["INV-1051", "Ancoats Architects LLP", "studio@ancoatsarch.example", 41600, -2, "unpaid", 0],
    ["INV-1053", "Castlefield Dental Care Ltd", "practice@castlefielddental.example", 32000, 5, "unpaid", 0],
    ["INV-1055", "Holcombe Legal Ltd", "accounts@holcombelegal.example", 96000, 12, "unpaid", 0],
    ["INV-1038", "Marston Interiors Ltd", "ap@marston.example", 52000, -40, "paid", 2],
    ["INV-1040", "Irwell Engineering Ltd", "ap@irwelleng.example", 77500, -30, "disputed", 1],
  ].map(([ref, customer, email, amount_pence, due, status, reminders], i) => ({ id: "inv_" + i, ref, customer, email, amount_pence, due_date: day(due), status, reminders, last_reminder_at: reminders ? ago(6 * D) : null, created_at: ago(45 * D), days_overdue: -due }));
  const inbox = [
    ["facilities@salfordmedia.example", "Quote for nightly cleaning, 3 floors", "Hi, we're looking for a nightly clean of our offices at MediaCity, three floors, about 9,000 sq ft. Could you quote and tell us when you could start?", "triaged", "high", "quote", "New enquiry: nightly clean, 3 floors at MediaCity. Wants a quote and start date.", 40 * 60e3],
    ["reception@castlefielddental.example", "Re: Cleaning for Castlefield Dental", "Thanks Dana, yes we'd be interested. Could you come and look round on Thursday after 5pm?", "triaged", "high", "booking", "Lead replied: wants a walk-round Thursday after 5pm.", 3 * H],
    ["accounts@quayside.example", "Re: Invoice INV-1042", "Apologies, this slipped through. Payment will go out on Friday.", "triaged", "normal", "question", "Quayside say INV-1042 will be paid Friday.", 20 * H],
    ["sam@ancoatsarch.example", "Extra clean before our open day", "Could the team do a deep clean on the 30th before our open day? Happy to pay extra.", "replied", "normal", "booking", "Ancoats want a one-off deep clean on the 30th.", 2 * D],
    ["offers@supplies.example", "20% off microfibre this week", "Bulk microfibre cloths at 20% off until Sunday.", "ignored", "low", "spam", "Supplier promotion.", 2 * D],
    ["office@peelstreet.example", "Who looks after keys?", "Before we go further, how do you handle keys and alarm codes?", "new", null, null, null, 15 * 60e3],
  ].map(([from_addr, subject, body, status, urgency, category, summary, t], i) => ({ id: "msg_" + i, from_addr, subject, body, status, urgency, category, summary, received_at: ago(t) }));
  const actions = [
    { id: "act_1", agent_id: "agt_out", run_id: "run_1", title: "Email Peel Street Accountants", reason: "New lead in M3 that fits your customers: 15 staff, accountancy practice, has a public office email.", payload: { to: "office@peelstreet.example", subject: "Office cleaning for Peel Street Accountants", body: "Hello,\n\nI run Brightwork Cleaning, a Manchester firm that looks after offices and clinics across the city centre and Salford.\n\nI noticed you've added a meeting suite for clients. Spaces like that are where a daily tidy makes the biggest difference to first impressions. We clean before 8am or after 6pm, so your team never works around us.\n\nWould a short visit next week to see the space and give you a fixed monthly price be useful?\n\nDana Price, Brightwork Cleaning", lead_id: "lead_1" }, status: "proposed", created_at: ago(5 * H) },
    { id: "act_2", agent_id: "agt_inb", run_id: "run_2", title: "Reply to Salford Quays Media", reason: "Quote request. Drafted a reply asking the two questions you need to price it.", payload: { to: "facilities@salfordmedia.example", subject: "Re: Quote for nightly cleaning, 3 floors", body: "Hello,\n\nThanks for getting in touch. Nightly cleaning across three floors is exactly what we do.\n\nTo give you an accurate fixed price, could you tell me roughly how many kitchens and washrooms there are, and whether you need weekend cover? I can usually start within two weeks of agreeing a price.\n\nI'm happy to visit this week if that's easier.\n\nDana Price, Brightwork Cleaning", message_id: "msg_0" }, status: "proposed", created_at: ago(38 * 60e3) },
    { id: "act_3", agent_id: "agt_inb", run_id: "run_2", title: "Reply to Castlefield Dental Care", reason: "They want a walk-round on Thursday. Drafted a reply confirming 5.30pm; check your diary first.", payload: { to: "reception@castlefielddental.example", subject: "Re: Cleaning for Castlefield Dental", body: "Hello,\n\nThursday works well. I'll come at 5.30pm, it takes about twenty minutes, and I'll send a fixed price the next morning.\n\nDana Price, Brightwork Cleaning", message_id: "msg_1", lead_id: "lead_2" }, status: "proposed", created_at: ago(3 * H) },
    { id: "act_4", agent_id: "agt_cc", run_id: "run_3", title: "Reminder for INV-1047", reason: "Tarnbrook Logistics: £1,280.00, 9 days overdue, first reminder.", payload: { to: "finance@tarnbrook.example", subject: "Invoice INV-1047, £1,280.00", body: "Hello,\n\nA quick note that invoice INV-1047 for £1,280.00 was due on " + day(-9) + ". If it's already on its way, thank you and please ignore this. If anything's holding it up, just reply and let me know.\n\nDana Price, Brightwork Cleaning", invoice_id: "inv_1" }, status: "proposed", created_at: ago(4 * H) },
    { id: "act_5", agent_id: "agt_out", run_id: "run_4", title: "Email Ashworth Hale Solicitors", reason: "Moving office in January; 28 staff.", payload: { to: "hello@ashworthhale.example", subject: "Office cleaning for Ashworth Hale", body: "Hello,\n\nI saw you're moving to a bigger office in January…", lead_id: "lead_0" }, status: "sent", decided_by: "dana@brightwork.example", decided_at: ago(2 * D), result: "Sent", created_at: ago(2 * D + H) },
    { id: "act_6", agent_id: "agt_cc", run_id: "run_5", title: "Second reminder for INV-1042", reason: "Quayside Opticians: £640.00, 23 days overdue. Sent automatically because you approved the first reminder.", payload: { to: "accounts@quayside.example", subject: "Invoice INV-1042, £640.00, second reminder", body: "Hello,\n\nFollowing up on invoice INV-1042…", invoice_id: "inv_0" }, status: "sent", decided_by: "auto", decided_at: ago(D), result: "Sent", created_at: ago(D) },
    { id: "act_7", agent_id: "agt_out", run_id: "run_4", title: "Email Didsbury Family Dental", reason: "Dental practice in M20.", payload: { to: "reception@didsburydental.example", subject: "Cleaning for Didsbury Family Dental", body: "Hello…", lead_id: "lead_6" }, status: "rejected", decided_by: "dana@brightwork.example", decided_at: ago(3 * D), created_at: ago(3 * D + H) },
  ];
  const step = (tool, input, result) => ({ tool, input, ok: true, result: typeof result === "string" ? result : JSON.stringify(result) });
  const runs = [
    { id: "run_1", agent_id: "agt_out", trigger: "schedule", status: "waiting", steps: 7, tool_calls: 6, summary: "Found 2 new companies that fit. Saved both as leads and drafted a first email to Peel Street Accountants. Salford Quays Media has no public email, so I added a task to call them.", cost_pence: 9, created_at: ago(5 * H), finished_at: ago(5 * H - 90e3),
      log: [step("business-profile", {}, { name: "Brightwork Cleaning Ltd", ...PROFILE }), step("find-companies", { count: 5 }, { companies: [{ name: "PEEL STREET ACCOUNTANTS LTD", number: "10284419", district: "M3" }, { name: "SALFORD QUAYS MEDIA LTD", number: "10556201", district: "M50" }] }), step("company-research", { name: "Peel Street Accountants Ltd" }, { status: "Active", incorporated: "2016-05-02", likely_website: "https://peelstreet.example" }), step("read-page", { url: "https://peelstreet.example" }, { title: "Peel Street Accountants", emails_on_page: ["office@peelstreet.example"] }), step("save-lead", { company: "Peel Street Accountants Ltd", email: "office@peelstreet.example" }, { saved: true }), step("propose-email", { to: "office@peelstreet.example", subject: "Office cleaning for Peel Street Accountants" }, { status: "proposed" }), step("create-task", { title: "Call Salford Quays Media: no public email" }, { created: true })] },
    { id: "run_2", agent_id: "agt_inb", trigger: "event", status: "waiting", steps: 5, tool_calls: 4, summary: "Two new messages need you: a quote request from Salford Quays Media and a walk-round request from Castlefield Dental. Replies drafted for both.", cost_pence: 4, created_at: ago(40 * 60e3), finished_at: ago(38 * 60e3),
      log: [step("list-inbox", { status: "new" }, { messages: 2 }), step("triage-message", { id: "msg_0", urgency: "high", category: "quote" }, { ok: true }), step("propose-email", { to: "facilities@salfordmedia.example" }, { status: "proposed" }), step("propose-email", { to: "reception@castlefielddental.example" }, { status: "proposed" })] },
    { id: "run_3", agent_id: "agt_cc", trigger: "schedule", status: "waiting", steps: 3, tool_calls: 2, summary: "1 invoice newly overdue (INV-1047, £1,280.00). First reminder drafted for your approval. INV-1042 had its second reminder yesterday, so I left it.", cost_pence: 2, created_at: ago(4 * H), finished_at: ago(4 * H - 40e3),
      log: [step("list-invoices", { status: "unpaid" }, { overdue: 3 }), step("propose-email", { to: "finance@tarnbrook.example", subject: "Invoice INV-1047, £1,280.00" }, { status: "proposed" })] },
    { id: "run_6", agent_id: "agt_res", trigger: "manual", input: "Which office cleaning firms compete with us in Salford, and what do they charge?", status: "done", steps: 6, tool_calls: 5, summary: "Three firms advertise office cleaning in Salford. Two publish prices: about £18 to £22 an hour for regular contracts, with a minimum of two hours a visit. The third quotes only after a site visit.\n\nSources:\n- https://example.com/salford-cleaning-prices\n- https://example.com/sparkle-commercial\n- https://example.com/quays-cleaning", cost_pence: 6, created_at: ago(2 * D), finished_at: ago(2 * D - 70e3),
      log: [step("web-research", { query: "office cleaning Salford prices" }, { results: 8 }), step("read-page", { url: "https://example.com/salford-cleaning-prices" }, { title: "Commercial cleaning prices" })] },
    { id: "run_7", agent_id: "agt_brief", trigger: "schedule", status: "done", steps: 3, tool_calls: 2, summary: "Briefing sent to dana@brightwork.example: 14 runs, 6 emails sent, 1 reply from Castlefield Dental, £2,240 overdue across 3 invoices.", cost_pence: 2, created_at: ago(2 * D + 3 * H), finished_at: ago(2 * D + 3 * H - 30e3),
      log: [step("recent-activity", { days: 7 }, { runs: 14, sent: 6 }), step("notify-owner", { title: "Weekly briefing" }, { sent: true })] },
    { id: "run_4", agent_id: "agt_out", trigger: "schedule", status: "done", steps: 8, tool_calls: 7, summary: "Researched 3 companies, saved 2 leads and drafted 2 emails.", cost_pence: 11, created_at: ago(3 * D), finished_at: ago(3 * D - 120e3), log: [] },
    { id: "run_5", agent_id: "agt_cc", trigger: "schedule", status: "done", steps: 3, tool_calls: 2, summary: "Sent the second reminder for INV-1042 automatically.", cost_pence: 2, created_at: ago(D), finished_at: ago(D - 30e3), log: [] },
  ];
  const tasks = [
    { id: "task_1", agent_id: "agt_out", title: "Call Salford Quays Media: no public email", detail: "Reception on 0161 000 0000 per their contact page. Ask for facilities.", due_date: day(1), status: "open", created_at: ago(5 * H) },
    { id: "task_2", agent_id: "agt_inb", title: "Walk-round at Castlefield Dental, Thursday 5.30pm", detail: "Confirm once you've approved the reply.", due_date: day(2), status: "open", created_at: ago(3 * H) },
    { id: "task_3", agent_id: null, title: "Order microfibre restock", detail: null, due_date: null, status: "open", created_at: ago(D) },
    { id: "task_4", agent_id: "agt_cc", title: "Call Irwell Engineering about the disputed invoice", detail: "They say the October deep clean wasn't agreed.", due_date: day(-1), status: "done", created_at: ago(5 * D), done_at: ago(2 * D) },
  ];
  const byNo = Object.fromEntries(CLIENTS.map((c) => [c.no, c]));
  const alerts = ALERTS.map((a, i) => ({ id: a.id, number: CLIENTS[a.client].no, client: CLIENTS[a.client].name, agent: "watch", severity: a.severity, title: a.title, summary: a.summary, facts: a.facts.map(([k, v, s]) => [k, v.replace("Your client list", "Your customer list"), s.replace("Your client list", "Your customer list")]), next_step: a.next.replace("project work", "work"), state: "open", created_at: ago((i + 1) * 9 * H) }));
  const clients = CLIENTS.slice(0, 60).concat(CLIENTS.filter((c, i) => i >= 60 && c.flagged)).map((c) => ({ number: c.no, name: c.name, watching: true, status: c.flagged && c.severity === "Critical" ? "In administration" : "Active", latest_finding: c.flagged ? c.finding : "No changes", flagged: c.flagged, severity: c.flagged ? c.severity : null }));
  const channels = [
    { id: "chn_team", kind: "slack", label: "#brightwork-team", verified_at: ago(8 * D), created_at: ago(9 * D) },
    { id: "chn_email", kind: "email", label: "Office inbox", verified_at: null, created_at: ago(9 * D) },
  ];
  const users = [
    { id: "usr_demo", email: "dana@brightwork.example", name: "Dana Price", role: "owner" },
    { id: "usr_demo2", email: "sam@brightwork.example", name: "Sam Okafor", role: "manager" },
  ];
  return { org: DEMO_ME.org, agents, leads, invoices, inbox, actions, runs, tasks, alerts, clients, byNo, channels, users };
}

let S = null;
const st = () => (S ||= seed());
const agentName = (aid) => st().agents.find((a) => a.id === aid)?.name || "Removed agent";
const agentTpl = (aid) => st().agents.find((a) => a.id === aid)?.template;
const fail = (status, message) => { const e = new Error(message); e.status = status; e.code = "demo"; throw e; };
const signUp = () => fail(409, "This is the demo workspace. Start a free trial to do this with your own business.");
const runOut = ({ log, ...r }) => ({ ...r, agent: agentName(r.agent_id), template: agentTpl(r.agent_id) });

const CANNED = {
  outreach: ["Found 1 new company that fits. Saved it as a lead and drafted a first email.", { title: "Email Northern Quarter Dental", to: "hello@nqdental.example", subject: "Cleaning for Northern Quarter Dental", body: "Hello,\n\nI run Brightwork Cleaning in Manchester. We look after dental practices across the city centre, cleaning after hours so your surgery is ready for the first patient.\n\nWould a short visit to give you a fixed monthly price be useful?\n\nDana Price, Brightwork Cleaning", reason: "Dental practice in M1 with 12 staff and a public email." }],
  inbox: ["No new messages since the last run.", null],
  "credit-control": ["No invoices newly overdue. Reminders already in hand for the rest.", null],
  briefing: ["Briefing sent to dana@brightwork.example.", null],
  research: ["Demo answer. In your own workspace the research agent searches the web, reads the pages it finds and answers with sources.\n\nSources:\n- https://example.com/demo-source", null],
};
function startDemoRun(a, input) {
  const s = st(), rid = id("run");
  const run = { id: rid, agent_id: a.id, trigger: "manual", input: input || null, status: "running", steps: 0, tool_calls: 0, summary: null, cost_pence: 0, created_at: new Date().toISOString(), finished_at: null, log: [] };
  s.runs.unshift(run);
  setTimeout(() => {
    const [summary, act] = CANNED[a.template] || ["Done.", null];
    run.steps = act ? 5 : 2; run.tool_calls = act ? 4 : 1; run.cost_pence = act ? 5 : 1;
    run.log = act ? [{ tool: "find-companies", input: { count: 3 }, ok: true, result: '{"companies":[{"name":"NORTHERN QUARTER DENTAL LTD"}]}' }, { tool: "propose-email", input: { to: act.to, subject: act.subject }, ok: true, result: '{"status":"proposed"}' }] : [{ tool: a.template === "research" ? "web-research" : "recent-activity", input: input ? { query: input } : {}, ok: true, result: "{}" }];
    run.summary = summary; run.finished_at = new Date().toISOString(); run.status = act ? "waiting" : "done";
    a.last_run_at = run.finished_at;
    if (act) s.actions.unshift({ id: id("act"), agent_id: a.id, run_id: rid, title: act.title, reason: act.reason, payload: { to: act.to, subject: act.subject, body: act.body }, status: "proposed", created_at: run.finished_at });
  }, 2500);
  return rid;
}

/** Answer one workspace request from the demo data. Mirrors the shapes of /api/ws. */
export async function demoApi(method, path, body) {
  await new Promise((r) => setTimeout(r, 120));
  const s = st();
  const [p, qs] = path.replace(/^\/api\/ws/, "").split("?");
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const m = (re) => p.match(re);
  const now = () => new Date().toISOString();
  let r;

  if (method === "GET") {
    if (p === "/overview") {
      const since = ago(7 * D);
      return {
        agents_running: s.agents.filter((a) => a.status === "running").length,
        waiting: s.actions.filter((a) => a.status === "proposed").length,
        runs_week: s.runs.filter((x) => x.created_at >= since).length + 9,
        sent_week: s.actions.filter((a) => a.status === "sent" && a.decided_at >= since).length + 4,
        leads: s.leads.length, open_tasks: s.tasks.filter((t) => t.status === "open").length,
        overdue_invoices: s.invoices.filter((i) => i.status === "unpaid" && i.days_overdue > 0).length,
        open_alerts: s.alerts.filter((a) => a.state === "open").length,
        inbox_new: s.inbox.filter((x) => x.status === "new").length,
        activity: s.runs.slice(0, 8).map((x) => ({ id: x.id, status: x.status, summary: x.summary, created_at: x.created_at, trigger: x.trigger, agent: agentName(x.agent_id), template: agentTpl(x.agent_id) })),
      };
    }
    if (p === "/templates") return { templates: TEMPLATES.map(({ brief, instructions, kickoff, ...t }) => ({ ...t, rhythm_label: RHYTHM_LABEL[t.rhythm], default_brief: brief({ name: s.org.name, ...PROFILE }), hired: s.agents.filter((a) => a.template === t.key).length })) };
    if (p === "/my-agents") return { agents: s.agents.map((a) => ({ ...a, rhythm_label: RHYTHM_LABEL[a.rhythm], waiting: s.actions.filter((x) => x.agent_id === a.id && x.status === "proposed").length, runs: s.runs.filter((x) => x.agent_id === a.id).length })) };
    if ((r = m(/^\/my-agents\/([^/]+)$/))) {
      const a = s.agents.find((x) => x.id === r[1]);
      if (!a) fail(404, "Agent not found.");
      const { brief, instructions, kickoff, ...t } = tpl(a.template);
      return { agent: { ...a, rhythm_label: RHYTHM_LABEL[a.rhythm] }, runs: s.runs.filter((x) => x.agent_id === a.id).map(runOut), actions_this_month: s.runs.filter((x) => x.agent_id === a.id).reduce((n, x) => n + x.tool_calls, 0) + 38, template: { ...t, rhythm_label: RHYTHM_LABEL[t.rhythm], default_brief: brief({ name: s.org.name, ...PROFILE }) } };
    }
    if (p === "/runs") return { runs: s.runs.filter((x) => !q.agent || x.agent_id === q.agent).map(runOut) };
    if ((r = m(/^\/runs\/([^/]+)$/))) {
      const x = s.runs.find((y) => y.id === r[1]);
      if (!x) fail(404, "Run not found.");
      return { run: runOut(x), steps: x.log, actions: s.actions.filter((a) => a.run_id === x.id).map(({ id, title, status, created_at }) => ({ id, title, status, created_at })) };
    }
    if (p === "/actions") {
      const status = q.status || "proposed";
      const c = (k) => s.actions.filter((a) => a.status === k).length;
      return { counts: { proposed: c("proposed"), sent: c("sent"), rejected: c("rejected"), failed: c("failed") }, actions: s.actions.filter((a) => status === "all" || a.status === status).map((a) => ({ kind: "email", ...a, agent: agentName(a.agent_id), template: agentTpl(a.agent_id) })) };
    }
    if (p === "/leads") return { leads: s.leads.filter((l) => !q.status || l.status === q.status) };
    if (p === "/tasks") return { tasks: [...s.tasks].sort((a, b) => (a.status === b.status ? 0 : a.status === "done" ? 1 : -1)).map((t) => ({ ...t, agent: t.agent_id ? agentName(t.agent_id) : null })) };
    if (p === "/invoices") return { today: day(0), invoices: s.invoices };
    if (p === "/inbox") return { address: s.org.inbox_address, messages: s.inbox };
    if (p === "/channels") return { channels: s.channels };
    if (p === "/users") return { users: s.users };
    if (p === "/audit") return { entries: [{ actor: "usr_demo", action: "action_approved", target: "act_5", at: ago(2 * D) }, { actor: "usr_demo", action: "agent_hired", target: "agt_brief", at: ago(9 * D) }, { actor: "usr_demo", action: "invoices_imported", target: null, at: ago(9 * D) }] };
    if (p === "/agents") return { agents: [{ key: "watch", on: true, digest: "weekly", channel_id: "chn_team" }, { key: "check", on: true, digest: "weekly", channel_id: null }, { key: "prospect", on: false, digest: "weekly", channel_id: null }] };
    if (p === "/alerts") {
      const state = q.state || "open";
      return { counts: { open: s.alerts.filter((a) => a.state === "open").length, reviewed: s.alerts.filter((a) => a.state === "reviewed").length, all: s.alerts.length }, alerts: s.alerts.filter((a) => state === "all" || a.state === state) };
    }
    if ((r = m(/^\/alerts\/([^/]+)$/))) return s.alerts.find((a) => a.id === r[1]) || fail(404, "Alert not found.");
    if (p === "/clients") {
      let list = s.clients.filter((c) => !q.q || c.name.toLowerCase().includes(q.q.toLowerCase()) || c.number.includes(q.q));
      if (q.status === "flagged") list = list.filter((c) => c.flagged);
      if (q.status === "clear") list = list.filter((c) => !c.flagged);
      list = [...list].sort((a, b) => (q.sort === "number" ? a.number.localeCompare(b.number) : q.sort === "latest" ? Number(b.flagged) - Number(a.flagged) : a.name.localeCompare(b.name)));
      const per = Number(q.per) || 20, page = Number(q.page) || 0;
      return { total: list.length, page, per, clients: list.slice(page * per, page * per + per) };
    }
    if ((r = m(/^\/clients\/([^/]+)$/))) {
      const c = s.clients.find((x) => x.number === r[1]);
      if (!c) fail(404, "Customer not found.");
      const al = s.alerts.filter((a) => a.number === c.number);
      return { client: { number: c.number, name: c.name, since: "2024-03-01", users: null, monthly_fee: null, next_invoice: null, watching: c.watching }, record: { status: c.status, raw_status: "active", fields: [["Status", c.status], ["Company number", c.number], ["Registered office", "Manchester"]] }, history: al.map((a) => ({ date: a.created_at.slice(0, 10), kind: "company", source: "Companies House", alert: { id: a.id, title: a.title, severity: a.severity } })), alerts: al };
    }
    if (p === "/briefs") return { briefs: [] };
    if (p === "/usage") {
      const plan = PLANS[s.org.plan];
      const byAgent = s.agents.map((a) => ({ name: a.name, template: a.template, runs: s.runs.filter((x) => x.agent_id === a.id).length + (a.engine === "llm" ? 6 : 0), actions: s.runs.filter((x) => x.agent_id === a.id).reduce((n, x) => n + x.tool_calls, 0) + (a.engine === "llm" ? 34 : 0) }));
      return { plan: s.org.plan, plan_name: plan.name, plan_actions: plan.actions, plan_agents: plan.agents, actions: byAgent.reduce((n, a) => n + a.actions, 0), model_pence: 412, emails_sent: s.actions.filter((a) => a.status === "sent").length + 17, by_agent: byAgent.sort((a, b) => b.actions - a.actions), month: q.month, clients: s.clients.length, runs: 0, briefs: 0, alerts: s.alerts.length, weeks: [], per_client: [] };
    }
    if (p === "/prospects/preview") return { index_month: day(0).slice(0, 7), index_size: 48210, rows: PROSPECTS.map(([name, number, district, sic, inc]) => ({ name, number, district, sic, incorporated: inc + "-01-01" })) };
    fail(404, "Not in the demo.");
  }

  // Changes
  if (method === "POST" && (r = m(/^\/actions\/([^/]+)\/(approve|reject)$/))) {
    const a = s.actions.find((x) => x.id === r[1]);
    if (!a || a.status !== "proposed") fail(409, "This has already been decided.");
    if (r[2] === "approve") {
      a.payload = { ...a.payload, ...(body?.subject ? { subject: body.subject } : {}), ...(body?.body ? { body: body.body } : {}) };
      Object.assign(a, { status: "sent", decided_by: DEMO_ME.user.email, decided_at: now(), result: "Sent (demo: nothing left this page)" });
      const lead = s.leads.find((l) => l.id === a.payload.lead_id);
      if (lead && lead.status === "new") { lead.status = "contacted"; lead.last_contact_at = now(); lead.emails_sent++; }
      const inv = s.invoices.find((i) => i.id === a.payload.invoice_id);
      if (inv) { inv.reminders++; inv.last_reminder_at = now(); }
      const msg = s.inbox.find((x) => x.id === a.payload.message_id);
      if (msg) msg.status = "replied";
      return { ok: true, status: "sent" };
    }
    Object.assign(a, { status: "rejected", decided_by: DEMO_ME.user.email, decided_at: now() });
    return { ok: true };
  }
  if (method === "POST" && p === "/my-agents") {
    const t = tpl(body.template);
    if (!t) fail(404, "No agent by that name in the catalogue.");
    if (t.status !== "live") fail(409, `${t.name} isn't available yet: it needs ${t.needs}.`);
    if (t.engine !== "llm" && s.agents.some((a) => a.template === t.key)) fail(409, `${t.name} is already working for you.`);
    if (s.agents.length >= PLANS[s.org.plan].agents) fail(409, `Your ${PLANS[s.org.plan].name} includes ${PLANS[s.org.plan].agents} agents. Pause or remove one to hire another in the demo.`);
    const a = agent({ id: id("agt"), template: t.key, name: body.name || t.name, brief: body.brief, rhythm: body.rhythm || t.rhythm, run_hour: body.run_hour ?? 8, autonomy: body.autonomy || "approve_all", channel_id: body.channel_id || null, created_at: now() });
    s.agents.push(a);
    return { id: a.id };
  }
  if ((r = m(/^\/my-agents\/([^/]+)$/))) {
    const i = s.agents.findIndex((x) => x.id === r[1]);
    if (i < 0) fail(404, "Agent not found.");
    if (method === "DELETE") { s.actions.forEach((x) => { if (x.agent_id === r[1] && x.status === "proposed") x.status = "rejected"; }); s.agents.splice(i, 1); return { ok: true }; }
    Object.assign(s.agents[i], body);
    return { ok: true };
  }
  if (method === "POST" && (r = m(/^\/my-agents\/([^/]+)\/run$/))) {
    const a = s.agents.find((x) => x.id === r[1]);
    if (!a) fail(404, "Agent not found.");
    if (a.engine !== "llm") fail(409, "This agent runs on its own schedule from the registers.");
    if (a.template === "research" && !body?.input?.trim()) fail(400, "Ask the research agent a question.");
    return { run_id: startDemoRun(a, body?.input), status: "queued" };
  }
  if (method === "PATCH" && (r = m(/^\/leads\/([^/]+)$/))) { Object.assign(s.leads.find((x) => x.id === r[1]) || fail(404, "Lead not found."), body); return { ok: true }; }
  if (method === "POST" && p === "/tasks") { s.tasks.unshift({ id: id("task"), agent_id: null, status: "open", created_at: now(), detail: null, due_date: null, ...body }); return { id: s.tasks[0].id }; }
  if (method === "PATCH" && (r = m(/^\/tasks\/([^/]+)$/))) { Object.assign(s.tasks.find((x) => x.id === r[1]) || fail(404, "Task not found."), body, { done_at: body.status === "done" ? now() : null }); return { ok: true }; }
  if (method === "PATCH" && (r = m(/^\/invoices\/([^/]+)$/))) { Object.assign(s.invoices.find((x) => x.id === r[1]) || fail(404, "Invoice not found."), body); return { ok: true }; }
  if (method === "PATCH" && (r = m(/^\/alerts\/([^/]+)$/))) { Object.assign(s.alerts.find((x) => x.id === r[1]) || fail(404, "Alert not found."), { state: body.state, reviewed_by: body.state === "reviewed" ? DEMO_ME.user.email : null, reviewed_at: body.state === "reviewed" ? now() : null }); return { ok: true }; }
  if (method === "POST" && m(/^\/alerts\/[^/]+\/share$/)) return { ok: true, status: "queued" };
  if (method === "PATCH" && p === "/org") { if (body.profile) Object.assign(PROFILE, body.profile); if (body.name) s.org.name = body.name; return { ok: true }; }
  if (method === "PATCH" && m(/^\/clients\/[^/]+$/)) { const c = s.clients.find((x) => p.endsWith(x.number)); if (c && body.watching !== undefined) c.watching = body.watching; return { ok: true }; }
  if (method === "POST" && m(/^\/channels\/[^/]+\/test$/)) return { status: "dry_run" };
  if (method === "PATCH" && m(/^\/agents\/[^/]+$/)) return { ok: true };
  return signUp();
}
