// The business's own OS: which apps it runs here, which it outsources or keeps elsewhere, which features
// are on inside each app, and how much the AI Team may do on its own. One source for the API (what agents
// may touch) and the web (the OS Builder, the dock, the landing page).
import { FACETS, KINDS, CATEGORIES, ALWAYS_ON_AREA, facet, type Depth, type Kind } from "./os";

/** here: run in the OS. outsourced: a provider does it, we keep the handover. external: kept in another system, reference only. off: not used. */
export type Mode = "here" | "outsourced" | "external" | "off";
/** suggest: the AI Team drafts, people do. approve: the AI Team does, a person approves anything that leaves the business. auto: runs on its own inside the guardrails. */
export type Autonomy = "suggest" | "approve" | "auto";
export const MODES: Mode[] = ["here", "outsourced", "external", "off"];
export const AUTONOMY: Autonomy[] = ["suggest", "approve", "auto"];
export const MODE_LABEL: Record<Mode, string> = { here: "Run it here", outsourced: "Outsourced", external: "Keep my current tool", off: "Off" };
/** Areas where a person always decides: the AI Team can help, but never acts on its own. */
export const NEVER_AUTO = ["complaints", "employee-relations", "whistleblowing"];
export const AUTONOMY_LABEL: Record<Autonomy, string> = { suggest: "Suggest", approve: "Approve", auto: "Run on its own" };

export type Feature = { key: string; label: string; depth: Depth; default: boolean };
export type Provider = { name?: string; email?: string; notes?: string };
export type ModuleConfig = { key: string; mode: Mode; features: string[]; autonomy: Autonomy; provider?: Provider; position: number };
export type CustomField = { id?: string; module: string; key: string; label: string; type: "text" | "date" | "money" | "long" | "url" | "number" | "choice"; options?: string[] };
export type CustomApp = { id?: string; key: string; name: string; kind: Kind; category: string; statuses?: string[] };
export type OsConfig = { pack: string; theme: Theme; ai_paused: boolean; modules: ModuleConfig[]; version?: number };
export type Theme = "dark" | "calm" | "terminal" | "light";
export const THEMES: { key: Theme; name: string }[] = [
  { key: "dark", name: "Dark" }, { key: "calm", name: "Calm" }, { key: "terminal", name: "Terminal" }, { key: "light", name: "Light" },
];

/** Things no setting turns on. Enforced in the API, not just promised here. */
export const GUARDRAILS = [
  "Never moves money: payments, payouts and refunds are always a person's decision.",
  "Never deletes a record: agents add and update; people archive.",
  "Never emails an address that isn't already on a record in your OS.",
  "Hands over to outsourced providers only as drafts a person approves.",
];

const f = (key: string, label: string, depth: Depth = "basic", on = true): Feature => ({ key, label, depth, default: on });

/** The common features every app of a kind has. The first is the app's core and carries the app's own depth. */
const KIND_FEATURES: Record<Kind, Feature[]> = {
  item: [f("records", "Records, list and board views"), f("owners", "Owners and due dates"), f("checklists", "Checklists"), f("reminders", "Reminders and nudges"), f("attachments", "Files on each record", "basic", false), f("agent-updates", "AI Team keeps it up to date")],
  deal: [f("records", "Pipeline of records"), f("stages", "Stages you can rename"), f("values", "Values and close dates"), f("follow-ups", "Follow-up reminders"), f("history", "Email and call history", "basic", false), f("agent-updates", "AI Team keeps it up to date")],
  money: [f("records", "Entries with amounts and dates"), f("statuses", "Draft, sent, paid and overdue"), f("parties", "Linked to customers or suppliers"), f("reminders", "Due-date reminders"), f("export", "Export to CSV and Excel"), f("agent-updates", "AI Team keeps it up to date")],
  person: [f("records", "One record per person"), f("roles", "Roles and teams"), f("dates", "Key dates and reminders"), f("documents", "Documents on file", "basic", false), f("self-service", "People update their own details", "basic", false), f("agent-updates", "AI Team keeps it up to date")],
  doc: [f("records", "Document register"), f("reviews", "Review and expiry dates"), f("links", "Links to the file"), f("versions", "Version notes", "basic", false), f("sign-off", "Sign-off by a named person", "basic", false), f("agent-updates", "AI Team watches renewals")],
  asset: [f("records", "Asset register"), f("locations", "Where each one is"), f("service", "Service and inspection dates"), f("owners", "Who looks after it"), f("history", "Service history", "basic", false), f("agent-updates", "AI Team books the next check")],
  event: [f("records", "Calendar of events"), f("confirm", "Confirmations and cancellations"), f("reminders", "Reminders to people"), f("locations", "Places and rooms"), f("recurring", "Repeating events", "basic", false), f("agent-updates", "AI Team handles the back-and-forth")],
  metric: [f("records", "Measures with targets"), f("periods", "Weekly, monthly and quarterly periods"), f("alerts", "Alerts when off track"), f("charts", "Charts on your dashboard"), f("notes", "Commentary on each period", "basic", false), f("agent-updates", "AI Team writes the commentary")],
  case: [f("records", "Cases with priority and owner"), f("statuses", "New, open, waiting, resolved"), f("assign", "Assignment rules"), f("templates", "Reply templates"), f("timers", "Response-time targets", "basic", false), f("agent-updates", "AI Team triages new cases")],
};

/** The granular features of the apps a business leans on hardest. Others use their kind's set. */
const SPECIFIC: Record<string, Feature[]> = {
  "ledger-and-bookkeeping": [f("chart-of-accounts", "Chart of accounts"), f("journals", "Journals and adjustments"), f("categorise", "Transaction categorising"), f("trial-balance", "Trial balance"), f("analytic", "Departments and cost centres", "basic", false), f("lock-dates", "Period lock dates"), f("budgets", "Budgets against actuals", "basic", false), f("agent-updates", "AI Team suggests categories")],
  "bank-feeds-and-reconciliation": [f("statements", "Statement import (CSV, OFX)"), f("match", "Match to invoices and bills"), f("rules", "Bank rules"), f("multi-account", "Several bank accounts"), f("feeds", "Live bank feeds", "basic", false), f("agent-updates", "AI Team proposes matches")],
  "sales-invoicing": [f("invoices", "Invoices and credit notes", "partial"), f("recurring", "Repeating invoices"), f("templates", "Branded templates"), f("vat", "VAT on each line"), f("pay-links", "Pay-by-link on invoices", "basic", false), f("deposits", "Deposits and part payments", "basic", false), f("e-invoicing", "E-invoicing (Peppol)", "basic", false), f("agent-updates", "AI Team drafts from jobs and timesheets")],
  "credit-control": [f("chasers", "Polite chasers, then firmer", "full"), f("statements", "Customer statements"), f("promises", "Promise-to-pay tracking"), f("aged-debt", "Aged debt report"), f("holds", "Account holds", "basic", false), f("late-interest", "Late payment interest notices", "basic", false), f("agent-updates", "AI Team chases on schedule")],
  "bills-and-payables": [f("capture", "Bill capture from email"), f("approve", "Approval before payment"), f("due", "Due dates and payment runs"), f("match", "Match to purchase orders", "basic", false), f("duplicates", "Duplicate bill check"), f("agent-updates", "AI Team reads and files bills")],
  "expenses-and-receipts": [f("receipts", "Receipt capture from phone"), f("claims", "Expense claims"), f("mileage", "Mileage at HMRC rates"), f("approve", "Manager approval"), f("cards", "Company card matching", "basic", false), f("agent-updates", "AI Team reads receipts")],
  "vat-returns": [f("boxes", "Nine-box return prepared"), f("schemes", "Standard, flat rate and cash schemes"), f("review", "Review before filing"), f("deadlines", "Deadline reminders"), f("agent-updates", "AI Team prepares, a person files")],
  "payroll": [f("runs", "Pay run preparation"), f("payslips", "Payslips"), f("starters", "Starters and leavers"), f("statutory", "Statutory pay (SSP, SMP)"), f("deductions", "Deductions and student loans"), f("bureau-handover", "Handover pack for a payroll bureau"), f("agent-updates", "AI Team prepares, a person submits")],
  "pensions": [f("enrolment", "Auto-enrolment assessment"), f("contributions", "Contribution schedules"), f("opt-outs", "Opt-outs and re-enrolment"), f("agent-updates", "AI Team tracks deadlines")],
  "pipeline-and-crm": [f("contacts", "Companies and contacts", "partial"), f("pipeline", "Deals pipeline", "partial"), f("activities", "Calls, meetings and notes"), f("tags", "Tags and segments"), f("import", "Import from CSV and Excel", "partial"), f("duplicates", "Duplicate merge", "basic", false), f("register", "Companies House enrichment", "partial"), f("agent-updates", "AI Team logs every touch")],
  "lead-generation": [f("register-search", "Search the Companies House register", "full"), f("research", "Research each company", "full"), f("contacts", "Published business contacts only", "full"), f("scoring", "Fit scoring"), f("agent-updates", "AI Team finds leads weekly", "full")],
  "outreach-and-follow-up": [f("first-email", "Personal first emails", "full"), f("follow-up", "One follow-up", "full"), f("approval", "Approval before sending", "full"), f("replies", "Replies become leads", "full"), f("unsubscribe", "Unsubscribe handling", "full"), f("agent-updates", "AI Team drafts and sends", "full")],
  "quotes-and-proposals": [f("quotes", "Quotes with line items"), f("templates", "Proposal templates"), f("options", "Optional extras", "basic", false), f("accept", "Accept online", "basic", false), f("convert", "Turn into a job and invoice"), f("agent-updates", "AI Team drafts quotes")],
  "shared-inbox-and-tickets": [f("inbox", "Shared inbox", "partial"), f("triage", "Triage and labels", "partial"), f("assign", "Assign to a person or agent"), f("drafts", "Reply drafts", "partial"), f("sla", "Response targets", "basic", false), f("agent-updates", "AI Team triages new mail", "partial")],
  "projects-and-jobs": [f("projects", "Projects and jobs", "partial"), f("tasks", "Tasks and sub-tasks", "partial"), f("board", "Board and timeline"), f("time", "Time tracking"), f("budget", "Budget against actual", "basic", false), f("client-view", "Client view", "basic", false), f("agent-updates", "AI Team chases overdue tasks")],
  "bookings-and-scheduling": [f("calendar", "Booking calendar"), f("online", "Online booking page", "basic", false), f("reminders", "Text and email reminders"), f("deposits", "Deposits", "basic", false), f("resources", "Rooms and staff"), f("agent-updates", "AI Team handles reschedules")],
  "field-service-and-dispatch": [f("jobs", "Jobs on a map"), f("dispatch", "Dispatch to engineers"), f("mobile", "Job sheets on the phone"), f("signatures", "Customer signatures"), f("photos", "Before and after photos"), f("agent-updates", "AI Team plans the day")],
  "stock-and-inventory": [f("items", "Products and variants"), f("levels", "Stock levels by location"), f("reorder", "Reorder points"), f("barcodes", "Barcodes", "basic", false), f("batches", "Batches and serial numbers", "basic", false), f("valuation", "Stock valuation", "basic", false), f("agent-updates", "AI Team flags low stock")],
  "purchasing-and-orders": [f("orders", "Purchase orders"), f("approve", "Approval limits"), f("receive", "Goods received"), f("suppliers", "Preferred suppliers"), f("agent-updates", "AI Team drafts reorders")],
  "rota-and-shifts": [f("rota", "Weekly rota"), f("swaps", "Shift swaps"), f("availability", "Availability"), f("costs", "Labour cost against sales", "basic", false), f("publish", "Publish to phones"), f("agent-updates", "AI Team fills gaps")],
  "employee-records": [f("records", "Employee records", "partial"), f("contracts", "Contracts and documents"), f("emergency", "Emergency contacts"), f("right-to-work", "Right to work checks"), f("agent-updates", "AI Team watches expiries")],
  "absence-and-holiday": [f("requests", "Holiday requests"), f("allowances", "Allowances and carry-over"), f("sickness", "Sickness records"), f("calendar", "Team calendar"), f("agent-updates", "AI Team approves within rules")],
  "recruitment": [f("roles", "Open roles"), f("applicants", "Applicant pipeline"), f("interviews", "Interview scheduling"), f("offers", "Offer letters"), f("job-boards", "Post to job boards", "basic", false), f("agent-updates", "AI Team screens and schedules")],
  "online-shop": [f("products", "Product pages"), f("cart", "Basket and checkout", "basic", false), f("orders", "Orders into stock and invoicing"), f("discounts", "Discount codes", "basic", false), f("shipping", "Shipping rates"), f("agent-updates", "AI Team writes product copy")],
  "point-of-sale-shop": [f("till", "Till screen"), f("cash-up", "Cash-up"), f("receipts", "Receipts"), f("stock", "Stock updates"), f("card-reader", "Card reader", "basic", false), f("agent-updates", "AI Team checks the cash-up")],
  "point-of-sale-restaurant": [f("tables", "Table plan"), f("orders", "Orders and courses"), f("kitchen", "Kitchen tickets"), f("splits", "Split bills"), f("tips", "Tips"), f("allergens", "Allergens on every dish"), f("agent-updates", "AI Team summarises each service")],
  "manufacturing": [f("bom", "Bills of materials"), f("work-orders", "Work orders"), f("routing", "Routings and work centres", "basic", false), f("scrap", "Scrap and yield"), f("agent-updates", "AI Team plans production")],
  "studio": [f("fields", "Custom fields on any app"), f("apps", "Build a new app"), f("statuses", "Custom statuses"), f("views", "Saved views", "basic", false), f("forms", "Public forms", "basic", false), f("agent-updates", "AI Team learns your fields")],
  "email-campaigns": [f("lists", "Lists and segments"), f("editor", "Email editor"), f("consent", "Consent records"), f("reports", "Opens and clicks"), f("agent-updates", "AI Team drafts campaigns")],
  "reviews-and-reputation": [f("requests", "Review requests"), f("replies", "Reply drafts"), f("alerts", "Bad-review alerts"), f("agent-updates", "AI Team drafts replies")],
  "health-and-safety": [f("risk-assessments", "Risk assessments"), f("accidents", "Accident book"), f("riddor", "RIDDOR reminders"), f("inspections", "Inspections"), f("agent-updates", "AI Team tracks reviews")],
};

export function featuresOf(key: string): Feature[] {
  const fc = facet(key);
  if (!fc) return [];
  if (SPECIFIC[key]) return SPECIFIC[key];
  return KIND_FEATURES[fc.kind].map((x, i) => (i === 0 ? { ...x, depth: fc.depth } : x));
}
export const defaultFeatures = (key: string) => featuresOf(key).filter((x) => x.default).map((x) => x.key);

/** An app that leans on another: turning it on offers to turn the other on too. */
export const DEPENDS: Record<string, string[]> = {
  "credit-control": ["sales-invoicing"],
  "vat-returns": ["ledger-and-bookkeeping"],
  "management-accounts": ["ledger-and-bookkeeping"],
  "bank-feeds-and-reconciliation": ["ledger-and-bookkeeping"],
  "year-end-and-corporation-tax": ["ledger-and-bookkeeping"],
  "supplier-payments": ["bills-and-payables"],
  "fraud-and-bank-detail-checks": ["bills-and-payables"],
  "payroll": ["employee-records"],
  "pensions": ["payroll"],
  "commission-and-bonuses": ["payroll"],
  "timesheets-and-overtime": ["employee-records"],
  "rota-and-shifts": ["employee-records"],
  "absence-and-holiday": ["employee-records"],
  "outreach-and-follow-up": ["pipeline-and-crm"],
  "quotes-and-proposals": ["pipeline-and-crm"],
  "sales-forecasting": ["pipeline-and-crm"],
  "job-costing": ["projects-and-jobs"],
  "field-service-and-dispatch": ["bookings-and-scheduling"],
  "warehouse-and-fulfilment": ["stock-and-inventory"],
  "online-shop": ["stock-and-inventory", "sales-invoicing"],
  "point-of-sale-shop": ["stock-and-inventory"],
  "manufacturing": ["stock-and-inventory"],
  "purchasing-and-orders": ["supplier-management"],
  "marketing-automation": ["email-campaigns"],
  "subscriptions-and-recurring-billing": ["sales-invoicing"],
};

/** Industry packs: where a new business starts in the OS Builder. Everything else starts off. */
export type Pack = { key: string; name: string; blurb: string; here: string[]; outsourced?: string[] };
const CORE = ["pipeline-and-crm", "sales-invoicing", "credit-control", "shared-inbox-and-tickets", "one-task-list-for-people-and-agents", "approvals-routing", "team-chat-and-channels", "dashboards", "documents"];
export const PACKS: Pack[] = [
  { key: "trades", name: "Trades and field service", blurb: "Quotes, jobs, dispatch and getting paid", here: [...CORE, "quotes-and-proposals", "projects-and-jobs", "bookings-and-scheduling", "field-service-and-dispatch", "job-costing", "expenses-and-receipts", "fleet-and-vehicles", "health-and-safety", "reviews-and-reputation", "stock-and-inventory"], outsourced: ["payroll", "vat-returns", "year-end-and-corporation-tax"] },
  { key: "clinics", name: "Clinics and practices", blurb: "Bookings, reminders, records and reviews", here: [...CORE, "bookings-and-scheduling", "customer-portal", "knowledge-base", "complaints", "data-protection", "rota-and-shifts", "absence-and-holiday", "reviews-and-reputation", "licences-and-certifications"], outsourced: ["payroll", "year-end-and-corporation-tax"] },
  { key: "agencies", name: "Agencies and studios", blurb: "Pipeline, proposals, projects and timesheets", here: [...CORE, "lead-generation", "outreach-and-follow-up", "quotes-and-proposals", "contracts-and-e-signature", "projects-and-jobs", "timesheets-and-overtime", "job-costing", "brand-and-assets", "seo-and-content", "social-media"], outsourced: ["payroll", "year-end-and-corporation-tax"] },
  { key: "accountants", name: "Accountants and bookkeepers", blurb: "Client work, deadlines and the books", here: [...CORE, "ledger-and-bookkeeping", "bank-feeds-and-reconciliation", "vat-returns", "management-accounts", "year-end-and-corporation-tax", "accountant-access", "projects-and-jobs", "timesheets-and-overtime", "contract-repository", "data-protection"] },
  { key: "retail", name: "Retail and online shops", blurb: "Stock, tills, the shop and returns", here: [...CORE, "stock-and-inventory", "purchasing-and-orders", "supplier-management", "point-of-sale-shop", "online-shop", "returns-and-warranty", "shipping-and-logistics", "email-campaigns", "rota-and-shifts", "reviews-and-reputation"], outsourced: ["payroll"] },
  { key: "hospitality", name: "Cafés, bars and restaurants", blurb: "Tables, tills, rotas and suppliers", here: [...CORE, "point-of-sale-restaurant", "bookings-and-scheduling", "rota-and-shifts", "time-and-attendance", "stock-and-inventory", "purchasing-and-orders", "health-and-safety", "licences-and-certifications", "reviews-and-reputation", "social-media"], outsourced: ["payroll", "vat-returns"] },
  { key: "it-services", name: "IT and managed services", blurb: "Tickets, contracts, devices and renewals", here: [...CORE, "service-levels", "it-helpdesk", "devices-and-software", "subscriptions-and-recurring-billing", "contracts-and-e-signature", "contract-repository", "projects-and-jobs", "timesheets-and-overtime", "security-monitoring", "knowledge-base"], outsourced: ["payroll"] },
  { key: "blank", name: "Start from blank", blurb: "Pick every app yourself", here: ["one-task-list-for-people-and-agents", "team-chat-and-channels"] },
];
export const pack = (key: string) => PACKS.find((p) => p.key === key);

/** Apps a business can place: everything except the always-on agent platform. */
export const BUILDER_APPS = FACETS.filter((x) => x.area !== ALWAYS_ON_AREA);
export const ALWAYS_ON = FACETS.filter((x) => x.area === ALWAYS_ON_AREA).map((x) => x.key);

export function configFromPack(key: string): OsConfig {
  const p = pack(key) || pack("blank")!;
  const modules: ModuleConfig[] = [];
  const add = (k: string, mode: Mode) => {
    if (!facet(k) || modules.some((m) => m.key === k)) return;
    modules.push({ key: k, mode, features: defaultFeatures(k), autonomy: "approve", position: modules.length });
  };
  p.here.forEach((k) => add(k, "here"));
  (p.outsourced || []).forEach((k) => add(k, "outsourced"));
  return { pack: p.key, theme: "dark", ai_paused: false, modules };
}

export type Problem = { module: string; code: "unknown_app" | "unknown_feature" | "needs" | "always_on" | "duplicate" | "never_auto"; detail: string; needs?: string[] };
/** Checks a config before it's saved. Unknown apps and features are errors; a missing dependency is a warning the builder offers to fix. */
export function validateConfig(cfg: Pick<OsConfig, "modules">) {
  const errors: Problem[] = []; const warnings: Problem[] = [];
  const seen = new Set<string>();
  const active = new Set(cfg.modules.filter((m) => m.mode !== "off").map((m) => m.key));
  for (const m of cfg.modules) {
    const fc = facet(m.key);
    if (!fc) { errors.push({ module: m.key, code: "unknown_app", detail: `There's no app called ${m.key}.` }); continue; }
    if (seen.has(m.key)) errors.push({ module: m.key, code: "duplicate", detail: `${fc.app} is in the OS twice.` });
    seen.add(m.key);
    if (fc.area === ALWAYS_ON_AREA) errors.push({ module: m.key, code: "always_on", detail: `${fc.app} is always on.` });
    const known = new Set(featuresOf(m.key).map((x) => x.key));
    for (const x of m.features) if (!known.has(x)) errors.push({ module: m.key, code: "unknown_feature", detail: `${fc.app} has no feature called ${x}.` });
    if (m.autonomy === "auto" && NEVER_AUTO.includes(m.key)) errors.push({ module: m.key, code: "never_auto", detail: `${fc.app} can't run on its own: a person always decides there.` });
    if (m.mode === "here") {
      const missing = (DEPENDS[m.key] || []).filter((d) => !active.has(d));
      if (missing.length) warnings.push({ module: m.key, code: "needs", detail: `${fc.app} works best with ${missing.map((d) => facet(d)!.app).join(" and ")}.`, needs: missing });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** What a module's mode lets an agent do there. */
export const canRead = (mode: Mode | undefined) => mode === undefined || mode === "here" || mode === "outsourced" || mode === "external";
export const canWrite = (mode: Mode | undefined, autonomy?: Autonomy) => (mode === undefined || mode === "here" || mode === "outsourced") && autonomy !== "suggest";

/** Built-in tools that only make sense when one of these modules is in use. Tools not listed are always available. */
export const TOOL_MODULES: Record<string, string[]> = {
  "list-leads": ["lead-generation", "pipeline-and-crm", "outreach-and-follow-up"],
  "save-lead": ["lead-generation", "pipeline-and-crm", "outreach-and-follow-up"],
  "find-companies": ["lead-generation", "outreach-and-follow-up", "supplier-management", "pipeline-and-crm"],
  "list-invoices": ["sales-invoicing", "credit-control"],
  "list-inbox": ["shared-inbox-and-tickets"],
  "triage-message": ["shared-inbox-and-tickets"],
};
/** Which modules each built-in agent works in. An agent whose modules are all off is paused by the OS. */
export const TEMPLATE_MODULES: Record<string, string[]> = {
  outreach: ["outreach-and-follow-up", "lead-generation"],
  inbox: ["shared-inbox-and-tickets"],
  "credit-control": ["credit-control", "sales-invoicing"],
  "customer-watch": ["supplier-management", "risk-register", "pipeline-and-crm"],
  "customer-check": ["fraud-and-bank-detail-checks", "pipeline-and-crm"],
  "lead-finder": ["lead-generation"],
  bookings: ["bookings-and-scheduling"],
  reviews: ["reviews-and-reputation"],
  social: ["social-media"],
  bookkeeping: ["ledger-and-bookkeeping"],
};

export type Resolved = { mode: Mode; autonomy: Autonomy } | undefined;
/** The module's setting in a saved OS, or undefined when the business hasn't built one (everything on, as before). */
export function moduleSetting(cfg: Pick<OsConfig, "modules"> | null | undefined, key: string): Resolved {
  if (!cfg) return undefined;
  if (ALWAYS_ON.includes(key)) return { mode: "here", autonomy: "approve" };
  const m = cfg.modules.find((x) => x.key === key);
  if (!m) return { mode: "off", autonomy: "suggest" };
  return { mode: m.mode, autonomy: m.autonomy === "auto" && NEVER_AUTO.includes(key) ? "approve" : m.autonomy };
}
const usable = (cfg: Pick<OsConfig, "modules"> | null | undefined, key: string) => { const s = moduleSetting(cfg, key); return !s || s.mode === "here"; };
export function toolAllowed(cfg: Pick<OsConfig, "modules"> | null | undefined, slug: string) {
  const need = TOOL_MODULES[slug];
  return !cfg || !need || need.some((k) => usable(cfg, k));
}
export function templateAllowed(cfg: Pick<OsConfig, "modules"> | null | undefined, template: string) {
  const need = TEMPLATE_MODULES[template];
  return !cfg || !need || need.some((k) => usable(cfg, k));
}
/** The autonomy the OS allows a template across the modules it works in: the most permissive of them. */
export function templateAutonomy(cfg: Pick<OsConfig, "modules"> | null | undefined, template: string): Autonomy | undefined {
  const need = TEMPLATE_MODULES[template];
  if (!cfg || !need) return undefined;
  const rank = { suggest: 0, approve: 1, auto: 2 } as const;
  let best: Autonomy | undefined;
  for (const k of need) { const s = moduleSetting(cfg, k); if (s?.mode === "here" && (!best || rank[s.autonomy] > rank[best])) best = s.autonomy; }
  return best;
}
/** An agent's own autonomy, capped by the OS: approve_all, approve_first or auto. The stricter of the two wins. */
export function effectiveAutonomy(agent: string, os: Autonomy | undefined, paused = false): string {
  if (paused) return "approve_all";
  if (!os || os === "auto") return agent;
  return "approve_all";
}

/** The plan that fits, and a rough count of monthly actions, from the apps placed and the people using them. */
export function estimate(cfg: Pick<OsConfig, "modules">, people = 5) {
  const here = cfg.modules.filter((m) => m.mode === "here");
  const weight = { suggest: 15, approve: 40, auto: 120 } as const;
  const actions = here.reduce((n, m) => n + weight[m.autonomy], 0) + cfg.modules.filter((m) => m.mode === "outsourced").length * 10;
  const plan = people > 25 || actions > 2000 ? "scale" : people > 3 || actions > 500 ? "growth" : "starter";
  return { plan, apps: here.length, outsourced: cfg.modules.filter((m) => m.mode === "outsourced").length, actions };
}

/** The library as the builder shows it: categories of apps, each with its features. */
export const LIBRARY = CATEGORIES.map((c) => ({
  ...c,
  apps: BUILDER_APPS.filter((x) => c.areas.includes(x.area)).map((x) => ({ key: x.key, app: x.app, name: x.name, depth: x.depth, kind: x.kind, agent: x.agent, optimal: x.optimal, features: featuresOf(x.key) })),
}));
export const KIND_FIELDS = (k: Kind) => KINDS[k].fields;
