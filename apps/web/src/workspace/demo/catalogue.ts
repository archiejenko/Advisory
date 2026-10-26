// The four hubs and the apps inside them. One list drives the shell's tabs, the Setup library and the /os explainer.
// status: "built" has its own screen; "table" uses the standard hub table; "soon" only shows in Setup as Available soon.
import type { HubId, InstalledApp, OsConfig } from "./types";

export type AppDef = {
  key: string; hub: HubId; name: string; accountantName?: string; icon: string; agentId: string | null;
  blurb: string; features: string[]; users: string; status: "built" | "table" | "soon";
};
export type HubDef = { id: HubId; name: string; icon: string; purpose: string };

export const HUBS: HubDef[] = [
  { id: "customers", name: "Customers", icon: "Users", purpose: "Leads, quotes and every conversation with the people you work for." },
  { id: "money", name: "Money", icon: "PoundSterling", purpose: "What you're owed, what you owe and the cash in the bank." },
  { id: "work", name: "Work", icon: "ClipboardList", purpose: "Jobs, the rota and everything that needs doing." },
  { id: "team", name: "Team", icon: "UsersRound", purpose: "Your people and your agents, and where they talk." },
];

export const APPS: AppDef[] = [
  // Customers
  { key: "pipeline", hub: "customers", name: "Pipeline", icon: "KanbanSquare", agentId: "agt_sales", status: "built", users: "Dana", blurb: "Every deal by stage, with a forecast.", features: ["Board by stage", "Forecast by stage", "Next step on every deal", "Drag to move a deal"] },
  { key: "leads", hub: "customers", name: "Leads", icon: "Target", agentId: "agt_sales", status: "built", users: "Dana", blurb: "Companies that fit, found and researched for you.", features: ["Found on Companies House and the web", "Researched before first contact", "Nobody emailed twice"] },
  { key: "quotes", hub: "customers", name: "Quotes", icon: "FileText", agentId: "agt_sales", status: "built", users: "Dana", blurb: "Quotes built from your price list and followed up.", features: ["Priced from your rates", "Sent from your address", "Follow-ups after 5 days"] },
  { key: "inbox", hub: "customers", name: "Inbox", icon: "Inbox", agentId: "agt_cs", status: "built", users: "Dana and Sam", blurb: "Every email, web form and call note in one helpdesk.", features: ["New, open, waiting and resolved", "Replies drafted for you", "Linked to the customer"] },
  { key: "complaints", hub: "customers", name: "Complaints", icon: "MessageSquareWarning", agentId: "agt_cs", status: "table", users: "Sam", blurb: "Complaints logged, owned and closed.", features: ["One owner per complaint", "Linked to the site and job"] },
  { key: "campaigns", hub: "customers", name: "Campaigns", icon: "Megaphone", agentId: "agt_sales", status: "soon", users: "Dana", blurb: "Newsletters and seasonal offers.", features: ["Lists from your customers", "Unsubscribes handled"] },
  { key: "reviews", hub: "customers", name: "Reviews", icon: "Star", agentId: "agt_cs", status: "soon", users: "Dana", blurb: "Google reviews answered.", features: ["Replies drafted", "Bad reviews flagged"] },
  // Money
  { key: "invoices", hub: "money", name: "Invoices", accountantName: "Sales invoices", icon: "ReceiptText", agentId: "agt_fin", status: "built", users: "Dana", blurb: "Invoices raised from jobs, sent the same day.", features: ["Raised from the job", "Sent from your address", "Preview before sending"] },
  { key: "owed", hub: "money", name: "Money owed to you", accountantName: "Receivables", icon: "HandCoins", agentId: "agt_credit", status: "built", users: "Dana", blurb: "Every invoice chased until it's paid.", features: ["Ageing at a glance", "Polite, then firmer reminders", "Tells you when to call"] },
  { key: "bills", hub: "money", name: "Bills", accountantName: "Payables", icon: "Wallet", agentId: "agt_fin", status: "built", users: "Dana", blurb: "Supplier bills captured and paid on time.", features: ["Due dates tracked", "Paid with your approval"] },
  { key: "cash", hub: "money", name: "Cash", icon: "Landmark", agentId: "agt_fin", status: "built", users: "Dana", blurb: "Today's balance and the next six weeks.", features: ["Balance from the bank feed", "6-week forecast"] },
  { key: "books", hub: "money", name: "Books", accountantName: "Ledger", icon: "BookOpen", agentId: "agt_fin", status: "soon", users: "Your accountant", blurb: "Double-entry books, coded automatically.", features: ["Bank matched daily", "Accountant access"] },
  { key: "vat", hub: "money", name: "VAT returns", icon: "Percent", agentId: "agt_fin", status: "soon", users: "Your accountant", blurb: "VAT filed on time.", features: ["Making Tax Digital", "Deadline reminders"] },
  { key: "yearend", hub: "money", name: "Year end", icon: "CalendarCheck", agentId: "agt_fin", status: "soon", users: "Your accountant", blurb: "Accounts and tax return, ready for the accountant.", features: ["Year-end pack", "Deadline reminders"] },
  { key: "expenses", hub: "money", name: "Expenses", icon: "Receipt", agentId: "agt_fin", status: "soon", users: "Everyone", blurb: "Photograph a receipt; it's coded and repaid.", features: ["Receipt capture", "Mileage"] },
  // Work
  { key: "jobs", hub: "work", name: "Jobs", icon: "SprayCan", agentId: "agt_ops", status: "built", users: "Sam and the crew", blurb: "Every site and every clean, on a list or a calendar.", features: ["Recurring cleans", "Site visits", "Crew on every job"] },
  { key: "rota", hub: "work", name: "Rota", icon: "CalendarDays", agentId: "agt_ops", status: "built", users: "Sam and the crew", blurb: "Who's where, every day of the week.", features: ["Week view", "Gaps flagged", "Sent to the crew"] },
  { key: "tasks", hub: "work", name: "Tasks", icon: "ListChecks", agentId: "agt_ops", status: "built", users: "Everyone", blurb: "One list for people and agents.", features: ["Assign to a person or an agent", "Linked to the record"] },
  { key: "contracts", hub: "work", name: "Contracts", icon: "FileSignature", agentId: "agt_ops", status: "built", users: "Dana", blurb: "Every cleaning contract, its value and renewal date.", features: ["Renewal reminders", "Monthly value"] },
  { key: "safety", hub: "work", name: "Health and safety", icon: "ShieldCheck", agentId: "agt_ops", status: "table", users: "Sam", blurb: "COSHH sheets, risk assessments and incidents.", features: ["COSHH register", "Incidents"] },
  { key: "stock", hub: "work", name: "Stock", icon: "Package", agentId: "agt_ops", status: "table", users: "Lee", blurb: "Cleaning supplies, counted and reordered.", features: ["Low-stock alerts", "Reorder drafts"] },
  { key: "fleet", hub: "work", name: "Vans", icon: "Truck", agentId: "agt_ops", status: "soon", users: "Sam", blurb: "MOT, service and insurance dates.", features: ["Reminders"] },
  // Team
  { key: "roster", hub: "team", name: "People and agents", icon: "Contact", agentId: "agt_brief", status: "built", users: "Everyone", blurb: "Everyone on the team, human or agent.", features: ["One roster", "Who does what"] },
  { key: "chat", hub: "team", name: "Team chat", icon: "MessagesSquare", agentId: "agt_brief", status: "built", users: "Everyone", blurb: "Channels for people and agents.", features: ["@-mention an agent", "Action cards that open the record"] },
  { key: "floor", hub: "team", name: "AI Team", icon: "Network", agentId: "agt_brief", status: "built", users: "Dana", blurb: "Your agents on the Floor, with the work moving between them.", features: ["Describe your business, get a team", "Drag work between agents"] },
  { key: "payroll", hub: "team", name: "Payroll", icon: "Banknote", agentId: "agt_fin", status: "soon", users: "Dana", blurb: "Payslips and RTI submissions.", features: ["Payslips", "Pensions"] },
  { key: "hiring", hub: "team", name: "Hiring", icon: "UserPlus", agentId: "agt_ops", status: "soon", users: "Sam", blurb: "Adverts, applicants and interviews.", features: ["Applicants in one place"] },
  { key: "holiday", hub: "team", name: "Holiday", icon: "Palmtree", agentId: "agt_ops", status: "soon", users: "Everyone", blurb: "Leave requested and approved.", features: ["Allowance tracking"] },
];

export const TOOLS = ["Xero", "QuickBooks", "Gmail", "Outlook", "Google Calendar", "WhatsApp"];
export const appDef = (key: string) => APPS.find((a) => a.key === key);
export const hubDef = (id: string) => HUBS.find((h) => h.id === id);

/** What an app is called in the current view. */
export function appName(a: AppDef, view: "owner" | "accountant") { return view === "accountant" && a.accountantName ? a.accountantName : a.name; }

/** Apps that appear as tabs in the shell: built or table apps that are installed, here or kept in a current tool. */
export function shellApps(os: OsConfig, hub: HubId) {
  return APPS.filter((a) => a.hub === hub && a.status !== "soon" && (os.apps[a.key]?.mode === "here" || os.apps[a.key]?.mode === "kept"));
}
/** Apps handled outside the business (outsourced) or kept in a current tool without a screen here: read-only cards. */
export function elsewhereApps(os: OsConfig, hub: HubId) {
  return APPS.filter((a) => a.hub === hub && (os.apps[a.key]?.mode === "outsourced" || (a.status === "soon" && os.apps[a.key]?.mode === "kept")));
}

const here = (autonomy: InstalledApp["autonomy"] = "ask"): InstalledApp => ({ mode: "here", tool: null, provider: null, autonomy });
const out = (provider: string): InstalledApp => ({ mode: "outsourced", tool: null, provider, autonomy: "ask" });
const kept = (tool: string): InstalledApp => ({ mode: "kept", tool, provider: null, autonomy: "ask" });

export type Industry = { key: string; name: string; blurb: string; apps: Record<string, InstalledApp> };
export const INDUSTRIES: Industry[] = [
  { key: "cleaning", name: "Cleaning and facilities", blurb: "Recurring site cleans, rotas and chasing invoices.",
    apps: { pipeline: here(), leads: here(), quotes: here(), inbox: here(), complaints: here(), invoices: here(), owed: here("limits"), bills: here(), cash: here("watch"), books: kept("Xero"), vat: out("Kendal & Co Accountants"), yearend: out("Kendal & Co Accountants"), jobs: here(), rota: here(), tasks: here(), contracts: here(), safety: here(), stock: here(), roster: here(), chat: here(), floor: here(), payroll: out("Moss Payroll Bureau") } },
  { key: "trades", name: "Trades", blurb: "Quotes, jobs on site and getting paid.",
    apps: { pipeline: here(), quotes: here(), inbox: here(), invoices: here(), owed: here(), bills: here(), cash: here(), books: kept("QuickBooks"), vat: out("Your accountant"), jobs: here(), rota: here(), tasks: here(), roster: here(), chat: here(), floor: here() } },
  { key: "agency", name: "Agency or studio", blurb: "Pipeline, proposals and retainers.",
    apps: { pipeline: here(), leads: here(), quotes: here(), inbox: here(), invoices: here(), owed: here(), cash: here(), books: kept("Xero"), contracts: here(), tasks: here(), roster: here(), chat: here(), floor: here() } },
  { key: "clinic", name: "Clinic or practice", blurb: "Bookings, patients' questions and suppliers.",
    apps: { inbox: here(), complaints: here(), invoices: here(), owed: here(), bills: here(), cash: here(), jobs: here(), rota: here(), tasks: here(), safety: here(), stock: here(), roster: here(), chat: here(), floor: here(), payroll: out("Your bureau") } },
];

/** Brightwork's OS as seeded: the cleaning template. */
export function brightworkOs(now: string): OsConfig {
  const apps: OsConfig["apps"] = {};
  for (const a of APPS) apps[a.key] = { mode: "off", tool: null, provider: null, autonomy: "ask" };
  Object.assign(apps, JSON.parse(JSON.stringify(INDUSTRIES[0].apps)));
  return { version: 1, apps, history: [{ version: 1, at: now, summary: "Started from Cleaning and facilities" }] };
}

/** Rough agent actions a month for an OS: how much the AI Team will do. */
export function actionsPerMonth(os: OsConfig) {
  const w = { watch: 20, ask: 60, limits: 140 } as const;
  let n = 0;
  for (const a of APPS) {
    const m = os.apps[a.key];
    if (!m || m.mode === "off" || !a.agentId) continue;
    n += m.mode === "here" ? (a.status === "soon" ? 0 : w[m.autonomy]) : m.mode === "kept" ? 30 : 10;
  }
  return n;
}
