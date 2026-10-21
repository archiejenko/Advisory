// Example data. All company names are fictional.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Ashdown", "Brindle", "Calder", "Dunmore", "Elsworth", "Fairhaven", "Garside", "Holcombe", "Irwell", "Kersal", "Linthorpe", "Marston", "Northcote", "Oakhurst", "Pennine", "Quarry Bank", "Radcliffe", "Saddleworth", "Thornley", "Upholland", "Vale Royal", "Whitworth", "Yarrow", "Alder", "Bramhall", "Cheadle", "Didsbury", "Edgeley", "Furness", "Goyt"];
const TRADE = ["Joinery", "Dental", "Logistics", "Print", "Studios", "Accountancy", "Motors", "Interiors", "Legal", "Care", "Engineering", "Foods", "Architects", "Recruitment", "Lettings", "Surveyors", "Opticians", "Veterinary", "Plastics", "Wholesale"];

export const FLAGGED = {
  23: { name: "Ellacombe Print Ltd", no: "08812234", finding: "Notice of appointment of administrators", severity: "Critical", source: "The Gazette" },
  57: { name: "Tarnbrook Logistics Ltd", no: "11420987", finding: "Annual accounts overdue since 30 Sep 2026", severity: "Review", source: "Companies House" },
  118: { name: "Brackenvale Dental Ltd", no: "06173520", finding: "One director resigned, one appointed", severity: "Review", source: "Companies House" },
  164: { name: "Fenwright Motors Ltd", no: "12207718", finding: "Charge registered against company assets", severity: "Review", source: "Companies House" },
};

export const CLIENTS = (() => {
  const r = rng(19);
  const used = new Set();
  return Array.from({ length: 200 }, (_, i) => {
    if (FLAGGED[i]) return { i, ...FLAGGED[i], flagged: true };
    let name;
    do { name = FIRST[Math.floor(r() * FIRST.length)] + " " + TRADE[Math.floor(r() * TRADE.length)] + " Ltd"; } while (used.has(name));
    used.add(name);
    const no = String(Math.floor(r() * 9e7) + 1e7).padStart(8, "0");
    return { i, name, no, finding: "No changes since last week", severity: "None", source: "Companies House", flagged: false };
  });
})();

export const TIMELINE = [
  { date: "2025-11-03", label: "Confirmation statement filed", level: "none", source: "Companies House", note: "Routine filing. No alert sent." },
  { date: "2026-02-14", label: "Registered office moved", level: "review", source: "Companies House", note: "First alert. The registered office moved to a formation agent's address." },
  { date: "2026-04-30", label: "Director resigned", level: "review", source: "Companies House", note: "One of two directors resigned. Alert sent to #client-health." },
  { date: "2026-07-01", label: "Accounts overdue", level: "review", source: "Companies House", note: "Annual accounts due 30 June were not filed. Alert sent with the due date." },
  { date: "2026-08-19", label: "Charge registered", level: "review", source: "Companies House", note: "A lender registered a charge against the company's assets." },
  { date: "2026-10-17", label: "Administrators appointed", level: "critical", source: "The Gazette", note: "Notice of appointment of administrators published. Critical alert sent." },
];

export const DISTRICTS = [
  ...Array.from({ length: 35 }, (_, i) => "M" + (i + 1)),
  "M38", "M40", "M41", "M43", "M44", "M45", "M46", "M50",
];
export const DEFAULT_DISTRICTS = ["M1", "M2", "M3", "M4", "M15", "M16", "M20", "M21", "M50"];

export const WEEKS = [
  { w: "1 Sep", n: 3 }, { w: "8 Sep", n: 5 }, { w: "15 Sep", n: 2 }, { w: "22 Sep", n: 6 },
  { w: "29 Sep", n: 4 }, { w: "6 Oct", n: 7 }, { w: "13 Oct", n: 3 }, { w: "20 Oct", n: 8 },
];

export const USAGE = [
  ["Ellacombe Print Ltd", "Book watch", 1, 1.0],
  ["Tarnbrook Logistics Ltd", "Book watch", 1, 1.0],
  ["Brackenvale Dental Ltd", "Book watch, new-client check", 2, 1.4],
  ["Fenwright Motors Ltd", "Book watch", 1, 1.0],
  ["Harlow Vale Studios Ltd", "New-client check", 0, 0.4],
];

/* ---------- Deeper data for the site ---------- */

export const fmtDate = (d) => {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d.slice(8))} ${m[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
};

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Register history for every client in the example book.
export function clientHistory(c) {
  const r = rng(Number(c.no.slice(-6)) || 7);
  const incY = 2004 + Math.floor(r() * 18);
  const inc = iso(incY, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 27));
  const csDay = iso(2026, 1 + Math.floor(r() * 8), 1 + Math.floor(r() * 27));
  const accDay = iso(2026, 1 + Math.floor(r() * 9), 1 + Math.floor(r() * 27));
  const directors = 1 + Math.floor(r() * 3);
  const base = {
    incorporated: inc, directors, psc: 1 + Math.floor(r() * 2),
    status: "Active", sic: ["69201", "62020", "70229", "71111", "47190", "86230", "49410", "18129"][Math.floor(r() * 8)],
    office: ["Manchester", "Salford", "Stockport", "Bolton", "Oldham", "Trafford"][Math.floor(r() * 6)],
    since: 2016 + Math.floor(r() * 10), users: 4 + Math.floor(r() * 40), fee: 300 + Math.floor(r() * 30) * 50,
  };
  let events = [
    { date: accDay, label: "Annual accounts filed", level: "none", source: "Companies House" },
    { date: csDay, label: "Confirmation statement filed", level: "none", source: "Companies House" },
  ];
  if (c.i === 23) {
    base.status = "Active, in administration";
    events = TIMELINE.map((e) => ({ date: e.date, label: e.label, level: e.level, source: e.source }));
  } else if (c.i === 57) {
    events = [
      { date: "2025-09-29", label: "Annual accounts filed", level: "none", source: "Companies House" },
      { date: "2026-03-11", label: "Confirmation statement filed", level: "none", source: "Companies House" },
      { date: "2026-10-01", label: "Accounts overdue", level: "review", source: "Companies House" },
    ];
  } else if (c.i === 118) {
    events.push({ date: "2026-10-14", label: "Director resigned, director appointed", level: "review", source: "Companies House" });
  } else if (c.i === 164) {
    events.push({ date: "2026-10-16", label: "Charge registered", level: "review", source: "Companies House" });
  }
  events.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { ...base, events };
}

export const ALERTS = [
  { id: "al-1041", client: 23, when: "2026-10-20T07:02", agent: "Client book watch", title: "Administrators appointed", severity: "Critical",
    summary: "A notice of appointment of administrators was published in The Gazette on 17 October 2026.",
    facts: [["Status", "Active, in administration", "Companies House"], ["Notice", "Appointment of administrators", "The Gazette"], ["Next invoice", "1 Nov 2026, £1,450", "Your client list"]],
    next: "Hold new project work and talk to your finance lead before the 1 November invoice." },
  { id: "al-1040", client: 57, when: "2026-10-20T07:02", agent: "Client book watch", title: "Accounts overdue", severity: "Review",
    summary: "Annual accounts were due at Companies House on 30 September 2026 and have not been filed.",
    facts: [["Accounts due", "30 Sep 2026, overdue", "Companies House"], ["Last filed", "29 Sep 2025", "Companies House"], ["Client since", "March 2024, 14 users", "Your client list"]],
    next: "Check payment terms and recent payment history before the next invoice." },
  { id: "al-1039", client: 164, when: "2026-10-20T07:01", agent: "Client book watch", title: "Charge registered", severity: "Review",
    summary: "A lender registered a charge against the company's assets on 16 October 2026.",
    facts: [["Charge", "Registered 16 Oct 2026", "Companies House"], ["Status", "Active", "Companies House"], ["Client since", "2022, 9 users", "Your client list"]],
    next: "Usually routine borrowing. Worth noting alongside any late payments." },
  { id: "al-1038", client: 118, when: "2026-10-19T07:01", agent: "Client book watch", title: "Director changed", severity: "Review",
    summary: "One director resigned and one was appointed on 14 October 2026.",
    facts: [["Officers", "1 resigned, 1 appointed", "Companies House"], ["Effective", "14 Oct 2026", "Companies House"], ["Your contact", "May need updating", "Your client list"]],
    next: "Confirm who now signs off IT spend and update the contract contact." },
];

export const BOOK_CHECKS = [
  ["Company status", "Companies House", "Status changes from active, for example to administration, liquidation or dissolved", "Critical"],
  ["Insolvency notices", "The Gazette", "Any new corporate insolvency notice naming the company", "Critical"],
  ["Strike-off notice", "The Gazette", "A first notice of compulsory or voluntary strike-off is published", "Critical"],
  ["Annual accounts", "Companies House", "The filing deadline passes without accounts being filed", "Review"],
  ["Confirmation statement", "Companies House", "The filing deadline passes without a statement being filed", "Review"],
  ["Officers", "Companies House", "A director is appointed or resigns", "Review"],
  ["People with significant control", "Companies House", "A person with significant control is added or ceases", "Review"],
  ["Registered office", "Companies House", "The registered office address changes", "Review"],
  ["Charges", "Companies House", "A new charge is registered against the company", "Review"],
  ["FCA status", "FCA register", "Authorisation status changes, where the company is listed", "Review"],
];

export const SAMPLE_CHECKS = {
  harlow: {
    label: "Harlow Vale Studios", input: "Harlow Vale Studios", outcome: "clear",
    company: "Harlow Vale Studios Ltd", no: "13985402", confidence: "High, matched on name and registered postcode",
    flags: [],
    rows: [["Status", "Active", 1], ["Incorporated", "4 March 2022", 1], ["Accounts", "Filed to date; next due 31 March 2027", 1], ["Confirmation statement", "Filed to date", 1], ["Officers", "2 directors, no changes in 12 months", 1], ["Charges", "None registered", 1], ["Insolvency notices", "None in the last 12 months", 2], ["FCA register", "Not listed; not required for this activity", 3]],
  },
  tarnbrook: {
    label: "Tarnbrook Logistics, invoice INV-2207", input: "Tarnbrook Logistics, invoice INV-2207", outcome: "flags",
    company: "Tarnbrook Logistics Ltd", no: "11420987", confidence: "High, matched on company number in the invoice",
    flags: ["Annual accounts overdue since 30 September 2026"],
    rows: [["Status", "Active", 1], ["Incorporated", "18 June 2018", 1], ["Accounts", "Overdue; were due 30 September 2026", 1], ["Confirmation statement", "Filed to date", 1], ["Officers", "1 director, no changes in 12 months", 1], ["Charges", "1 outstanding, registered 2021", 1], ["Insolvency notices", "None in the last 12 months", 2], ["FCA register", "Not listed; not required for this activity", 3]],
  },
  corriemoor: {
    label: "Corriemoor Interiors", input: "Corriemoor Interiors", outcome: "confirm",
    company: null, no: null, confidence: "Two companies match this name. We won't guess.",
    candidates: [["Corriemoor Interiors Ltd", "10833126", "Active", "Stockport"], ["Corriemoor Interiors (North) Ltd", "12940577", "Active", "Bolton"]],
    flags: [], rows: [],
  },
};

export const SIC_GROUPS = [
  ["69", "Legal and accounting activities"],
  ["70", "Head offices and management consultancy"],
  ["71", "Architectural and engineering activities"],
  ["62", "Computer programming and consultancy"],
  ["86", "Human health activities"],
  ["47", "Retail trade"],
  ["41", "Construction of buildings"],
  ["68", "Real estate activities"],
];

export const PROSPECTS = [
  ["Ashworth Hale Solicitors Ltd", "09112783", "M2", "69102", "2015"],
  ["Peel Street Accountants Ltd", "10284419", "M3", "69201", "2016"],
  ["Castlefield Structural Ltd", "08760034", "M15", "71122", "2013"],
  ["Whalley Range Advisory Ltd", "11893350", "M16", "70229", "2019"],
  ["Didsbury Chartered Ltd", "07734512", "M20", "69201", "2011"],
  ["Chorlton Design Engineers Ltd", "12017742", "M21", "71129", "2019"],
  ["Ancoats Legal Services Ltd", "10562278", "M4", "69109", "2017"],
  ["Quayside Management Ltd", "09954106", "M50", "70221", "2016"],
  ["Spinningfields Tax Ltd", "11320871", "M3", "69203", "2018"],
  ["Northern Quarter Surveying Ltd", "08455290", "M1", "71121", "2013"],
];

export const ENDPOINTS = [
  { k: "tools", method: "GET", path: "/v1/tools", what: "The catalogue: every tool with its price, input schema and how to call it. Free, no key.",
    req: `GET https://api.example.com/v1/tools`,
    res: `200 OK
{
  "tools": [
    {
      "slug": "company-research",
      "name": "Company research",
      "description": "One sourced brief on a UK company …",
      "input_schema": { "type": "object", "properties": { "name": { … } } },
      "price": { "pence": 8, "usdc_atomic": "100000" },
      "publisher": "Agent House",
      "call": "POST https://api.example.com/v1/tools/company-research"
    },
    …
  ],
  "agents_run": { "call": "POST /v1/agents/run", "price": { "per_step_pence": 12, "default_steps": 4, "max_steps": 8 } },
  "payment": { "x402": { "version": 2, "network": "eip155:8453" },
               "api_key": { "free_calls_per_month": 100 } },
  "signing_key": "/.well-known/agent-house-key"
}` },
  { k: "call", method: "POST", path: "/v1/tools/{slug}", what: "Call any tool in the catalogue with its input as JSON. Pay with x402 or a key.",
    req: `POST https://api.example.com/v1/tools/read-page
Authorization: Bearer ah_live_…
Content-Type: application/json

{ "url": "https://peelstreet.example" }`,
    res: `200 OK
{
  "response_id": "tool_6b1e90",
  "tool": "read-page",
  "result": {
    "url": "https://peelstreet.example/",
    "title": "Peel Street Accountants",
    "text": "…",
    "emails_on_page": ["office@peelstreet.example"]
  },
  "checked_at": "2026-10-21T09:12:00Z",
  "key_id": "ah-2026-10",
  "signature": "ed25519:…"
}` },
  { k: "agents", method: "POST", path: "/v1/agents/run", what: "Run an agent: instructions plus up to eight first-party tools. 12p a step, for the steps you allow (default 4). Not covered by the free calls.",
    req: `POST https://api.example.com/v1/agents/run
Authorization: Bearer ah_live_…
Content-Type: application/json

{
  "instructions": "Find three dental practices in Leeds city centre with a website.",
  "tools": ["find-companies", "company-research", "read-page"],
  "max_steps": 6
}`,
    res: `200 OK
{
  "response_id": "agr_41c7e2",
  "output": "1. Kirkgate Dental Ltd …",
  "steps": [
    { "tool": "find-companies", "input": { … }, "ok": true },
    { "tool": "company-research", "input": { … }, "ok": true }
  ],
  "usage": { "model_steps": 6, "tokens_in": 9120, "tokens_out": 640 },
  "key_id": "ah-2026-10",
  "signature": "ed25519:…"
}` },
  { k: "publish", method: "POST", path: "/api/dev/tools", what: "Publish your endpoint as a tool. Reviewed, then live in the catalogue and on MCP.",
    req: `POST https://api.example.com/api/dev/tools
Authorization: Bearer ah_live_…
Content-Type: application/json

{
  "slug": "uk-vat-check",
  "name": "UK VAT number check",
  "description": "Whether a VAT number is valid, and the business it belongs to.",
  "endpoint": "https://vat.example.com/check",
  "price_pence": 3,
  "input_schema": { "type": "object", "properties": { "number": { "type": "string" } } }
}`,
    res: `201 Created
{
  "slug": "uk-vat-check",
  "status": "review",
  "signing_secret": "ahs_…",
  "message": "We'll review it within one working day. Keep the signing secret: it's shown once …"
}` },
  { k: "resolve", method: "POST", path: "/v1/resolve", what: "Turn messy input into ranked candidate companies with confidence and reasons.",
    req: `POST https://api.example.com/v1/resolve
Authorization: Bearer ah_live_…
Content-Type: application/json

{
  "input": "Corriemoor Interiors, Stockport"
}`,
    res: `200 OK
{
  "response_id": "res_51ac09",
  "input": "Corriemoor Interiors, Stockport",
  "confidence": "high",
  "candidates": [
    {
      "name": "CORRIEMOOR INTERIORS LTD",
      "number": "10833126",
      "status": "active",
      "postcode": "SK1 3AZ",
      "score": 0.98,
      "reasons": ["name", "registered town"]
    },
    {
      "name": "CORRIEMOOR INTERIORS (NORTH) LTD",
      "number": "12940577",
      "status": "active",
      "postcode": "BL1 1RU",
      "score": 0.62,
      "reasons": ["partial name"]
    }
  ],
  "checked_at": "2026-10-20T09:12:00Z",
  "key_id": "ah-2026-10",
  "signature": "ed25519:…"
}` },
  { k: "profile", method: "GET", path: "/v1/companies/{number}", what: "Every sourced field for one company.",
    req: `GET https://api.example.com/v1/companies/13985402
Authorization: Bearer ah_live_…`,
    res: `200 OK
{
  "response_id": "prf_77d210",
  "name": { "value": "HARLOW VALE STUDIOS LTD",
            "source": "Companies House",
            "retrieved_at": "2026-10-20T09:12:00Z",
            "licence": "Open Government Licence v3.0" },
  "status": { "value": "active", "source": "Companies House", … },
  "accounts_next_due": { "value": "2027-03-31", … },
  "officers": { "value": [{ "name": "…", "role": "director" }], … },
  "insolvency_notices": { "value": [], "source": "The Gazette", … },
  "fca_status": { "value": null, "source": "FCA register",
                  "licence": "FCA register terms", … },
  "key_id": "ah-2026-10",
  "signature": "ed25519:…"
}` },
  { k: "check", method: "POST", path: "/v1/check", what: "Resolve, profile and flag in one call, for the moment before you pay or sign.",
    req: `POST https://api.example.com/v1/check
Authorization: Bearer ah_live_…
Content-Type: application/json

{
  "input": "Tarnbrook Logistics, INV-2207"
}`,
    res: `200 OK
{
  "response_id": "chk_8f2c41",
  "status": "matched",
  "match": {
    "name": "TARNBROOK LOGISTICS LTD",
    "number": "11420987",
    "confidence": "high",
    "reasons": ["name"]
  },
  "flags": [{
    "check": "accounts",
    "severity": "Review",
    "text": "Accounts overdue",
    "detail": "Annual accounts were due 30 September 2026.",
    "source": "Companies House"
  }],
  "rows": [["Status", "Active", 1], …],
  "fields": { … every sourced field … },
  "checked_at": "2026-10-20T07:01:00Z",
  "key_id": "ah-2026-10",
  "signature": "ed25519:…"
}

# When the match is uncertain:
# "status": "needs_human_confirmation",
# with "candidates" and no flags. It never guesses.` },
  { k: "watch", method: "POST", path: "/v1/watch", what: "Subscribe to changes on a set of companies and receive them by webhook.",
    req: `POST https://api.example.com/v1/watch
Authorization: Bearer ah_live_…
Content-Type: application/json

{
  "numbers": ["11420987", "08812234"],
  "webhook": "https://your-app.example.com/hooks/agent-house"
}`,
    res: `201 Created
{
  "watch_id": "wch_0c93be",
  "companies": 2,
  "delivery": "Signed webhook per change, as each change arrives"
}

# Each change is POSTed to your webhook, signed
# like every other response. Stop with
# DELETE /v1/watch/wch_0c93be` },
];
