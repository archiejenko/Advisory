// Swarms: a business's agents set up together, with the stages work moves through and the numbers on its Floor.
// One source for the API (what a blueprint may contain) and the website (preset cards, the Floor's labels).
import { recommend } from "./modes";

export type Rhythm = "weekdays" | "daily" | "weekly" | "monthly" | "on_demand" | "on_event";
export type SourceKind = "lead" | "invoice" | "message";

/** Which records a stage holds, and when. Stages backed by a source take a card's stage from the record itself. */
export type StageRule =
  | { source: "lead"; status?: string[]; has_email?: boolean }
  | { source: "invoice"; state: Array<"due" | "overdue" | "reminded" | "paid" | "disputed"> }
  | { source: "message"; status: string[] };

export type BlueprintAgent = {
  key: string;                 // unique inside the swarm, e.g. "prospector"
  name: string;                // shown on the station
  role: string;                // one line: what it does here
  template: string;            // a catalogue template key, or "custom"
  instructions?: string;       // custom only: standing orders
  tools?: string[];            // custom only: tool slugs from the registry
  rhythm: Rhythm;
  run_hour?: number;
  reports_to?: string;         // another agent's key; none = reports to the orchestrator
};
export type BlueprintStage = { key: string; name: string; group?: string; agent: string; rule?: StageRule; done?: boolean };
export type Blueprint = {
  name: string;
  sector: string;
  goals: string[];
  agents: BlueprintAgent[];
  stages: BlueprintStage[];
  handoffs: { from: string; to: string; when: string }[];
  kpis: string[];
  skin: "floor" | "calm" | "terminal";
  needs: string[];             // connections it can't work without yet; a swarm with needs can't be created
};

/** The numbers a Floor can show. Each is one query in lib/swarm.ts. */
export const KPIS: Record<string, { label: string; unit: "count" | "pence" | "days" }> = {
  new_leads_week: { label: "New leads this week", unit: "count" },
  emails_sent_week: { label: "Emails sent this week", unit: "count" },
  replies_week: { label: "Replies this week", unit: "count" },
  won_month: { label: "Won this month", unit: "count" },
  pipeline_pence: { label: "Open pipeline", unit: "pence" },
  overdue_pence: { label: "Overdue", unit: "pence" },
  oldest_unpaid_days: { label: "Oldest unpaid", unit: "days" },
  inbox_waiting: { label: "Messages waiting", unit: "count" },
  open_alerts: { label: "Open alerts", unit: "count" },
  tasks_open: { label: "Tasks for you", unit: "count" },
  credits_month: { label: "Credits used this month", unit: "count" },
};

/** Tools every swarm agent gets on top of its own: the work board, handoffs and the CRM. */
export const SWARM_TOOLS = ["list-work", "track-work", "hand-off", "save-contact", "update-deal", "log-activity", "finish-task"];

/** Business-side tools a generated custom role may be given. */
export const CUSTOM_TOOLS = [
  "business-profile", "find-companies", "company-research", "web-research", "read-page", "uk-check", "uk-resolve", "uk-profile",
  "list-leads", "save-lead", "list-invoices", "list-inbox", "triage-message", "propose-email", "create-task", "notify-owner", "recent-activity",
];

/** Runs a month for each rhythm: for the credits preview. */
export const RUNS_A_MONTH: Record<Rhythm, number> = { weekdays: 22, daily: 30, weekly: 4, monthly: 1, on_demand: 8, on_event: 30 };

export type Preset = { key: string; title: string; for: string; summary: string; locked?: string; blueprint: Blueprint };

export const PRESETS: Preset[] = [
  {
    key: "sales-floor", title: "Sales floor", for: "B2B services firms finding new clients",
    summary: "A prospector finds and qualifies companies, Outreach writes to them, Inbox handles the replies, and you get a Monday briefing.",
    blueprint: {
      name: "Sales floor", sector: "B2B services", goals: ["Find companies that fit", "Start conversations", "Turn replies into clients"],
      agents: [
        {
          key: "prospector", name: "Prospector", role: "Finds companies that fit and qualifies them", template: "custom", rhythm: "weekdays", run_hour: 7,
          tools: ["business-profile", "find-companies", "company-research", "read-page", "list-leads", "save-lead", "create-task"],
          instructions: `You find new prospects for a small UK business. Each run:
1. Read the business profile.
2. find-companies for up to 3 companies that match the ideal customer; skip any already in list-leads.
3. For each, company-research, then read-page on its website. Note one specific reason it would buy.
4. save-lead with the published business email if there is one (never guess an address), save-contact for any named contact on the site, and log-activity with your reason.
5. If a lead has an email, hand-off the lead's card to outreach with your reason as the note. If not, create-task for the owner to find a contact.
Finish with a one-line summary.`,
        },
        { key: "outreach", name: "Outreach", role: "Writes first emails and one follow-up", template: "outreach", rhythm: "weekdays", run_hour: 9 },
        { key: "inbox", name: "Inbox", role: "Answers replies and enquiries", template: "inbox", rhythm: "on_event" },
        { key: "briefing", name: "Briefing", role: "Monday note on what moved", template: "briefing", rhythm: "weekly", run_hour: 7 },
      ],
      stages: [
        { key: "found", name: "Found", agent: "prospector", rule: { source: "lead", status: ["new"], has_email: false } },
        { key: "qualified", name: "Qualified", agent: "outreach", rule: { source: "lead", status: ["new"], has_email: true } },
        { key: "contacted", name: "Contacted", agent: "outreach", rule: { source: "lead", status: ["contacted"] } },
        { key: "replied", name: "Replied", agent: "inbox", rule: { source: "lead", status: ["replied"] } },
        { key: "won", name: "Won", agent: "inbox", rule: { source: "lead", status: ["won"] }, done: true },
      ],
      handoffs: [{ from: "prospector", to: "outreach", when: "A qualified lead has a published email" }, { from: "outreach", to: "inbox", when: "The lead replies" }],
      kpis: ["new_leads_week", "emails_sent_week", "replies_week", "won_month"],
      skin: "floor", needs: [],
    },
  },
  {
    key: "back-office", title: "Back office", for: "Agencies, MSPs and trades running admin and cash",
    summary: "Inbox triages every enquiry, Credit control chases what you're owed, Customer watch flags trouble at the companies you deal with, and a Monday briefing pulls it together.",
    blueprint: {
      name: "Back office", sector: "Services", goals: ["Get paid on time", "Answer every enquiry", "Spot trouble early"],
      agents: [
        { key: "inbox", name: "Inbox", role: "Sorts enquiries and drafts replies", template: "inbox", rhythm: "on_event" },
        { key: "credit", name: "Credit control", role: "Chases overdue invoices politely", template: "credit-control", rhythm: "weekdays", run_hour: 9 },
        { key: "watch", name: "Customer watch", role: "Watches customers and suppliers on the registers", template: "customer-watch", rhythm: "on_event" },
        { key: "briefing", name: "Briefing", role: "Monday note on cash and inbox", template: "briefing", rhythm: "weekly", run_hour: 7 },
      ],
      stages: [
        { key: "due", name: "Due", group: "Cash", agent: "credit", rule: { source: "invoice", state: ["due"] } },
        { key: "overdue", name: "Overdue", group: "Cash", agent: "credit", rule: { source: "invoice", state: ["overdue", "disputed"] } },
        { key: "reminded", name: "Reminded", group: "Cash", agent: "credit", rule: { source: "invoice", state: ["reminded"] } },
        { key: "paid", name: "Paid", group: "Cash", agent: "credit", rule: { source: "invoice", state: ["paid"] }, done: true },
        { key: "new", name: "New", group: "Inbox", agent: "inbox", rule: { source: "message", status: ["new"] } },
        { key: "triaged", name: "Triaged", group: "Inbox", agent: "inbox", rule: { source: "message", status: ["triaged"] } },
        { key: "answered", name: "Answered", group: "Inbox", agent: "inbox", rule: { source: "message", status: ["replied"] }, done: true },
      ],
      handoffs: [{ from: "inbox", to: "credit", when: "A customer writes about an invoice" }],
      kpis: ["overdue_pence", "oldest_unpaid_days", "inbox_waiting", "open_alerts"],
      skin: "calm", needs: [],
    },
  },
  {
    key: "markets-desk", title: "Markets desk", for: "Investors and analysts who want research, not execution",
    summary: "A scanner watches news and filings, an analyst writes theses, a risk monitor tracks a paper portfolio. Research and paper trading only.",
    locked: "Needs a market-data connection, which isn't available yet.",
    blueprint: {
      name: "Markets desk", sector: "Investing research", goals: ["Spot signals early", "Write clear theses", "Track a paper portfolio"],
      agents: [
        { key: "scanner", name: "Scanner", role: "Watches news and filings for the watchlist", template: "custom", rhythm: "daily", tools: ["web-research", "read-page", "uk-check", "create-task"], instructions: "Scan news and filings for the watchlist and record signals with track-work." },
        { key: "analyst", name: "Analyst", role: "Turns signals into a written thesis", template: "custom", rhythm: "on_demand", tools: ["web-research", "read-page", "company-research", "create-task"], instructions: "Write a short, sourced thesis for each signal handed to you. Never recommend a trade." },
        { key: "risk", name: "Risk monitor", role: "Tracks paper positions and exposure", template: "custom", rhythm: "daily", tools: ["create-task", "notify-owner"], instructions: "Review paper positions and flag concentration or large moves." },
      ],
      stages: [
        { key: "watch", name: "Watch", agent: "scanner" }, { key: "signal", name: "Signal", agent: "scanner" },
        { key: "thesis", name: "Thesis", agent: "analyst" }, { key: "paper", name: "Paper position", agent: "risk" },
        { key: "closed", name: "Closed", agent: "risk", done: true },
      ],
      handoffs: [{ from: "scanner", to: "analyst", when: "A signal is worth a thesis" }, { from: "analyst", to: "risk", when: "A thesis becomes a paper position" }],
      kpis: ["tasks_open", "credits_month"],
      skin: "terminal", needs: ["Market data"],
    },
  },
];

export const preset = (key: string) => PRESETS.find((p) => p.key === key);

/** An invoice's state for stage rules: paid, disputed, reminded (chased at least once), overdue or due. */
export function invoiceState(i: { status: string; reminders: number; due_date: string }, today = new Date().toISOString().slice(0, 10)) {
  if (i.status === "paid") return "paid";
  if (i.status === "disputed") return "disputed";
  if (i.reminders > 0) return "reminded";
  return i.due_date < today ? "overdue" : "due";
}

/** Which stage a record belongs in, by the blueprint's rules (first match wins), or null for none. */
export function stageFor(stages: BlueprintStage[], kind: SourceKind, rec: any): BlueprintStage | null {
  for (const s of stages) {
    const r = s.rule;
    if (!r || r.source !== kind) continue;
    if (r.source === "lead") {
      if (r.status && !r.status.includes(rec.status)) continue;
      if (r.has_email !== undefined && !!rec.email !== r.has_email) continue;
      return s;
    }
    if (r.source === "invoice" && r.state.includes(invoiceState(rec) as any)) return s;
    if (r.source === "message" && r.status.includes(rec.status)) return s;
  }
  return null;
}

/** The closest preset to a description, when generation isn't available or fails. */
export function nearestPreset(description: string): Preset {
  const d = description.toLowerCase();
  if (/\b(trad(e|ing)|stocks?|shares|invest|portfolio|crypto|forex|markets?)\b/.test(d) && !/\btrades?(man|people|person)\b/.test(d)) return preset("markets-desk")!;
  if (/(invoice|payment|paid|cash|credit|admin|chase|enquir|inbox|support|bookkeep|accounts? receivable|msp|it support)/.test(d)) return preset("back-office")!;
  return preset("sales-floor")!;
}

/** Expected credits a month for a blueprint, for the preview: each agent's runs in the mode its job suits, mid-range. */
export function estimateCredits(b: Pick<Blueprint, "agents">) {
  return b.agents.reduce((n, a) => {
    const r = recommend({ template: a.template, text: a.template === "custom" ? `${a.role} ${a.instructions || ""}` : null });
    return n + RUNS_A_MONTH[a.rhythm] * (r.low + r.high) / 2;
  }, 0) | 0;
}

/** Every swarm is led by an orchestrator. Blueprints without one get this one at the top. */
export const ORCHESTRATOR_AGENT: BlueprintAgent = { key: "orchestrator", name: "Orchestrator", role: "Breaks goals into tasks, assigns them and checks they finish", template: "orchestrator", rhythm: "weekdays", run_hour: 8 };
export function withOrchestrator(b: Blueprint): Blueprint {
  return b.agents.some((a) => a.template === "orchestrator") ? b : { ...b, agents: [ORCHESTRATOR_AGENT, ...b.agents] };
}
