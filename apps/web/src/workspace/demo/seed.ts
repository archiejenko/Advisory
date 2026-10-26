// Brightwork Cleaning Ltd: the demo business. Everything is relative to `now`, so the story reads the same on any day:
// three invoices overdue (£2,336.00), £320.00 due in the next seven days, Ancoats won this week, six new leads,
// two replies (one today), ten decisions waiting (four routine, six to review), and eight weeks of history behind it.
import type {
  ActivityEvent as Activity, Agent, Approval, Bill, Channel, ChatMessage, Company, Contact, Contract, Conversation, Deal, DiaryEntry,
  GenericRecord, Invoice, Job, Person, Quote, State, Task, Payment, Line,
} from "./types";
import { brightworkOs } from "./catalogue";

const H = 3600e3, D = 24 * H;

/** Deterministic noise for the history, so every reset looks the same. */
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

export function seed(nowMs: number = Date.now()): State {
  const now = new Date(nowMs);
  const iso = (ms: number) => new Date(ms).toISOString();
  const ago = (ms: number) => iso(nowMs - ms);
  const day = (n: number, hhmm = "09:00") => { const d = new Date(nowMs + n * D); const [h, m] = hhmm.split(":").map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const dateOnly = (n: number) => day(n).slice(0, 10);
  // The next Thursday after today (1 to 7 days on).
  const toThu = ((4 - now.getDay() + 7) % 7) || 7;
  const thursday = (hhmm: string) => day(toThu, hhmm);
  const rand = rng(44);
  // Things that happened "today" stay today, even just after midnight.
  const midnight = new Date(nowMs); midnight.setHours(0, 0, 0, 0);
  const today = (ms: number) => ago(Math.min(ms, (nowMs - midnight.getTime()) * 0.9));

  /* ---------- People (8) ---------- */
  const person = (id: string, name: string, role: string, team: Person["team"], startedOn: string): Person =>
    ({ id, name, role, team, email: name.split(" ")[0].toLowerCase() + "@brightwork.example", phone: "07700 900" + String(100 + parseInt(id.slice(-2), 36) % 900).padStart(3, "0"), startedOn, initials: name.split(" ").map((w) => w[0]).join("") });
  const people: Person[] = [
    person("p_dana", "Dana Price", "Owner", "office", "2019-04-01"),
    person("p_sam", "Sam Okafor", "Operations manager", "office", "2021-03-01"),
    person("p_priya", "Priya Shah", "Cleaner", "crew", "2024-06-17"),
    person("p_lee", "Lee Hart", "Crew lead", "crew", "2022-09-05"),
    person("p_aisha", "Aisha Begum", "Cleaner", "crew", "2023-01-09"),
    person("p_tom", "Tom Walsh", "Cleaner", "crew", "2023-08-14"),
    person("p_kasia", "Kasia Nowak", "Cleaner", "crew", "2024-02-19"),
    person("p_jordan", "Jordan Reid", "Cleaner", "crew", "2025-05-12"),
  ];

  /* ---------- Agents (6 roles; sub-agents live inside them) ---------- */
  const rule = (type: Agent["autonomy"][number]["type"], label: string, mode: "ask" | "auto" = "ask", maxValue: number | null = null) => ({ type, label, mode, maxValue });
  const agents: Agent[] = [
    { id: "agt_sales", name: "Maya", roleName: "Sales", description: "Finds companies that fit, writes the first email, prices quotes and follows them up.", hubIds: ["customers"], appKeys: ["pipeline", "leads", "quotes"], minutesPerAction: 18, subAgents: ["Prospector", "Proposal writer"],
      autonomy: [rule("send_outreach", "Send a first email to a new lead"), rule("follow_up_quote", "Follow up a quote after 5 days")] },
    { id: "agt_cs", name: "Theo", roleName: "Customer service", description: "Reads every enquiry, drafts the reply and books walk-rounds.", hubIds: ["customers"], appKeys: ["inbox", "complaints"], minutesPerAction: 12, subAgents: ["Triage"],
      autonomy: [rule("reply_enquiry", "Reply to an enquiry")] },
    { id: "agt_credit", name: "Rosa", roleName: "Credit control", description: "Chases every invoice until it's paid: polite first, firmer later, and tells you when to call.", hubIds: ["money"], appKeys: ["owed"], minutesPerAction: 15, subAgents: [],
      autonomy: [rule("send_reminder", "Send a payment reminder")] },
    { id: "agt_ops", name: "Owen", roleName: "Operations", description: "Keeps jobs, the rota and supplies straight, and tells the crew what's changed.", hubIds: ["work"], appKeys: ["jobs", "rota", "tasks", "contracts", "safety", "stock"], minutesPerAction: 10, subAgents: ["Rota planner"],
      autonomy: [rule("confirm_job", "Confirm a job with the crew", "auto", null)] },
    { id: "agt_fin", name: "Fern", roleName: "Finance", description: "Raises invoices from jobs, records bills, pays them with your OK and keeps the cash forecast current.", hubIds: ["money"], appKeys: ["invoices", "bills", "cash"], minutesPerAction: 14, subAgents: ["Bookkeeper"],
      autonomy: [rule("send_invoice", "Send an invoice"), rule("pay_bill", "Pay a supplier bill")] },
    { id: "agt_brief", name: "Bea", roleName: "Briefing", description: "Writes your weekly briefing and keeps the team chat up to date.", hubIds: ["team"], appKeys: ["roster", "chat", "floor"], minutesPerAction: 20, subAgents: [],
      autonomy: [rule("post_briefing", "Post the weekly briefing")] },
  ];

  /* ---------- Companies and contacts ---------- */
  const companies: Company[] = [];
  const SHORT: Record<string, string> = { co_tarnbrook: "Tarnbrook", co_ancoats: "Ancoats Architects", co_quayside: "Quayside Opticians", co_irwell: "Irwell Engineering", co_marston: "Marston Interiors", co_peel: "Peel Street Accountants", co_castlefield: "Castlefield Dental", co_ashworth: "Ashworth Hale", co_hulme: "Hulme Dental", co_didsfam: "Didsbury Family Dental" };
  const contacts: Contact[] = [];
  const co = (id: string, name: string, type: string, postcode: string, staff: number | null, status: Company["status"], pay: Company["paymentBehaviour"], createdDaysAgo: number, sinceDaysAgo: number | null, email: string | null, notes: string, source = "Referral") => {
    companies.push({ id, name, short: SHORT[id] || name.replace(/ (Ltd|LLP)$/, ""), type, postcode, staff, status, paymentBehaviour: pay, website: email ? "https://" + email.split("@")[1] : null, email, source, createdAt: ago(createdDaysAgo * D), customerSince: sinceDaysAgo == null ? null : dateOnly(-sinceDaysAgo), notes });
  };
  const ct = (companyId: string, name: string, role: string, email: string | null, phone: string | null = null) => contacts.push({ id: "con_" + (contacts.length + 1), companyId, name, role, email, phone });
  // Customers
  co("co_tarnbrook", "Tarnbrook Logistics Ltd", "Logistics depot and offices", "M17 1PF", 60, "customer", "usually late", 700, 640, "finance@tarnbrook.example", "Nightly clean of offices and welfare block. Pays after the second reminder, every month.");
  co("co_didsbury", "Didsbury Lettings Ltd", "Lettings agency", "M20 6RL", 12, "customer", "sometimes late", 420, 400, "accounts@didsburylettings.example", "Office clean plus end-of-tenancy cleans on request.");
  co("co_spinning", "Spinningfields Law LLP", "Law firm", "M3 3AP", 24, "customer", "on time", 300, 290, "accounts@spinningfieldslaw.example", "Daily office clean, Monday to Friday.");
  co("co_ancoats", "Ancoats Architects LLP", "Architecture studio", "M4 6DE", 22, "customer", "new", 26, 3, "studio@ancoatsarch.example", "Won this week: weekly clean of the Redhill Street studio.", "Outreach");
  co("co_quayside", "Quayside Opticians Ltd", "Opticians", "M50 3AZ", 9, "customer", "on time", 500, 480, "accounts@quayside.example", "Weekly clean and monthly windows.");
  co("co_holcombe", "Holcombe Legal Ltd", "Solicitors", "M2 4WQ", 18, "customer", "on time", 380, 360, "accounts@holcombelegal.example", "Three cleans a week.");
  co("co_irwell", "Irwell Engineering Ltd", "Engineering offices", "M5 4WT", 35, "customer", "on time", 820, 800, "ap@irwelleng.example", "Twice-weekly office clean.");
  co("co_marston", "Marston Interiors Ltd", "Showroom", "M15 4PS", 8, "customer", "on time", 260, 250, "ap@marston.example", "Weekly showroom clean.");
  co("co_trafford", "Trafford Medical Centre", "GP surgery", "M32 0JT", 45, "customer", "on time", 900, 880, "practice.manager@traffordmedical.example", "Clinical clean every evening, deep clean monthly.");
  co("co_northgate", "Northgate Schools Trust", "Two primary schools", "M8 9JH", 120, "customer", "on time", 1100, 1080, "bursar@northgate.example", "After-school cleans at both sites, term time.");
  co("co_castlequay", "Castle Quay Offices Ltd", "Serviced offices", "M3 4JR", 80, "customer", "sometimes late", 600, 560, "facilities@castlequay.example", "Five floors of serviced offices.");
  // Leads: six new this week
  co("co_peel", "Peel Street Accountants Ltd", "Accountancy practice", "M3 4EN", 15, "lead", "new", 0.2, null, "office@peelstreet.example", "15 staff. Public office email on their website. New client meeting suite.", "Companies House");
  co("co_salford", "Salford Quays Media Ltd", "Media agency", "M50 2EQ", 40, "lead", "new", 0.5, null, "facilities@salfordmedia.example", "About 40 staff over three floors at MediaCity. Asked for a quote.", "Website form");
  co("co_castlefield", "Castlefield Dental Care Ltd", "Dental practice", "M3 4LZ", 11, "lead", "new", 4, null, "reception@castlefielddental.example", "Two-surgery practice. Replied to our email and wants a walk-round.", "Outreach");
  co("co_whalley", "Whalley Range Physio Ltd", "Physiotherapy clinic", "M16 8AB", 7, "lead", "new", 5, null, "info@wrphysio.example", "Three treatment rooms. Replied asking for prices.", "Outreach");
  co("co_nq", "Northern Quarter Studios Ltd", "Co-working space", "M1 1JR", 30, "lead", "new", 6, null, "hi@nqstudios.example", "Three floors, growing membership.", "Companies House");
  co("co_deansgate", "Deansgate Physio Ltd", "Physiotherapy clinic", "M3 2BW", 6, "lead", "new", 3, null, "hello@deansgatephysio.example", "Opened in 2025, one site.", "Companies House");
  // Older leads with quotes out, and one lost
  co("co_ashworth", "Ashworth Hale Solicitors Ltd", "Law firm", "M2 5NT", 28, "lead", "new", 19, null, "hello@ashworthhale.example", "Moving to a bigger office in January.", "Outreach");
  co("co_chorlton", "Chorlton Vets Ltd", "Veterinary practice", "M21 9PQ", 14, "lead", "new", 16, null, "reception@chorltonvets.example", "Two consulting rooms and a small surgery.", "Referral");
  co("co_hulme", "Hulme Dental Studio Ltd", "Dental practice", "M15 5BQ", 10, "lead", "new", 14, null, "hello@hulmedental.example", "Single site, evening clean wanted.", "Website form");
  co("co_didsfam", "Didsbury Family Dental Ltd", "Dental practice", "M20 2RN", 12, "lost", "new", 24, null, "reception@didsburydental.example", "Already on a two-year contract with another cleaner.", "Outreach");
  ct("co_tarnbrook", "Gary Fenton", "Finance manager", "finance@tarnbrook.example", "0161 496 0101");
  ct("co_tarnbrook", "Lou Mercer", "Site manager", "lou.mercer@tarnbrook.example", "0161 496 0102");
  ct("co_didsbury", "Hannah Cole", "Office manager", "accounts@didsburylettings.example", "0161 496 0201");
  ct("co_spinning", "Rupert Asante", "Practice manager", "accounts@spinningfieldslaw.example", "0161 496 0301");
  ct("co_ancoats", "Sam Iqbal", "Studio manager", "studio@ancoatsarch.example", "0161 496 0401");
  ct("co_quayside", "Mei Lin", "Owner", "accounts@quayside.example", "0161 496 0501");
  ct("co_holcombe", "Joanne Holcombe", "Partner", "accounts@holcombelegal.example", "0161 496 0601");
  ct("co_irwell", "Dev Patel", "Facilities", "ap@irwelleng.example", null);
  ct("co_marston", "Clare Marston", "Director", "ap@marston.example", null);
  ct("co_trafford", "Karen Lowe", "Practice manager", "practice.manager@traffordmedical.example", "0161 496 1101");
  ct("co_northgate", "Ian Shaw", "Bursar", "bursar@northgate.example", "0161 496 1201");
  ct("co_castlequay", "Bea Rahman", "Facilities manager", "facilities@castlequay.example", "0161 496 1301");
  ct("co_peel", "Office manager", "Office manager", "office@peelstreet.example", null);
  ct("co_salford", "Ellie Brookes", "Facilities lead", "facilities@salfordmedia.example", "0161 496 0901");
  ct("co_castlefield", "Dr Amir Haddad", "Practice owner", "reception@castlefielddental.example", "0161 496 1001");
  ct("co_whalley", "Fran Doyle", "Clinic manager", "info@wrphysio.example", null);
  ct("co_nq", "Rob Kane", "Community manager", "hi@nqstudios.example", null);
  ct("co_deansgate", "Leah Moss", "Owner", "hello@deansgatephysio.example", null);
  ct("co_ashworth", "Nadia Hale", "Partner", "hello@ashworthhale.example", null);
  ct("co_chorlton", "Pete Byrne", "Practice manager", "reception@chorltonvets.example", null);
  ct("co_hulme", "Ola Ade", "Practice manager", "hello@hulmedental.example", null);
  ct("co_didsfam", "Reception", "Reception", "reception@didsburydental.example", null);
  const contactOf = (companyId: string) => contacts.find((c) => c.companyId === companyId)!;

  /* ---------- Deals and quotes ---------- */
  const deals: Deal[] = [];
  const quotes: Quote[] = [];
  const deal = (id: string, companyId: string, title: string, stage: Deal["stage"], value: number, nextStep: string, updatedDaysAgo: number, createdDaysAgo: number) =>
    deals.push({ id, companyId, title, stage, value, ownerId: "agt_sales", nextStep, updatedAt: ago(updatedDaysAgo * D), createdAt: ago(createdDaysAgo * D) });
  const lines = (desc: string, visits: number, rate: number): Line[] => [{ description: desc, qty: visits, unit: rate }];
  const quote = (id: string, number: string, dealId: string, companyId: string, l: Line[], status: Quote["status"], sentDaysAgo: number | null, decidedDaysAgo: number | null = null) =>
    quotes.push({ id, number, dealId, companyId, lines: l, total: l.reduce((n, x) => n + x.qty * x.unit, 0), status, sentAt: sentDaysAgo == null ? null : ago(sentDaysAgo * D), decidedAt: decidedDaysAgo == null ? null : ago(decidedDaysAgo * D) });
  deal("deal_peel", "co_peel", "Weekly office clean", "new", 960000, "Send the first email (waiting for your OK)", 0.2, 0.2);
  deal("deal_salford", "co_salford", "Nightly clean, 3 floors", "qualified", 2880000, "Ask the two pricing questions (waiting for your OK)", 0.03, 0.5);
  deal("deal_castlefield", "co_castlefield", "Evening surgery clean", "qualified", 624000, "Walk-round on Thursday at 5.30pm", 0.12, 4);
  deal("deal_whalley", "co_whalley", "Clinic clean, 3 rooms", "qualified", 390000, "Send prices", 3, 5);
  deal("deal_nq", "co_nq", "Co-working clean, 3 floors", "new", 1440000, "Second email on Thursday", 6, 6);
  deal("deal_deansgate", "co_deansgate", "Clinic clean", "new", 312000, "First email drafted next run", 3, 3);
  deal("deal_ashworth", "co_ashworth", "Office clean from January", "quoted", 1152000, "Follow up the quote", 8, 19);
  deal("deal_chorlton", "co_chorlton", "Practice clean", "quoted", 546000, "Follow up the quote", 7, 16);
  deal("deal_hulme", "co_hulme", "Evening clean", "quoted", 468000, "Follow up the quote", 6, 14);
  deal("deal_ancoats", "co_ancoats", "Weekly studio clean", "won", 499200, "First clean on Monday", 3, 26);
  deal("deal_didsfam", "co_didsfam", "Practice clean", "lost", 520000, "Try again when their contract ends", 15, 24);
  // Won deals behind existing customers
  for (const c of ["co_tarnbrook", "co_didsbury", "co_spinning", "co_quayside", "co_holcombe", "co_irwell", "co_marston", "co_trafford", "co_northgate", "co_castlequay"]) {
    const since = companies.find((x) => x.id === c)!;
    deal("deal_" + c.slice(3), c, "Cleaning contract", "won", 0, "Renewal review", 60, Math.round((nowMs - Date.parse(since.createdAt)) / D));
  }
  quote("q_ancoats", "Q-0231", "deal_ancoats", "co_ancoats", lines("Weekly studio clean, 3 hours", 52, 9600), "accepted", 9, 3);
  quote("q_ashworth", "Q-0233", "deal_ashworth", "co_ashworth", lines("Office clean, 3 visits a week", 156, 7385), "sent", 8);
  quote("q_chorlton", "Q-0234", "deal_chorlton", "co_chorlton", lines("Practice clean, 2 visits a week", 104, 5250), "sent", 7);
  quote("q_hulme", "Q-0235", "deal_hulme", "co_hulme", lines("Evening clean, 2 visits a week", 104, 4500), "sent", 6);
  quote("q_didsfam", "Q-0229", "deal_didsfam", "co_didsfam", lines("Practice clean, 2 visits a week", 104, 5000), "declined", 20, 15);
  quote("q_salford", "Q-0236", "deal_salford", "co_salford", lines("Nightly clean, 3 floors", 260, 11077), "draft", null);

  /* ---------- Contracts and jobs ---------- */
  const contracts: Contract[] = [];
  const jobs: Job[] = [];
  const crew = (...ids: string[]) => ids.map((x) => "p_" + x);
  const weekly = (days: number[], time: string, durationMins: number) => ({ kind: "weekly" as const, days, time, durationMins });
  const job = (id: string, companyId: string, title: string, site: string, schedule: Job["schedule"], crewIds: string[], monthly: number | null, startsDaysAgo: number, quoteId: string | null = null, kind: Job["kind"] = "clean", status: Job["status"] = "active") => {
    const contractId = kind === "clean" ? "ctr_" + id.slice(4) : null;
    if (contractId) contracts.push({ id: contractId, companyId, title, startsOn: dateOnly(-startsDaysAgo), endsOn: dateOnly(365 - (startsDaysAgo % 365)), monthlyValue: monthly || 0, status: 365 - (startsDaysAgo % 365) < 45 ? "ending" : "active" });
    jobs.push({ id, companyId, quoteId, kind, title, site, schedule, crewIds, status, startsOn: dateOnly(-startsDaysAgo), contractId, monthlyValue: monthly });
  };
  job("job_tarnbrook", "co_tarnbrook", "Nightly office and welfare clean", "Unit 2, Trafford Park, M17 1PF", weekly([1, 2, 3, 4, 5], "18:00", 180), crew("lee", "tom"), 128000, 640);
  job("job_spinning", "co_spinning", "Daily office clean", "3 Hardman Square, M3 3AP", weekly([1, 2, 3, 4, 5], "18:30", 120), crew("aisha", "priya"), 40000, 290);
  job("job_holcombe", "co_holcombe", "Office clean, three times a week", "41 King Street, M2 4WQ", weekly([1, 3, 5], "17:30", 90), crew("kasia"), 96000, 360);
  job("job_irwell", "co_irwell", "Twice-weekly office clean", "Irwell House, M5 4WT", weekly([2, 4], "18:00", 150), crew("jordan", "kasia"), 77500, 800);
  job("job_trafford", "co_trafford", "Evening clinical clean", "Trafford Medical Centre, M32 0JT", weekly([1, 2, 3, 4, 5], "19:00", 150), crew("aisha", "jordan"), 465000, 880);
  job("job_northgate", "co_northgate", "After-school clean, two sites", "Northgate Primary and Cheetham Hill Primary, M8", weekly([1, 2, 3, 4, 5], "15:30", 180), crew("priya", "kasia", "tom"), 640000, 1080);
  job("job_castlequay", "co_castlequay", "Serviced offices, five floors", "Castle Quay, M3 4JR", weekly([1, 2, 3, 4, 5], "06:00", 150), crew("lee", "aisha"), 395000, 560);
  job("job_quayside", "co_quayside", "Weekly clean and monthly windows", "The Quays, M50 3AZ", weekly([3], "08:00", 120), crew("priya"), 32000, 480);
  job("job_marston", "co_marston", "Weekly showroom clean", "12 Hulme Street, M15 4PS", weekly([6], "09:00", 120), crew("tom"), 52000, 250);
  job("job_didsbury", "co_didsbury", "Office clean and end-of-tenancy cleans", "8 Wilmslow Road, M20 6RL", weekly([2], "17:00", 90), crew("aisha"), 65600, 400);
  job("job_ancoats", "co_ancoats", "Weekly studio clean", "18 Redhill Street, M4 6DE", weekly([1], "18:00", 180), crew("lee", "jordan"), 41600, -((8 - now.getDay()) % 7 || 7), "q_ancoats", "clean", "scheduled");
  jobs.push({ id: "job_castlefield_visit", companyId: "co_castlefield", quoteId: null, kind: "visit", title: "Walk-round", site: "Castlefield Dental Care, M3 4LZ", schedule: { kind: "once", date: thursday("17:30").slice(0, 10), time: "17:30", durationMins: 30 }, crewIds: ["p_dana"], status: "proposed", startsOn: thursday("17:30").slice(0, 10), contractId: null, monthlyValue: null });

  /* ---------- Invoices and payments ---------- */
  type Draft = Omit<Invoice, "id"> & { key: string };
  const drafts: Draft[] = [];
  const inv = (key: string, companyId: string, jobId: string | null, desc: string, total: number, issuedDaysAgo: number, termsDays: number, status: Invoice["status"], paidDaysAgo: number | null = null) =>
    drafts.push({ key, companyId, jobId, lines: [{ description: desc, qty: 1, unit: total }], total, issuedAt: ago(issuedDaysAgo * D), dueAt: day(-issuedDaysAgo + termsDays, "23:59"), status, paidAt: paidDaysAgo == null ? null : ago(paidDaysAgo * D), chaseLog: [] });
  // Current
  inv("tarnbrook_now", "co_tarnbrook", "job_tarnbrook", "Nightly cleaning, September", 128000, 51, 30, "overdue");
  inv("didsbury_now", "co_didsbury", "job_didsbury", "Office clean and end-of-tenancy clean, flat 3", 65600, 26, 14, "overdue");
  inv("spinning_now", "co_spinning", "job_spinning", "Daily office cleaning, 2 weeks", 40000, 18, 14, "overdue");
  inv("quayside_now", "co_quayside", "job_quayside", "Weekly clean and windows, October", 32000, 9, 14, "sent");
  inv("holcombe_now", "co_holcombe", "job_holcombe", "Office cleaning, October", 96000, 18, 30, "sent");
  inv("trafford_now", "co_trafford", "job_trafford", "Evening clinical cleaning, October", 465000, 6, 30, "sent");
  inv("northgate_now", "co_northgate", "job_northgate", "After-school cleaning, October", 640000, 6, 30, "sent");
  inv("castlequay_now", "co_castlequay", "job_castlequay", "Serviced office cleaning, October", 395000, 8, 30, "sent");
  inv("ancoats_first", "co_ancoats", "job_ancoats", "Weekly studio clean, first month", 41600, 0, 30, "draft");
  // History: 4 months of Tarnbrook paying late, and 8+ weeks of everyone else.
  for (let m = 1; m <= 4; m++) inv("tarnbrook_h" + m, "co_tarnbrook", "job_tarnbrook", "Nightly cleaning", 128000, 51 + 30 * m, 30, "paid", 51 + 30 * m - 30 - (12 + Math.round(rand() * 8)));
  const regular: [string, string, number, number, number][] = [
    // company, job, amount, cadence (days), terms
    ["co_spinning", "job_spinning", 40000, 14, 14], ["co_holcombe", "job_holcombe", 96000, 30, 30], ["co_irwell", "job_irwell", 77500, 30, 30],
    ["co_quayside", "job_quayside", 32000, 30, 14], ["co_marston", "job_marston", 52000, 30, 30], ["co_didsbury", "job_didsbury", 65600, 30, 14],
    ["co_trafford", "job_trafford", 465000, 30, 30], ["co_northgate", "job_northgate", 640000, 30, 30], ["co_castlequay", "job_castlequay", 395000, 30, 21],
  ];
  for (const [c, j, amount, every, terms] of regular) {
    const firstOpen = drafts.filter((x) => x.companyId === c).map((x) => (nowMs - Date.parse(x.issuedAt)) / D).reduce((a, b) => Math.max(a, b), 0);
    for (let k = 1; k <= Math.ceil(75 / every); k++) {
      const issued = Math.round(firstOpen) + every * k;
      if (issued > 90) break;
      const late = c === "co_didsbury" ? 4 + Math.round(rand() * 6) : ["co_trafford", "co_northgate", "co_castlequay"].includes(c) ? 2 : Math.round(rand() * 3) - 2;
      const paid = issued - terms - late;
      if (paid < 0.5) continue;
      inv(c.slice(3) + "_h" + k, c, j, "Cleaning", amount, issued, terms, "paid", paid);
    }
  }
  drafts.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  const anchor = drafts.findIndex((x) => x.key === "tarnbrook_now");
  const invoices: Invoice[] = drafts.map(({ key, ...x }, i) => ({ ...x, id: "INV-" + (1047 + i - anchor) }));
  const invId = (key: string) => invoices[drafts.findIndex((x) => x.key === key)].id;
  const tarnbrookInv = invoices.find((x) => x.id === "INV-1047")!;
  tarnbrookInv.chaseLog.push({ at: ago(14 * D), agentId: "agt_credit", actorId: "p_dana", kind: "reminder", summary: "First reminder sent, approved by Dana", approvalId: "apr_h_tarnbrook" });
  tarnbrookInv.chaseLog.push({ at: ago(9 * D), agentId: null, actorId: "p_dana", kind: "note", summary: "Gary Fenton said it's in their next payment run", approvalId: null });
  const didsburyInv = invoices.find((x) => x.id === invId("didsbury_now"))!;
  const spinningInv = invoices.find((x) => x.id === invId("spinning_now"))!;
  const payments: Payment[] = invoices.filter((x) => x.status === "paid").map((x, i) => ({ id: "pay_" + (i + 1), invoiceId: x.id, amount: x.total, at: x.paidAt! }));
  // Past Tarnbrook invoices: two reminders each, then paid.
  for (const x of invoices.filter((y) => y.companyId === "co_tarnbrook" && y.status === "paid")) {
    const due = Date.parse(x.dueAt);
    x.chaseLog.push({ at: iso(due + 3 * D), agentId: "agt_credit", actorId: "p_dana", kind: "reminder", summary: "First reminder sent", approvalId: null });
    x.chaseLog.push({ at: iso(due + 10 * D), agentId: "agt_credit", actorId: "p_dana", kind: "reminder", summary: "Second reminder sent", approvalId: null });
  }

  /* ---------- Bills ---------- */
  const bills: Bill[] = [];
  const bill = (id: string, supplier: string, category: string, total: number, issuedDaysAgo: number, dueIn: number, status: Bill["status"], paidDaysAgo: number | null = null) =>
    bills.push({ id, supplier, category, total, issuedAt: ago(issuedDaysAgo * D), dueAt: day(dueIn, "23:59"), status, paidAt: paidDaysAgo == null ? null : ago(paidDaysAgo * D) });
  bill("bill_1", "Northern Janitorial Supplies", "Cleaning chemicals, September", 68420, 36, -6, "overdue");
  bill("bill_2", "Redhill Estates", "Unit 4 rent, Q4", 125000, 12, 2, "due");
  bill("bill_3", "Lex Vehicle Leasing", "Van lease, November", 48900, 5, 8, "due");
  bill("bill_4", "Northern Janitorial Supplies", "Floor cleaner, 20 × 5L", 31240, 3, 27, "due");
  bill("bill_5", "EE Business", "Team phones, October", 14400, 9, 12, "scheduled");
  bill("bill_6", "Hiscox", "Public liability insurance", 21800, 40, -10, "paid", 11);
  bill("bill_7", "Lex Vehicle Leasing", "Van lease, October", 48900, 35, -23, "paid", 23);
  bill("bill_8", "Northern Janitorial Supplies", "Microfibre and mop heads", 18760, 50, -20, "paid", 19);
  bill("bill_9", "Redhill Estates", "Unit 4 rent, Q3", 125000, 100, -88, "paid", 88);

  /* ---------- Conversations ---------- */
  const conversations: Conversation[] = [];
  let msgN = 0;
  const msg = (at: string, direction: "in" | "out", from: string, body: string, actor: Conversation["messages"][number]["actor"] = null) => ({ id: "m_" + (++msgN), at, direction, from, body, actor });
  const conv = (c: Omit<Conversation, "contactId"> & { contactId?: string | null }) => conversations.push({ contactId: c.companyId ? contactOf(c.companyId)?.id || null : null, ...c } as Conversation);
  conv({ id: "cv_salford", companyId: "co_salford", channel: "web", subject: "Quote for nightly cleaning, 3 floors", origin: "enquiry", status: "new", assignedTo: { kind: "agent", id: "agt_cs" },
    messages: [msg(today(40 * 60e3), "in", "Ellie Brookes", "Hi, we're looking for a nightly clean of our offices at MediaCity, three floors, about 9,000 sq ft. Could you quote and tell us when you could start?")] });
  conv({ id: "cv_castlefield", companyId: "co_castlefield", channel: "email", subject: "Re: Cleaning for Castlefield Dental", origin: "reply", status: "open", assignedTo: { kind: "agent", id: "agt_cs" },
    messages: [
      msg(ago(4 * D), "out", "Dana Price", "Hello,\n\nI run Brightwork Cleaning. We clean dental practices across the city centre after hours, so the surgery is ready for the first patient.\n\nWould a short visit to give you a fixed monthly price be useful?\n\nDana", { kind: "agent", id: "agt_sales" }),
      msg(today(3 * H), "in", "Dr Amir Haddad", "Thanks Dana, yes we'd be interested. Could you come and look round on Thursday after 5pm?"),
    ] });
  conv({ id: "cv_whalley", companyId: "co_whalley", channel: "email", subject: "Re: Cleaning for Whalley Range Physio", origin: "reply", status: "waiting", assignedTo: { kind: "agent", id: "agt_sales" },
    messages: [
      msg(ago(5 * D), "out", "Dana Price", "Hello,\n\nWe look after clinics across south Manchester…", { kind: "agent", id: "agt_sales" }),
      msg(ago(3 * D), "in", "Fran Doyle", "Hi, what would three rooms cost, cleaned twice a week?"),
      msg(ago(3 * D - 22 * 60e3), "out", "Dana Price", "Hi Fran, for three rooms twice a week it's £75 a visit. I can pop in to confirm. Dana", { kind: "agent", id: "agt_sales" }),
    ] });
  conv({ id: "cv_holcombe", companyId: "co_holcombe", channel: "email", subject: "Extra deep clean before our client event", origin: "customer", status: "open", assignedTo: { kind: "agent", id: "agt_cs" },
    messages: [msg(ago(6 * H), "in", "Joanne Holcombe", "Hi Dana, could the team do a deep clean of reception and the meeting rooms next Friday before our client evening? Happy to pay extra.")] });
  conv({ id: "cv_tarnbrook", companyId: "co_tarnbrook", channel: "phone", subject: "Scratched worktop in the welfare block", origin: "customer", status: "open", assignedTo: { kind: "person", id: "p_sam" },
    messages: [msg(ago(2 * D), "in", "Lou Mercer", "Call note: Lou says a worktop in the welfare block was scratched on Tuesday night. Wants someone to look at it.", { kind: "person", id: "p_sam" })] });
  conv({ id: "cv_didsbury_call", companyId: "co_didsbury", channel: "phone", subject: "End-of-tenancy clean, flat 7", origin: "customer", status: "waiting", assignedTo: { kind: "person", id: "p_sam" },
    messages: [msg(ago(26 * H), "in", "Hannah Cole", "Call note: flat 7 on Lapwing Lane is empty from the 3rd; they want an end-of-tenancy clean that week. Sam to confirm a day.", { kind: "person", id: "p_sam" })] });
  conv({ id: "cv_ancoats", companyId: "co_ancoats", channel: "email", subject: "Re: Your quote Q-0231", origin: "customer", status: "resolved", assignedTo: { kind: "agent", id: "agt_cs" },
    messages: [msg(ago(3 * D + 2 * H), "in", "Sam Iqbal", "Happy to go ahead with the weekly clean. Monday evenings suit us."), msg(ago(3 * D + 80 * 60e3), "out", "Dana Price", "Brilliant, thank you. We'll start Monday at 6pm. Dana", { kind: "agent", id: "agt_cs" })] });
  conv({ id: "cv_supplier", companyId: null, channel: "email", subject: "20% off microfibre this week", origin: "supplier", status: "resolved", assignedTo: { kind: "agent", id: "agt_cs" },
    messages: [msg(ago(2 * D), "in", "offers@supplies.example", "Bulk microfibre cloths at 20% off until Sunday.")] });
  // History for response times: 8 weeks of enquiries answered.
  const histCos = ["co_spinning", "co_quayside", "co_holcombe", "co_irwell", "co_marston", "co_didsbury", "co_trafford", "co_northgate", "co_castlequay"];
  for (let i = 0; i < 24; i++) {
    const daysAgo = 2 + i * 2.3, c = histCos[i % histCos.length];
    const late = daysAgo > 28 ? 1.6 : 1;
    const mins = Math.round((18 + rand() * 40) * late);
    const t = nowMs - daysAgo * D;
    conv({ id: "cv_h" + i, companyId: c, channel: i % 3 ? "email" : "web", subject: ["Can you add the kitchen?", "Change of key holder", "Invoice copy please", "Extra clean before an audit", "Alarm code changed"][i % 5], origin: "customer", status: "resolved", assignedTo: { kind: "agent", id: "agt_cs" },
      messages: [msg(iso(t), "in", contactOf(c).name, "Quick question about our clean."), msg(iso(t + mins * 60e3), "out", "Dana Price", "Thanks, all sorted.", { kind: "agent", id: "agt_cs" })] });
  }

  /* ---------- Approvals: 10 pending (4 routine, 6 review), and the history behind the trust ladder ---------- */
  const approvals: Approval[] = [];
  const apr = (a: Omit<Approval, "status" | "decidedAt" | "decidedBy" | "edited" | "note"> & Partial<Approval>) =>
    approvals.push({ status: "pending", decidedAt: null, decidedBy: null, edited: false, note: null, ...a } as Approval);
  const email = (to: string, subject: string, body: string) => ({ kind: "email" as const, to, subject, body });
  const fmt = (p: number) => "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ukDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const midnightOf = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysLate = (x: Invoice) => Math.round((midnightOf(nowMs) - midnightOf(Date.parse(x.dueAt))) / D);
  // Routine
  apr({ id: "apr_spinning", agentId: "agt_credit", type: "send_reminder", risk: "routine", value: spinningInv.total, createdAt: ago(3 * H), linkedRecord: { type: "invoice", id: spinningInv.id },
    title: `First reminder to Spinningfields Law for ${spinningInv.id}`, reason: `${fmt(spinningInv.total)} · ${daysLate(spinningInv)} days late · 1st reminder · always pays within a week of one`,
    preview: email("accounts@spinningfieldslaw.example", `Invoice ${spinningInv.id}, ${fmt(spinningInv.total)}`, `Hello Rupert,\n\nA quick note that invoice ${spinningInv.id} for ${fmt(spinningInv.total)} was due on ${ukDate(spinningInv.dueAt)}. If it's already on its way, thank you, and please ignore this.\n\nKind regards,\nDana Price\nBrightwork Cleaning`) });
  apr({ id: "apr_didsbury", agentId: "agt_credit", type: "send_reminder", risk: "routine", value: didsburyInv.total, createdAt: ago(3 * H + 2 * 60e3), linkedRecord: { type: "invoice", id: didsburyInv.id },
    title: `First reminder to Didsbury Lettings for ${didsburyInv.id}`, reason: `${fmt(didsburyInv.total)} · ${daysLate(didsburyInv)} days late · 1st reminder · usually pays a week after one`,
    preview: email("accounts@didsburylettings.example", `Invoice ${didsburyInv.id}, ${fmt(didsburyInv.total)}`, `Hello Hannah,\n\nA quick note that invoice ${didsburyInv.id} for ${fmt(didsburyInv.total)} was due on ${ukDate(didsburyInv.dueAt)}. If it's already on its way, thank you, and please ignore this.\n\nKind regards,\nDana Price\nBrightwork Cleaning`) });
  apr({ id: "apr_ancoats_crew", agentId: "agt_ops", type: "confirm_job", risk: "routine", value: null, createdAt: ago(5 * H), linkedRecord: { type: "job", id: "job_ancoats" },
    title: "Tell Lee and Jordan about the new Ancoats clean", reason: "New weekly job starts Monday at 6pm · crew already free that evening",
    preview: { kind: "message", channel: "WhatsApp to Lee Hart and Jordan Reid", body: "New regular clean from Monday: Ancoats Architects, 18 Redhill Street, M4 6DE. Mondays 6pm to 9pm. Key safe code is in the job notes. Thanks both!" } });
  apr({ id: "apr_briefing", agentId: "agt_brief", type: "post_briefing", risk: "routine", value: null, createdAt: ago(1 * H), linkedRecord: { type: "agent", id: "agt_brief" },
    title: "Post this week's briefing to #general", reason: "Every Monday · last eight posted unchanged",
    preview: { kind: "message", channel: "#general", body: "Week in brief: Ancoats Architects signed for a weekly clean (first one Monday). 6 new leads, 2 replies. £2,336.00 overdue across 3 invoices; reminders going out. Castlefield Dental walk-round on Thursday at 5.30pm." } });
  // Review
  apr({ id: "apr_peel", agentId: "agt_sales", type: "send_outreach", risk: "review", value: null, createdAt: ago(5 * H), linkedRecord: { type: "company", id: "co_peel" },
    title: "First email to Peel Street Accountants", reason: "New lead in M3 · 15 staff · public office email · new client meeting suite",
    preview: email("office@peelstreet.example", "Office cleaning for Peel Street Accountants", "Hello,\n\nI run Brightwork Cleaning, a Manchester firm that looks after offices and clinics across the city centre. I saw you've opened a new client meeting suite; we keep spaces like that spotless after hours, so they're ready for the first meeting of the day.\n\nWould a short visit to give you a fixed monthly price be useful?\n\nDana Price\nBrightwork Cleaning") });
  apr({ id: "apr_salford", agentId: "agt_cs", type: "reply_enquiry", risk: "review", value: null, createdAt: ago(38 * 60e3), linkedRecord: { type: "conversation", id: "cv_salford" },
    title: "Reply to Salford Quays Media", reason: "Quote request · 3 floors, about 9,000 sq ft · two questions needed to price it",
    preview: email("facilities@salfordmedia.example", "Re: Quote for nightly cleaning, 3 floors", "Hello Ellie,\n\nThanks for getting in touch. Nightly cleaning across three floors is exactly what we do.\n\nTo give you an exact price, two quick questions:\n1. Roughly how many desks and kitchens are there on each floor?\n2. Do you need washrooms restocked, or do you supply consumables?\n\nWe could start within two weeks of your go-ahead.\n\nKind regards,\nDana Price\nBrightwork Cleaning") });
  apr({ id: "apr_castlefield", agentId: "agt_cs", type: "reply_enquiry", risk: "review", value: null, createdAt: ago(3 * H - 4 * 60e3), linkedRecord: { type: "conversation", id: "cv_castlefield" },
    title: "Confirm the Castlefield Dental walk-round", reason: "They asked for Thursday after 5pm · drafted 5.30pm · check your diary first", note: "Check diary: you're free Thursday from 5pm.",
    preview: email("reception@castlefielddental.example", "Re: Cleaning for Castlefield Dental", `Hello Dr Haddad,\n\nThursday works well. I'll come at 5.30pm; it takes about twenty minutes, and I'll send a fixed monthly price the next day.\n\nKind regards,\nDana Price\nBrightwork Cleaning`) });
  apr({ id: "apr_tarnbrook", agentId: "agt_credit", type: "send_reminder", risk: "review", value: tarnbrookInv.total, createdAt: ago(4 * H), linkedRecord: { type: "invoice", id: "INV-1047" },
    title: "Second reminder to Tarnbrook for INV-1047", reason: `${fmt(tarnbrookInv.total)} · ${daysLate(tarnbrookInv)} days late · 2nd reminder · usually pays after the 2nd`,
    preview: email("finance@tarnbrook.example", `Invoice INV-1047, ${fmt(tarnbrookInv.total)}: second reminder`, `Hello Gary,\n\nFollowing up on invoice INV-1047 for ${fmt(tarnbrookInv.total)}, which was due on ${ukDate(tarnbrookInv.dueAt)} and is now ${daysLate(tarnbrookInv)} days overdue. You mentioned it was in your next payment run; could you confirm the date it will be paid?\n\nKind regards,\nDana Price\nBrightwork Cleaning`) });
  apr({ id: "apr_bill", agentId: "agt_fin", type: "pay_bill", risk: "review", value: 68420, createdAt: ago(2 * H), linkedRecord: { type: "bill", id: "bill_1" },
    title: "Pay Northern Janitorial Supplies £684.20", reason: "September chemicals · 6 days overdue · they hold orders after 14 days",
    preview: { kind: "action", summary: "Pay £684.20 to Northern Janitorial Supplies", detail: "From Brightwork current account to Northern Janitorial Supplies (sort code 40-11-62), reference NJS-88213." } });
  apr({ id: "apr_holcombe", agentId: "agt_cs", type: "reply_enquiry", risk: "review", value: 18000, createdAt: ago(5 * H + 50 * 60e3), linkedRecord: { type: "conversation", id: "cv_holcombe" },
    title: "Reply to Holcombe Legal about a deep clean", reason: "Existing customer · extra work · priced at £180 from your rates",
    preview: email("accounts@holcombelegal.example", "Re: Extra deep clean before our client event", "Hello Joanne,\n\nYes, we can do that. A deep clean of reception and both meeting rooms takes two of us about three hours; it's £180 plus VAT, added to this month's invoice.\n\nWe'll come on Friday afternoon so everything is fresh for the evening.\n\nKind regards,\nDana Price\nBrightwork Cleaning") });
  // History: the last 10 reminders from Credit control were approved unchanged, which unlocks the trust prompt.
  const histInv = invoices.filter((x) => x.status === "paid").slice(-10);
  histInv.forEach((x, i) => {
    const at = nowMs - (i === 0 ? 14 : 6 + i * 4) * D;
    approvals.push({ id: i === 0 ? "apr_h_tarnbrook" : "apr_hr_" + i, agentId: "agt_credit", type: "send_reminder", risk: x.total < 50000 ? "routine" : "review", value: x.total, createdAt: iso(at - H), linkedRecord: { type: "invoice", id: i === 0 ? "INV-1047" : x.id },
      title: `Reminder for ${i === 0 ? "INV-1047" : x.id}`, reason: "Overdue", preview: email("accounts@example", "Reminder", "…"), status: "approved", decidedAt: iso(at), decidedBy: "p_dana", edited: false, note: null });
  });
  const histKinds: [Approval["agentId"], Approval["type"], boolean, boolean][] = [
    ["agt_sales", "send_outreach", true, false], ["agt_sales", "send_outreach", true, true], ["agt_sales", "send_outreach", false, false], ["agt_cs", "reply_enquiry", true, false],
    ["agt_cs", "reply_enquiry", true, true], ["agt_fin", "pay_bill", true, false], ["agt_brief", "post_briefing", true, false], ["agt_sales", "follow_up_quote", true, false],
  ];
  for (let i = 0; i < 40; i++) {
    const [agentId, type, ok, edited] = histKinds[i % histKinds.length];
    const at = nowMs - (1 + i * 1.35) * D;
    approvals.push({ id: "apr_hist_" + i, agentId, type, risk: "review", value: null, createdAt: iso(at - 2 * H), linkedRecord: { type: "agent", id: agentId }, title: "Earlier draft", reason: "", preview: { kind: "action", summary: "", detail: "" }, status: ok ? "approved" : "rejected", decidedAt: iso(at), decidedBy: "p_dana", edited, note: null });
  }

  /* ---------- Tasks ---------- */
  const tasks: Task[] = [
    { id: "task_rota", title: "Send the week " + isoWeek(now) + " rota to Priya", detail: "Priya picks up two extra evenings at Spinningfields.", assignee: { kind: "person", id: "p_sam" }, dueAt: thursday("12:00"), linkedRecord: { type: "person", id: "p_priya" }, status: "open", createdAt: ago(25 * H), createdBy: { kind: "person", id: "p_sam" } },
    { id: "task_coshh", title: "Sign the COSHH sheet for the new descaler", detail: "Safety data sheet is attached in Health and safety. Needs the owner's signature before the crew use it.", assignee: { kind: "person", id: "p_dana" }, dueAt: day(1, "17:00"), linkedRecord: { type: "record", id: "rec_coshh" }, status: "open", createdAt: ago(20 * H), createdBy: { kind: "agent", id: "agt_ops" } },
    { id: "task_worktop", title: "Look at the scratched worktop at Tarnbrook", detail: "Lou Mercer is on site from 4pm.", assignee: { kind: "person", id: "p_sam" }, dueAt: day(1, "16:00"), linkedRecord: { type: "conversation", id: "cv_tarnbrook" }, status: "open", createdAt: ago(2 * D), createdBy: { kind: "person", id: "p_sam" } },
    { id: "task_microfibre", title: "Restock blue microfibre at Unit 4", detail: null, assignee: { kind: "person", id: "p_lee" }, dueAt: day(2, "09:00"), linkedRecord: { type: "record", id: "rec_cloths" }, status: "open", createdAt: ago(D), createdBy: { kind: "agent", id: "agt_ops" } },
    { id: "task_didsbury", title: "Book the end-of-tenancy clean for flat 7", detail: "Empty from the 3rd.", assignee: { kind: "agent", id: "agt_ops" }, dueAt: day(2, "12:00"), linkedRecord: { type: "conversation", id: "cv_didsbury_call" }, status: "open", createdAt: ago(26 * H), createdBy: { kind: "person", id: "p_sam" } },
    { id: "task_salford_price", title: "Price Salford Quays Media once they answer", detail: null, assignee: { kind: "agent", id: "agt_sales" }, dueAt: null, linkedRecord: { type: "deal", id: "deal_salford" }, status: "open", createdAt: ago(30 * 60e3), createdBy: { kind: "agent", id: "agt_cs" } },
    { id: "task_insurance", title: "Renew public liability insurance", detail: null, assignee: { kind: "person", id: "p_dana" }, dueAt: day(-11), linkedRecord: { type: "bill", id: "bill_6" }, status: "done", createdAt: ago(20 * D), createdBy: { kind: "agent", id: "agt_fin" } },
  ];

  /* ---------- Generic records (standard table apps) ---------- */
  const records: GenericRecord[] = [
    { id: "rec_coshh", appKey: "safety", title: "COSHH sheet: new limescale descaler", status: "Needs signing", ownerId: "p_dana", dueAt: day(1, "17:00"), companyId: null, detail: "Supplier safety data sheet received. Owner signs before first use." },
    { id: "rec_ra_tarnbrook", appKey: "safety", title: "Risk assessment: Tarnbrook welfare block", status: "Current", ownerId: "p_sam", dueAt: day(140), companyId: "co_tarnbrook", detail: "Reviewed in June." },
    { id: "rec_incident", appKey: "safety", title: "Scratched worktop, Tarnbrook", status: "Open", ownerId: "p_sam", dueAt: day(1), companyId: "co_tarnbrook", detail: "Reported by Lou Mercer." },
    { id: "rec_cloths", appKey: "stock", title: "Blue microfibre cloths", status: "Low", ownerId: "p_lee", dueAt: day(2), companyId: null, detail: "40 left; reorder at 50." },
    { id: "rec_floor", appKey: "stock", title: "Floor cleaner, 5L", status: "On order", ownerId: "p_lee", dueAt: day(4), companyId: null, detail: "20 on order from Northern Janitorial." },
    { id: "rec_bags", appKey: "stock", title: "Bin liners, heavy duty", status: "OK", ownerId: "p_lee", dueAt: null, companyId: null, detail: "12 rolls." },
    { id: "rec_complaint_tarn", appKey: "complaints", title: "Scratched worktop in the welfare block", status: "Open", ownerId: "p_sam", dueAt: day(1), companyId: "co_tarnbrook", detail: "Logged from Lou Mercer's call." },
    { id: "rec_complaint_hol", appKey: "complaints", title: "Bins missed on Friday", status: "Resolved", ownerId: "p_sam", dueAt: null, companyId: "co_holcombe", detail: "Apologised; crew briefed." },
  ];

  /* ---------- Diary ---------- */
  const diary: DiaryEntry[] = [
    { id: "dia_castlefield", title: "Walk-round at Castlefield Dental (to confirm)", at: thursday("17:30"), durationMins: 30, with: { type: "company", id: "co_castlefield" }, personIds: ["p_dana"] },
    { id: "dia_accountant", title: "Call with Kendal & Co about the VAT return", at: day(2, "10:00"), durationMins: 30, with: null, personIds: ["p_dana"] },
    { id: "dia_supervision", title: "Spot check at Spinningfields", at: day(0, "19:00"), durationMins: 30, with: { type: "company", id: "co_spinning" }, personIds: ["p_sam"] },
  ];

  /* ---------- Channels and chat ---------- */
  const channels: Channel[] = [
    { id: "ch_general", name: "general", purpose: "Everyone" }, { id: "ch_finance", name: "finance", purpose: "Invoices, bills and cash" },
    { id: "ch_operations", name: "operations", purpose: "Jobs, rota and sites" }, { id: "ch_people", name: "people", purpose: "Holidays, hiring and training" },
    { id: "ch_sales", name: "sales", purpose: "Leads, quotes and new customers" },
  ];
  let chN = 0;
  const say = (channelId: string, author: ChatMessage["author"], body: string, at: string, card: ChatMessage["card"] = null) => ({ id: "ch_m" + (++chN), channelId, author, body, at, card });
  const P = (id: string) => ({ kind: "person" as const, id }), A = (id: string) => ({ kind: "agent" as const, id });
  const chat: ChatMessage[] = [
    say("ch_general", P("p_dana"), "Morning all. Ancoats Architects have signed, so Mondays get busier from next week.", ago(26 * H)),
    say("ch_general", P("p_sam"), "Noted. I'll get the week " + isoWeek(now) + " rota to Priya by Thursday.", ago(25 * H)),
    say("ch_general", A("agt_ops"), "Lee and Jordan are free on Monday evenings, so I've drafted the Ancoats crew message for Dana to approve.", ago(5 * H), { label: "Ancoats weekly studio clean", ref: { type: "job", id: "job_ancoats" } }),
    say("ch_finance", A("agt_credit"), "£1,280.00 overdue from Tarnbrook, now 21 days. Second reminder is drafted for Dana.", ago(4 * H), { label: "£1,280.00 overdue from Tarnbrook", ref: { type: "invoice", id: "INV-1047" } }),
    say("ch_finance", P("p_dana"), "@Fern what do we owe this week?", ago(3 * H)),
    say("ch_finance", A("agt_fin"), "This week: Unit 4 rent £1,250.00 (due in 2 days). Overdue: Northern Janitorial £684.20, payment drafted for your OK.", ago(3 * H - 3 * 60e3), { label: "Pay Northern Janitorial £684.20", ref: { type: "bill", id: "bill_1" } }),
    say("ch_operations", P("p_sam"), "Tarnbrook called about a scratched worktop in the welfare block. I'm going over tomorrow.", ago(2 * D), { label: "Scratched worktop call", ref: { type: "conversation", id: "cv_tarnbrook" } }),
    say("ch_operations", P("p_lee"), "Blue cloths are running low at Unit 4.", ago(D)),
    say("ch_operations", A("agt_ops"), "The COSHH sheet for the new descaler needs Dana's signature before the crew can use it.", ago(20 * H), { label: "COSHH sheet: new descaler", ref: { type: "record", id: "rec_coshh" } }),
    say("ch_people", P("p_kasia"), "Can I swap Friday for Saturday next week?", ago(30 * H)),
    say("ch_sales", A("agt_sales"), "6 new leads this week. Peel Street Accountants look like the best fit; first email is waiting for Dana.", ago(5 * H), { label: "Peel Street Accountants", ref: { type: "company", id: "co_peel" } }),
    say("ch_sales", A("agt_cs"), "Castlefield Dental replied: they want a walk-round on Thursday after 5pm.", ago(3 * H - 5 * 60e3), { label: "Castlefield Dental conversation", ref: { type: "conversation", id: "cv_castlefield" } }),
  ];

  /* ---------- Activity: eight weeks of agent and people actions ---------- */
  const activity: Activity[] = [];
  let evN = 0;
  const ev = (actor: Activity["actor"], verb: string, linkedRecord: Activity["linkedRecord"], at: number, minutesSaved = 0, undoable = false) =>
    activity.push({ id: "ev_" + (++evN), actor, verb, linkedRecord, at: iso(at), undoable, minutesSaved });
  for (const x of invoices) {
    if (Date.parse(x.issuedAt) > nowMs - 70 * D && x.status !== "draft") ev(A("agt_fin"), `raised and sent ${x.id} to ${companies.find((c) => c.id === x.companyId)!.name}`, { type: "invoice", id: x.id }, Date.parse(x.issuedAt), 12);
    for (const ch of x.chaseLog) if (ch.agentId && Date.parse(ch.at) > nowMs - 70 * D) ev(A(ch.agentId), `sent a reminder for ${x.id}`, { type: "invoice", id: x.id }, Date.parse(ch.at), 15);
    if (x.paidAt && Date.parse(x.paidAt) > nowMs - 70 * D) ev(A("agt_fin"), `matched a payment of ${fmt(x.total)} to ${x.id}`, { type: "invoice", id: x.id }, Date.parse(x.paidAt), 6);
  }
  for (const c of conversations) {
    const out = c.messages.find((m) => m.direction === "out" && m.actor?.kind === "agent");
    if (out) ev(out.actor!, `replied to ${c.companyId ? companies.find((x) => x.id === c.companyId)!.name : c.subject}`, { type: "conversation", id: c.id }, Date.parse(out.at), 12);
  }
  for (let w = 0; w < 8; w++) {
    const base = nowMs - w * 7 * D;
    ev(A("agt_brief"), "posted the weekly briefing to #general", { type: "agent", id: "agt_brief" }, base - 6.6 * D, 25);
    ev(A("agt_ops"), "sent the rota to the crew", { type: "agent", id: "agt_ops" }, base - 4.2 * D, 30);
    for (let k = 0; k < 3; k++) ev(A("agt_sales"), "researched a new company and saved it as a lead", { type: "agent", id: "agt_sales" }, base - (1 + k * 2) * D - 3 * H, 20);
  }
  ev(A("agt_sales"), "saved Peel Street Accountants as a lead", { type: "company", id: "co_peel" }, nowMs - 5.2 * H, 20);
  ev(A("agt_sales"), "moved Ancoats Architects to Won", { type: "deal", id: "deal_ancoats" }, nowMs - 3 * D, 5);
  ev(A("agt_ops"), "set up the Ancoats weekly studio clean", { type: "job", id: "job_ancoats" }, nowMs - 3 * D + H, 20);
  ev(P("p_dana"), "approved quote Q-0231 for Ancoats Architects", { type: "quote", id: "q_ancoats" }, nowMs - 9 * D, 0);
  ev(P("p_sam"), "logged a call from Tarnbrook about a scratched worktop", { type: "conversation", id: "cv_tarnbrook" }, nowMs - 2 * D, 0);
  ev(A("agt_cs"), "triaged the Salford Quays Media enquiry and drafted a reply", { type: "conversation", id: "cv_salford" }, nowMs - 38 * 60e3, 10);
  ev(A("agt_credit"), "drafted the second reminder for INV-1047", { type: "invoice", id: "INV-1047" }, nowMs - 4 * H, 10);
  activity.sort((a, b) => b.at.localeCompare(a.at));

  return {
    now: iso(nowMs),
    org: { name: "Brightwork Cleaning Ltd", owner: "p_dana", postcode: "M4 6DE", cashBalance: 1842035, balanceAt: iso(nowMs - 2 * H) },
    companies, contacts, deals, quotes, jobs, invoices, payments, bills, conversations, tasks, approvals, people, agents, activity,
    channels, chat, contracts, records, diary,
    os: brightworkOs(iso(nowMs - 40 * D)), paused: false,
    prefs: { view: "owner", trustDismissed: [], leaksDismissed: [], onboarded: true },
  };
}

/** ISO 8601 week number. */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7);
}
