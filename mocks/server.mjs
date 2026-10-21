// Local stand-ins for every outside service, so the whole system runs offline.
// Companies House REST + Streaming API, The Gazette, the FCA register, an x402 facilitator,
// Stripe, and capture endpoints for Teams and Slack webhooks. Shapes follow the real services.
import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.MOCK_PORT || 8788);
const CH_KEY = process.env.MOCK_CH_KEY || "dev-key";

/* ---------- Seed data ---------- */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FIRST = ["Ashdown", "Brindle", "Calder", "Dunmore", "Elsworth", "Fairhaven", "Garside", "Holcombe", "Irwell", "Kersal", "Linthorpe", "Marston", "Northcote", "Oakhurst", "Pennine", "Quarry Bank", "Radcliffe", "Saddleworth", "Thornley", "Upholland", "Vale Royal", "Whitworth", "Yarrow", "Alder", "Bramhall", "Cheadle", "Didsbury", "Edgeley", "Furness", "Goyt"];
const TRADE = ["Joinery", "Dental", "Logistics", "Print", "Studios", "Accountancy", "Motors", "Interiors", "Legal", "Care", "Engineering", "Foods", "Architects", "Recruitment", "Lettings", "Surveyors", "Opticians", "Veterinary", "Plastics", "Wholesale"];
const PCS = ["M1 2AB", "M2 4WU", "M3 3EB", "M4 6DE", "M15 4PS", "M16 9PD", "M20 2RN", "M21 9AF", "M50 3UB", "SK4 1AA", "BL1 1RU", "OL1 1HD"];
const pad = (n) => String(n).padStart(2, "0");

const companies = new Map();
function addCompany(c) {
  companies.set(c.company_number, {
    company_status: "active", sic_codes: ["62020"], officers: [{ name: "SMITH, Alex", officer_role: "director", appointed_on: "2016-03-01", id: c.company_number + "-o1" }],
    psc: [{ name: "Alex Smith", kind: "individual-person-with-significant-control", notified_on: "2016-06-30", id: c.company_number + "-p1" }],
    charges: [], gazette: [], fca: null, accounts: { next_due: "2027-03-31", last_accounts: { made_up_to: "2025-06-30" }, overdue: false },
    confirmation_statement: { next_due: "2027-02-14", overdue: false }, ...c,
  });
}
function seed() {
  companies.clear();
  const r = rng(19); const used = new Set();
  for (let i = 0; i < 200; i++) {
    let name; do { name = FIRST[Math.floor(r() * FIRST.length)] + " " + TRADE[Math.floor(r() * TRADE.length)] + " Ltd"; } while (used.has(name));
    used.add(name);
    const no = String(Math.floor(r() * 9e7) + 1e7);
    const y = 2004 + Math.floor(r() * 18);
    addCompany({ company_number: no, company_name: name.toUpperCase(), date_of_creation: `${y}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 27))}`,
      registered_office_address: { address_line_1: `${1 + Math.floor(r() * 200)} High Street`, locality: "Manchester", postal_code: PCS[Math.floor(r() * PCS.length)] } });
  }
  addCompany({ company_number: "08812234", company_name: "ELLACOMBE PRINT LTD", date_of_creation: "2013-12-02", registered_office_address: { address_line_1: "4 Mill Lane", locality: "Bolton", postal_code: "BL1 1RU" }, sic_codes: ["18129"],
    officers: [{ name: "ELLACOMBE, Jo", officer_role: "director", appointed_on: "2013-12-02", id: "08812234-o1" }, { name: "PATEL, Sam", officer_role: "director", appointed_on: "2018-05-01", id: "08812234-o2" }] });
  addCompany({ company_number: "11420987", company_name: "TARNBROOK LOGISTICS LTD", date_of_creation: "2018-06-18", registered_office_address: { address_line_1: "Unit 7, Trafford Park", locality: "Manchester", postal_code: "M17 1AA" }, sic_codes: ["49410"],
    accounts: { next_due: "2026-09-30", last_accounts: { made_up_to: "2024-12-31" }, overdue: true }, charges: [{ id: "chg-tarn-1", created_on: "2021-04-12", status: "outstanding", persons_entitled: [{ name: "Northern Bank plc" }] }] });
  addCompany({ company_number: "06173520", company_name: "BRACKENVALE DENTAL LTD", date_of_creation: "2007-03-20", registered_office_address: { address_line_1: "2 Wilmslow Road", locality: "Manchester", postal_code: "M20 2RN" }, sic_codes: ["86230"] });
  addCompany({ company_number: "12207718", company_name: "FENWRIGHT MOTORS LTD", date_of_creation: "2019-09-16", registered_office_address: { address_line_1: "Station Approach", locality: "Stockport", postal_code: "SK4 1AA" }, sic_codes: ["45111"] });
  addCompany({ company_number: "13985402", company_name: "HARLOW VALE STUDIOS LTD", date_of_creation: "2022-03-04", registered_office_address: { address_line_1: "21 Quay Street", locality: "Manchester", postal_code: "M3 3EB" }, sic_codes: ["74100"],
    officers: [{ name: "HARLOW, Kim", officer_role: "director", appointed_on: "2022-03-04", id: "13985402-o1" }, { name: "VALE, Chris", officer_role: "director", appointed_on: "2022-03-04", id: "13985402-o2" }] });
  addCompany({ company_number: "10833126", company_name: "CORRIEMOOR INTERIORS LTD", date_of_creation: "2017-06-21", registered_office_address: { address_line_1: "9 Castle Street", locality: "Stockport", postal_code: "SK4 1AA" } });
  addCompany({ company_number: "12940577", company_name: "CORRIEMOOR INTERIORS (NORTH) LTD", date_of_creation: "2020-10-07", registered_office_address: { address_line_1: "40 Deansgate", locality: "Bolton", postal_code: "BL1 1RU" } });
  addCompany({ company_number: "09112783", company_name: "ASHWORTH HALE SOLICITORS LTD", date_of_creation: "2014-07-01", registered_office_address: { locality: "Manchester", postal_code: "M2 4WU" }, sic_codes: ["69102"], fca: null });
}
seed();

/* ---------- Event plumbing ---------- */
let timepoint = 1000;
const streamClients = new Map(); // stream -> Set(res)
const backlog = []; // {stream, line, tp}
const gazetteFeed = [];
const captured = [];
let claudeFailures = 0; // the next N Messages API calls answer 529 overloaded, to exercise retries
let gazetteId = 900000;

function emit(stream, number, kind) {
  timepoint++;
  const c = companies.get(number);
  const line = JSON.stringify({ resource_kind: kind, resource_uri: `/company/${number}`, resource_id: number, data: { company_number: number, company_name: c?.company_name }, event: { timepoint, published_at: new Date().toISOString().slice(0, 19), type: "changed" } });
  backlog.push({ stream, line, tp: timepoint });
  for (const res of streamClients.get(stream) || []) res.write(line + "\n");
}

function mutate(number, change) {
  const c = companies.get(number);
  if (!c) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (change.status) { c.company_status = change.status; emit("companies", number, "company-profile"); }
  if (change.accounts_overdue) { c.accounts = { ...c.accounts, overdue: true, next_due: change.accounts_due || "2026-09-30" }; emit("companies", number, "company-profile"); }
  if (change.officer_resigned) { const o = c.officers.find((x) => !x.resigned_on); if (o) o.resigned_on = today; emit("officers", number, "company-officers"); }
  if (change.officer_appointed) { c.officers.push({ name: change.officer_appointed, officer_role: "director", appointed_on: today, id: number + "-o" + (c.officers.length + 1) }); emit("officers", number, "company-officers"); }
  if (change.charge) { c.charges.push({ id: "chg-" + number + "-" + (c.charges.length + 1), created_on: today, status: "outstanding", persons_entitled: [{ name: change.charge }] }); emit("charges", number, "company-charges"); }
  if (change.office_postcode) { c.registered_office_address = { ...c.registered_office_address, address_line_1: change.office_line || "1 New Street", postal_code: change.office_postcode }; emit("companies", number, "company-profile"); }
  if (change.gazette) {
    const n = { id: ++gazetteId, company_number: number, category: change.gazette.category, title: change.gazette.title, published: today };
    c.gazette.push(n); gazetteFeed.push(n);
  }
  return c;
}

/* ---------- HTTP ---------- */
const json = (res, code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let d = ""; req.on("data", (x) => (d += x)); req.on("end", () => ok(d)); });

function chAuth(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Basic ") && Buffer.from(h.slice(6), "base64").toString().split(":")[0] === CH_KEY;
}

function profile(c) {
  const { officers, psc, charges, gazette, fca, ...p } = c;
  return { ...p, links: { self: `/company/${c.company_number}` } };
}


/* ---------- Scripted Claude ---------- */
function toolResults(messages) {
  const out = [];
  for (const m of messages) if (m.role === "user" && Array.isArray(m.content)) for (const blk of m.content) if (blk.type === "tool_result") { try { out.push(JSON.parse(blk.content)); } catch { out.push({ error: blk.content }); } }
  return out;
}
const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("\n") : "";
/* The Swarm engine's planner: a recruitment swarm with custom roles. "needs a retry" first answers with a
   tool that doesn't exist, to exercise the correction round; "unusable" never answers with JSON. */
const RECRUITMENT = {
  name: "Recruitment desk", sector: "Recruitment agency", goals: ["Find companies hiring now", "Start conversations with hiring managers"],
  agents: [
    { key: "scout", name: "Job scout", role: "Finds companies that are hiring in the area", template: "custom", rhythm: "weekdays", run_hour: 7,
      tools: ["business-profile", "find-companies", "company-research", "read-page", "save-lead", "create-task"],
      instructions: "1. Read the business profile.\n2. Find companies that are hiring the roles we place.\n3. Save each as a lead with its published email, and hand it to outreach." },
    { key: "outreach", name: "Outreach", role: "Writes to hiring managers", template: "outreach", rhythm: "weekdays", run_hour: 9 },
    { key: "inbox", name: "Inbox", role: "Answers replies", template: "inbox", rhythm: "on_event" },
  ],
  stages: [
    { key: "spotted", name: "Spotted", agent: "scout", rule: { source: "lead", status: ["new"], has_email: false } },
    { key: "ready", name: "Ready", agent: "outreach", rule: { source: "lead", status: ["new"], has_email: true } },
    { key: "pitched", name: "Pitched", agent: "outreach", rule: { source: "lead", status: ["contacted"] } },
    { key: "talking", name: "Talking", agent: "inbox", rule: { source: "lead", status: ["replied"] } },
    { key: "client", name: "Client", agent: "inbox", rule: { source: "lead", status: ["won"] }, done: true },
  ],
  handoffs: [{ from: "scout", to: "outreach", when: "A hiring company has a published email" }],
  kpis: ["new_leads_week", "emails_sent_week", "replies_week", "won_month"], skin: "floor", needs: [],
};
function plannerReply(b) {
  const desc = textOf(b.messages[0].content), turn = b.messages.filter((m) => m.role === "assistant").length;
  const reply = (text) => ({ id: "msg_plan", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 4200, output_tokens: 900 } });
  if (/unusable/i.test(desc)) return reply("Sorry, I can't design that.");
  if (/needs a retry/i.test(desc) && turn === 0) return reply(JSON.stringify({ ...RECRUITMENT, agents: RECRUITMENT.agents.map((a, i) => (i === 0 ? { ...a, tools: [...a.tools, "linkedin-scrape"] } : a)) }));
  return reply("Here is the swarm:\n" + JSON.stringify(RECRUITMENT));
}
/* The command router: answers questions, otherwise sends the instruction to the agent it names. */
function routerReply(b) {
  const q = textOf(b.messages[0].content);
  const agents = [...(b.system.match(/^Agents: (.*)$/m)?.[1] || "").matchAll(/([a-z][a-z0-9-]*) \(([^:,)]+)/g)].map((m) => ({ key: m[1], name: m[2] }));
  const reply = (o) => ({ id: "msg_route", type: "message", role: "assistant", content: [{ type: "text", text: JSON.stringify(o) }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60 } });
  if (/\?\s*$|^how many|^what/i.test(q)) return reply({ type: "answer", answer: "From the Floor: " + (b.system.match(/^Facts: (.*)$/m)?.[1] || "nothing yet") });
  const a = agents.find((x) => q.toLowerCase().includes(x.key) || q.toLowerCase().includes(x.name.toLowerCase().split(" ")[0])) || agents[0];
  return reply({ type: "instruct", agent: a?.key, input: q });
}

function mockClaude(raw) {
  // The API takes system as a string or as cached text blocks; normalise both.
  const b = { ...raw, system: textOf(raw.system) };
  if (b.system.startsWith("SWARM BLUEPRINT")) return plannerReply(b);
  if (b.system.startsWith("COMMAND ROUTER")) return routerReply(b);
  const tpl = ((b.system || "").match(/TEMPLATE: ([\w-]+)/) || [])[1] || "adhoc";
  const H = toolResults(b.messages);
  const last = H[H.length - 1];
  const turn = b.messages.filter((m) => m.role === "assistant").length;
  const userText = textOf(b.messages[0].content);
  const use = (name, input) => ({ id: "msg_" + turn, type: "message", role: "assistant", content: [{ type: "text", text: `Next: ${name}.` }, { type: "tool_use", id: "toolu_" + Math.random().toString(36).slice(2, 12), name, input }], stop_reason: "tool_use", usage: { input_tokens: 1500, output_tokens: 120 } });
  const done = (text) => ({ id: "msg_" + turn, type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1800, output_tokens: 220 } });
  const has = (t) => (b.tools || []).some((x) => x.name === t);
  // Like the real model, write from the business profile in the system prompt.
  let prof = {};
  try { prof = JSON.parse(((b.system || "").match(/Business profile:\n(\{.*\})/) || [])[1] || "{}"); } catch {}
  const sign = prof.sign_off || prof.name || "The team";
  const what = prof.what ? prof.what.charAt(0).toLowerCase() + prof.what.slice(1) : "what we do";
  if (tpl === "outreach") {
    if (turn === 0) return use("business-profile", {});
    if (turn === 1) return use("find-companies", { districts: ["M2", "M3"], sic: ["69"], min_age: 3, limit: 2 });
    const found = H[1]?.companies || [];
    if (!found.length) return done("No new companies matched your ideal customer today.");
    const co = found[0];
    if (turn === 2) return use("company-research", { input: co.name });
    if (turn === 3) return use("read-page", { url: H[2]?.likely_website || "http://127.0.0.1:8788/web/none" });
    const email = H[3]?.emails_on_page?.[0];
    if (turn === 4) return use("save-lead", { company: co.name, number: co.number, email, website: H[3]?.url, notes: `Established ${co.incorporated?.slice(0, 4)} firm in ${co.district}.` });
    if (turn === 5 && email) return use("propose-email", { to: email, lead_id: H[4].lead_id, subject: `A quick idea for ${co.name.replace(/ LTD$/, "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}`, body: `Hello,\n\nI noticed you've been serving businesses in ${co.district} since ${co.incorporated?.slice(0, 4)}. We look after ${what} for firms like yours.\n\nWould a 15-minute call next week be useful?\n\nBest wishes,\n${sign}`, reason: "Matches the ideal customer: established firm in the area" });
    if (turn === 5) return use("create-task", { title: `Find a contact at ${co.name}`, detail: "No email is published on their website." });
    return done(`Found ${found.length} new ${found.length === 1 ? "company" : "companies"}; researched ${co.name} and ${email ? "drafted a first email for your approval" : "added a task to find a contact"}.`);
  }
  if (tpl === "inbox") {
    if (turn === 0) return use("list-inbox", {});
    const msgs = H[0]?.messages || [];
    if (!msgs.length) return done("No new messages.");
    const m = msgs[0];
    if (turn === 1) return use("triage-message", { id: m.id, urgency: "high", category: "quote", summary: `Asks for a quote: ${m.subject}` });
    if (turn === 2) return use("propose-email", { to: m.from_addr, message_id: m.id, subject: `Re: ${m.subject}`, body: "Hello,\n\nThanks for getting in touch. We'd be glad to help. Could you tell us how many people are in your office, and when you'd like to start? We'll come back with a quote the same day.\n\nKind regards,\n" + sign, reason: "Quote request: reply asking for the details we need" });
    return done(`Triaged 1 message (quote request, high urgency) and drafted a reply for approval.`);
  }
  if (tpl === "custom" && (b.tools || []).some((t) => t.name === "find-companies")) {
    // A prospector-style custom role: find one company, research it, save it, and hand it to outreach.
    if (turn === 0) return use("business-profile", {});
    if (turn === 1) return use("find-companies", { districts: ["M2", "M3"], sic: ["69"], min_age: 3, limit: 1 });
    const found = H[1]?.companies || [];
    if (!found.length) return done("No new companies matched today.");
    const co = found[0];
    if (turn === 2) return use("company-research", { input: co.name });
    if (turn === 3) return use("read-page", { url: H[2]?.likely_website || "http://127.0.0.1:8788/web/none" });
    const email = H[3]?.emails_on_page?.[0];
    if (turn === 4) return use("save-lead", { company: co.name, number: co.number, email, website: H[3]?.url, notes: `Established ${co.incorporated?.slice(0, 4)} firm in ${co.district}.` });
    const target = (b.system.match(/You may hand work to: ([a-z][a-z0-9-]*)/) || [])[1];
    if (turn === 5 && email && H[4]?.card_id && target) return use("hand-off", { item_id: H[4].card_id, to: target, note: `Established firm in ${co.district}; a business email is published on their site.` });
    if (turn === 5 && !email) return use("create-task", { title: `Find a contact at ${co.name}`, detail: "No email is published on their website." });
    return done(`Found ${co.name}${email && target ? ` and handed it to ${target}` : ""}.`);
  }
  if (tpl === "credit-control") {
    if (turn === 0) return use("list-invoices", { overdue_only: true });
    const inv = (H[0]?.invoices || []).find((i) => i.email && i.reminders < 3);
    if (!inv) return done("No overdue invoices need a reminder today.");
    if (turn === 1) return use("propose-email", { to: inv.email, invoice_id: inv.id, subject: `Invoice ${inv.ref}: a friendly reminder`, body: `Hello,\n\nA quick reminder that invoice ${inv.ref} for ${inv.amount} was due on ${inv.due_date}. If it's already on its way, thank you. If not, could you let us know when to expect it?\n\nKind regards,\n${sign}`, reason: `${inv.days_overdue} days overdue, no reminder yet` });
    return done(`Drafted a reminder for invoice ${inv.ref}.`);
  }
  if (tpl === "research") {
    const q = userText.split("\n").slice(-1)[0] || "the question";
    if (turn === 0) return use("web-research", { query: q });
    if (turn === 1 && H[0]?.results?.[0]) return use("read-page", { url: H[0].results[0].url });
    return done(`${q}: they are an established Manchester firm working with local businesses since 2014.\n\n- Contact: published on their website\n\nSources:\n- ${H[0]?.results?.[0]?.url || "none found"}`);
  }
  if (tpl === "briefing") {
    if (turn === 0) return use("recent-activity", { days: 7 });
    if (turn === 1) return use("notify-owner", { text: `Needs you: ${H[0]?.waiting_for_approval ?? 0} emails waiting for approval, ${H[0]?.open_tasks?.length ?? 0} open tasks.\nDone: ${(H[0]?.runs || []).reduce((s, r) => s + r.runs, 0)} agent runs this week.` });
    return done("Sent this week's briefing.");
  }
  // Ad-hoc runs from the Agents API: call the first tool once, then answer.
  if (turn === 0 && (b.tools || []).length) {
    const t = b.tools[0];
    const props = Object.keys(t.input_schema?.properties || {});
    const input = props.includes("input") ? { input: userText } : props.includes("query") ? { query: userText } : props.includes("url") ? { url: userText } : {};
    return use(t.name, input);
  }
  return done(`Answer: ${last ? JSON.stringify(last).slice(0, 300) : "no tools were needed"}`);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  try {
    /* Companies House REST */
    if (p.startsWith("/ch/")) {
      if (!chAuth(req)) return json(res, 401, { error: "Invalid Authorization" });
      const q = p.slice(3);
      if (q === "/search/companies") {
        const terms = (u.searchParams.get("q") || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !["ltd", "limited", "the"].includes(t));
        const items = [...companies.values()].filter((c) => terms.length && terms.every((t) => c.company_name.toLowerCase().includes(t)) || terms.some((t) => t.length > 4 && c.company_name.toLowerCase().split(/\s+/)[0] === t))
          .slice(0, 10).map((c) => ({ title: c.company_name, company_number: c.company_number, company_status: c.company_status, address: { locality: c.registered_office_address.locality, postal_code: c.registered_office_address.postal_code } }));
        return json(res, 200, { items, total_results: items.length });
      }
      const m = q.match(/^\/company\/([A-Z0-9]{8})(\/[a-z-]+)?$/i);
      if (m) {
        const c = companies.get(m[1].toUpperCase());
        if (!c) return json(res, 404, { errors: [{ error: "company-profile-not-found" }] });
        if (!m[2]) return json(res, 200, profile(c));
        if (m[2] === "/officers") return json(res, 200, { items: c.officers.map((o) => ({ name: o.name, officer_role: o.officer_role, appointed_on: o.appointed_on, resigned_on: o.resigned_on, links: { officer: { appointments: `/officers/${o.id}/appointments` } } })) });
        if (m[2] === "/persons-with-significant-control") return json(res, 200, { items: c.psc.map((x) => ({ name: x.name, kind: x.kind, notified_on: x.notified_on, ceased_on: x.ceased_on, links: { self: `/company/${c.company_number}/persons-with-significant-control/individual/${x.id}` } })) });
        if (m[2] === "/charges") return json(res, 200, { items: c.charges });
      }
      return json(res, 404, { error: "not found" });
    }

    /* Companies House Streaming API: long-lived newline-delimited JSON with blank-line heartbeats */
    if (p.startsWith("/ch-stream/")) {
      if (!chAuth(req)) return json(res, 401, { error: "Invalid Authorization" });
      const stream = p.split("/")[2];
      const from = Number(u.searchParams.get("timepoint") || 0);
      res.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
      for (const b of backlog) if (b.stream === stream && b.tp > from) res.write(b.line + "\n");
      if (!streamClients.has(stream)) streamClients.set(stream, new Set());
      streamClients.get(stream).add(res);
      const hb = setInterval(() => res.write("\n"), 5000);
      req.on("close", () => { clearInterval(hb); streamClients.get(stream).delete(res); });
      return;
    }

    /* The Gazette */
    if (p === "/gazette/notice/data.json") {
      const c = companies.get(u.searchParams.get("company-number") || "");
      return json(res, 200, { notices: (c?.gazette || []).map(({ id, category, title, published }) => ({ id, category, title, published })) });
    }
    if (p === "/gazette/notice/latest.json") {
      const since = u.searchParams.get("since") || "1970-01-01";
      return json(res, 200, { notices: gazetteFeed.filter((n) => n.published >= since.slice(0, 10)) });
    }

    /* FCA register */
    if (p === "/fca/Firm/search") {
      const c = companies.get(u.searchParams.get("companyNumber") || "");
      return json(res, 200, { Data: c?.fca ? [c.fca] : [] });
    }

    /* x402 facilitator: a payload is valid when its signature is "valid" and it pays enough to the right address */
    if (p === "/facilitator/verify" || p === "/facilitator/settle") {
      const b = JSON.parse(await readBody(req));
      const pay = b.paymentPayload?.payload || {}, reqs = b.paymentRequirements || {};
      const ok = pay.signature === "valid" && BigInt(pay.authorization?.value || 0) >= BigInt(reqs.amount || 0) && (pay.authorization?.to || "").toLowerCase() === (reqs.payTo || "").toLowerCase();
      if (p.endsWith("verify")) return json(res, 200, ok ? { isValid: true, payer: pay.authorization?.from } : { isValid: false, invalidReason: "invalid_exact_evm_payload_signature" });
      return json(res, 200, ok ? { success: true, transaction: "0x" + Math.random().toString(16).slice(2).padEnd(64, "0"), network: reqs.network, payer: pay.authorization?.from } : { success: false, errorReason: "invalid" });
    }

    /* Stripe */
    if (p.startsWith("/stripe/")) {
      const form = new URLSearchParams(await readBody(req));
      captured.push({ target: "stripe" + p.slice(7), body: Object.fromEntries(form), at: new Date().toISOString() });
      if (p === "/stripe/v1/checkout/sessions") return json(res, 200, { id: "cs_test_" + Date.now(), url: "https://checkout.stripe.example/c/pay/cs_test", mode: form.get("mode") });
      if (p === "/stripe/v1/billing_portal/sessions") return json(res, 200, { id: "bps_test", url: "https://billing.stripe.example/p/session/test" });
      if (p === "/stripe/v1/billing/meter_events") return json(res, 200, { object: "billing.meter_event", event_name: form.get("event_name") });
      return json(res, 404, { error: { message: "Unknown Stripe path" } });
    }

    /* Teams and Slack webhook capture */
    if (p.startsWith("/hooks/")) {
      const body = await readBody(req);
      captured.push({ target: p, body: JSON.parse(body || "{}"), at: new Date().toISOString() });
      res.writeHead(p.includes("/teams/") ? 202 : 200, { "Content-Type": "text/plain" }); return res.end("ok");
    }
    if (p.startsWith("/devhook/")) {
      const body = await readBody(req);
      captured.push({ target: p, body: JSON.parse(body || "{}"), at: new Date().toISOString() });
      return json(res, 200, { ok: true });
    }

    /* Test controls */
    /* Claude Messages API: a scripted agent per template, driven by the tool results so far */
    if (p === "/anthropic/v1/messages" && req.method === "POST") {
      if (req.headers["x-api-key"] !== "dev" || req.headers["anthropic-version"] !== "2023-06-01") return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      const b = JSON.parse(await readBody(req));
      if (claudeFailures > 0) { claudeFailures--; captured.push({ target: "/anthropic", body: { overloaded: true }, at: new Date().toISOString() }); return json(res, 529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }); }
      const cached = Array.isArray(b.system) && !!b.system[0]?.cache_control && !!(b.tools || []).at(-1)?.cache_control;
      captured.push({ target: "/anthropic", body: { model: b.model, tools: (b.tools || []).map((t) => t.name), turns: b.messages.length, cached }, at: new Date().toISOString() });
      return json(res, 200, mockClaude(b));
    }
    /* Brave-style web search */
    if (p === "/search/res/v1/web/search") {
      if (req.headers["x-subscription-token"] !== "dev") return json(res, 401, { error: "bad token" });
      const q = u.searchParams.get("q") || "";
      const slug = q.toLowerCase().replace(/\b(ltd|limited|uk)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return json(res, 200, { web: { results: [
        { title: `${q} | Official site`, url: `http://127.0.0.1:${PORT}/web/${slug}`, description: `<strong>${q}</strong>: services, team and contact details.` },
        { title: `${q} - Companies House`, url: `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(q)}`, description: "Company overview." },
        { title: `${q} reviews`, url: `http://127.0.0.1:${PORT}/web/${slug}-reviews`, description: "What customers say." },
      ] } });
    }
    /* Public web pages for the agents to read */
    if (p.startsWith("/web/")) {
      const slug = p.slice(5);
      const nice = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><html><head><title>${nice}</title><style>.x{}</style></head><body><nav>Home About</nav><h1>${nice}</h1><p>We are an established Manchester firm working with local businesses since 2014.</p><p>Contact us: <a href="mailto:hello@${slug}.example">hello@${slug}.example</a> or call 0161 000 0000.</p><script>var a=1</script></body></html>`);
    }
    /* A developer's published tool */
    if (p.startsWith("/devtool/")) {
      const b = await readBody(req);
      captured.push({ target: p, body: JSON.parse(b || "{}"), headers: { ts: req.headers["x-agenthouse-timestamp"], sig: req.headers["x-agenthouse-signature"] }, at: new Date().toISOString() });
      if (p === "/devtool/broken") return json(res, 500, { error: "boom" });
      const inp = JSON.parse(b || "{}").input || {};
      return json(res, 200, { vat_number: inp.vat || "GB123456789", valid: true, name: "EXAMPLE TRADING LTD", source: "HMRC (mock)" });
    }
    if (p === "/control/mutate" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      const c = mutate(b.number, b.change || {});
      return c ? json(res, 200, { ok: true, timepoint }) : json(res, 404, { error: "no such company" });
    }
    if (p === "/control/captured") return json(res, 200, { captured });
    /* Voice: "audio" here is the words themselves, base64-encoded, so tests can say what was spoken. */
    if (p === "/voice/transcribe" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      const text = Buffer.from(b.audio || "", "base64").toString("utf8");
      captured.push({ target: "/voice/transcribe", body: { bytes: (b.audio || "").length }, at: new Date().toISOString() });
      return json(res, 200, { text: /^[\x20-\x7e\n]+$/.test(text) ? text : "brief me" });
    }
    if (p === "/voice/speak" && req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      captured.push({ target: "/voice/speak", body: { text: b.text }, at: new Date().toISOString() });
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      return res.end(Buffer.concat([Buffer.from("ID3"), Buffer.from(String(b.text || ""))]));
    }
    if (p === "/control/claude-fail" && req.method === "POST") { claudeFailures = Number(JSON.parse(await readBody(req)).n || 0); return json(res, 200, { ok: true }); }
    if (p === "/control/companies") return json(res, 200, { companies: [...companies.values()].map((c) => ({ number: c.company_number, name: c.company_name, postcode: c.registered_office_address.postal_code })) });
    if (p === "/control/reset" && req.method === "POST") { seed(); captured.length = 0; backlog.length = 0; gazetteFeed.length = 0; return json(res, 200, { ok: true }); }
    if (p === "/health") return json(res, 200, { ok: true });
    json(res, 404, { error: "not found", path: p });
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`mocks on http://127.0.0.1:${PORT}`));
