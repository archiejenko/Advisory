// The business OS in the demo workspace: module records, channels, record threads and @mentions, answered
// from memory with the same shapes as /api/ws/os. Agents "reply" a moment later, as they would after a run.
import { FACETS, KINDS, ROLES, facet, modulesFor } from "../../../packages/core/os.ts";

const H = 3600e3, D = 24 * H;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const day = (n) => new Date(Date.now() + n * D).toISOString().slice(0, 10);
let seq = 500;
const nid = (p) => `${p}_demo${++seq}`;

export const PEOPLE = [
  { id: "usr_demo", name: "Dana Price", email: "dana@brightwork.example", role: "owner" },
  { id: "usr_demo2", name: "Sam Okafor", email: "sam@brightwork.example", role: "manager" },
  { id: "usr_demo3", name: "Priya Shah", email: "priya@brightwork.example", role: "manager" },
  { id: "usr_demo4", name: "Lee Hart", email: "lee@brightwork.example", role: "viewer" },
];

function rec(module, title, o = {}) {
  const f = facet(module);
  const k = KINDS[f.kind];
  const { status, owner = null, due_date = null, party = null, amount = null, t = 3 * D, ...extra } = o;
  return { id: nid("rec"), module, title, status: status || k.statuses[0], owner, due_date, party, amount_pence: amount == null ? null : Math.round(amount * 100), extra, created_by: o.by || "dana@brightwork.example", created_at: ago(t), updated_at: ago(t / 2) };
}

function seedOs() {
  const records = [
    rec("goals-and-objectives", "Win 6 new office contracts this quarter", { target: 6, current: 4, period: "Q4 2026", status: "on track" }),
    rec("goals-and-objectives", "Keep complaints under 2 a month", { target: 2, current: 3, period: "October", status: "at risk" }),
    rec("budgets-and-planning", "Cleaning supplies budget", { target: 4200, current: 3650, period: "Q4 2026" }),
    rec("risk-register", "Single supplier for floor chemicals", { owner: "Sam Okafor", priority: "high", status: "in progress" }),
    rec("quotes-and-proposals", "Peel Street Accountants: weekly clean", { party: "Peel Street Accountants Ltd", amount: 9600, owner: "Dana Price", due_date: day(6), status: "in progress" }),
    rec("quotes-and-proposals", "Castlefield Dental: surgery deep clean", { party: "Castlefield Dental Care Ltd", amount: 2400, owner: "Dana Price", due_date: day(3) }),
    rec("contracts-and-e-signature", "Ancoats Architects: weekly contract", { party: "Ancoats Architects LLP", due_date: day(340), status: "active", link: "https://brightwork.example/contracts/ancoats" }),
    rec("reviews-and-reputation", "3-star Google review: missed bins", { party: "Holcombe Legal", priority: "normal", status: "open" }),
    rec("complaints", "Scratched worktop at Tarnbrook", { party: "Tarnbrook Logistics Ltd", priority: "high", owner: "Sam Okafor", status: "open" }),
    rec("bookings-and-scheduling", "Quayside Opticians: window clean", { party: "Quayside Opticians Ltd", due_date: day(2), location: "Salford Quays", status: "confirmed" }),
    rec("rota-and-shifts", "Week 44 evening rota", { owner: "Sam Okafor", due_date: day(4), status: "planned" }),
    rec("stock-and-inventory", "Microfibre cloths (blue)", { location: "Unit 4 store", owner: "Lee Hart", due_date: day(10), status: "needs service" }),
    rec("purchasing-and-orders", "Order: floor cleaner, 20 x 5L", { party: "Northern Janitorial Supplies", amount: 312.4, due_date: day(5), status: "sent" }),
    rec("bills-and-payables", "Van lease, November", { party: "Lex Vehicle Leasing", amount: 489, due_date: day(8) }),
    rec("bills-and-payables", "Office rent, Q4", { party: "Redhill Estates", amount: 1250, due_date: day(2), status: "sent" }),
    rec("bills-and-payables", "Chemicals, September", { party: "Northern Janitorial Supplies", amount: 684.2, due_date: day(-6), status: "overdue" }),
    rec("vat-returns", "VAT return, Jul to Sep", { party: "HMRC", amount: 4820, due_date: day(14) }),
    rec("payroll", "October payroll", { party: "14 people", amount: 26840, due_date: day(9) }),
    rec("recruitment", "Evening cleaner, Salford", { role: "Cleaner", team: "Evenings", due_date: day(12), status: "starting" }),
    rec("employee-records", "Sam Okafor", { role: "Operations manager", team: "Operations", due_date: "2023-03-01", status: "active" }),
    rec("employee-records", "Priya Shah", { role: "Finance and admin", team: "Office", due_date: "2024-06-17", status: "active" }),
    rec("absence-and-holiday", "Lee Hart: annual leave", { party: "Lee Hart", due_date: day(15), location: "-", status: "confirmed" }),
    rec("health-and-safety", "COSHH sheet missing for new descaler", { party: "Unit 4 store", priority: "high", owner: "Sam Okafor", status: "open" }),
    rec("insurance", "Public liability renewal", { party: "Hiscox", due_date: day(41), status: "active" }),
    rec("devices-and-software", "Team phones (6)", { location: "With supervisors", owner: "Priya Shah", due_date: day(90) }),
    rec("fleet-and-vehicles", "Van MA24 BWC", { location: "Unit 4", owner: "Sam Okafor", due_date: day(18) }),
    rec("training", "Infection control refresher for clinic teams", { owner: "Sam Okafor", due_date: day(20), priority: "normal" }),
  ];
  const ch = (name) => ({ id: "chn_os_" + name, name, kind: "team", created_at: ago(30 * D) });
  const channels = ["general", "sales", "finance", "operations", "people"].map(ch);
  const m = (channel, who, body, t, kind = "person") => ({ id: nid("msg"), channel_id: "chn_os_" + channel, author_kind: kind, author_id: null, author_name: who, body, mentions: [], at: ago(t) });
  const messages = [
    m("general", "Dana Price", "Morning all. Two new office quotes going out this week, so evenings may get busier from November.", 26 * H),
    m("general", "Sam Okafor", "Noted. I'll get the week 44 rota to Priya by Thursday.", 25 * H),
    m("general", "Weekly briefing", "This week: 4 replies to outreach, 1 contract won (Ancoats Architects), £1,280 overdue from Tarnbrook. Two things need Dana: the Peel Street quote and the COSHH sheet.", 20 * H, "agent"),
    m("sales", "Dana Price", "@Proposals agent can you draft the Peel Street quote from our weekly-clean price list?", 6 * H),
    m("sales", "Proposals agent", "Drafted a weekly clean for Peel Street Accountants at £9,600 a year (3 visits, 15 staff). It's in Quotes, marked in progress, for you to check before it goes.", 6 * H - 4 * 60e3, "agent"),
    m("finance", "Priya Shah", "@Payables agent what do we owe this week?", 3 * H),
    m("finance", "Payables agent", "Due this week: office rent £1,250 (Redhill Estates, in 2 days). Overdue: chemicals £684.20 to Northern Janitorial since last week. I've added a task for Priya to pay the overdue one.", 3 * H - 3 * 60e3, "agent"),
    m("operations", "Sam Okafor", "Tarnbrook have complained about a scratched worktop. Logged it in Complaints.", 2 * H),
    m("operations", "Lee Hart", "Blue cloths are running low at Unit 4.", 50 * 60e3),
    m("people", "Priya Shah", "Evening cleaner role for Salford is live. Two applicants so far.", 30 * H),
  ];
  return { records, channels, messages, agents: ["Proposals agent", "Payables agent"], threads: {} };
}

const shape = (r) => ({ id: r.id, module: r.module, title: r.title, status: r.status, owner: r.owner, due_date: r.due_date, party: r.party, amount_pence: r.amount_pence, created_by: r.created_by, created_at: r.created_at, updated_at: r.updated_at,
  fields: { ...r.extra, owner: r.owner, due_date: r.due_date, party: r.party, amount: r.amount_pence == null ? null : r.amount_pence / 100 } });

function apply(r, f, b, fail) {
  const k = KINDS[f.kind];
  if (b.title !== undefined) { if (!String(b.title).trim()) fail(400, "A record needs a title."); r.title = String(b.title).trim().slice(0, 200); }
  if (b.status !== undefined) { if (!k.statuses.includes(b.status)) fail(400, `Status must be one of: ${k.statuses.join(", ")}.`); r.status = b.status; }
  for (const fd of k.fields) {
    if (!b.fields || !(fd.key in b.fields)) continue;
    const v = b.fields[fd.key], empty = v === null || v === undefined || v === "";
    if (fd.type === "date" && !empty && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, `${fd.label} must be a date.`);
    if (fd.type === "money") { const n = empty ? null : Number(String(v).replace(/[£,\s]/g, "")); if (n !== null && !Number.isFinite(n)) fail(400, `${fd.label} must be an amount in pounds.`); r.amount_pence = n === null ? null : Math.round(n * 100); continue; }
    if (["owner", "due_date", "party"].includes(fd.key)) r[fd.key] = empty ? null : String(v); else r.extra[fd.key] = empty ? null : fd.type === "number" ? Number(v) : String(v);
  }
  r.updated_at = new Date().toISOString();
}

/** A canned answer from an OS agent, written from the module's own records. */
function answer(role, os, text) {
  const mods = modulesFor(role);
  const recs = os.records.filter((r) => mods.some((f) => f.key === r.module));
  const open = recs.filter((r) => !KINDS[facet(r.module).kind].done.includes(r.status));
  const money = open.filter((r) => r.amount_pence).reduce((n, r) => n + r.amount_pence, 0);
  const soon = open.filter((r) => r.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const where = mods.map((f) => f.app).join(" and ");
  if (!recs.length) return `Nothing is in ${where} yet. Add the first record and I'll keep it up to date; I can also draft entries from what you tell me here.`;
  return [`I checked ${where}: ${open.length} open of ${recs.length}.`,
    money ? `Open value £${(money / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}.` : "",
    soon ? `Next up: "${soon.title}"${soon.due_date ? `, due ${new Date(soon.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}.` : "",
    /\?\s*$/.test(text) ? "" : "I've noted what you asked against the module; anything that needs a person is on Tasks.",
  ].filter(Boolean).join(" ");
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function osDemo(method, p, q, body, s, fail, me) {
  if (!p.startsWith("/os/")) return undefined;
  if (!s.os) s.os = seedOs();
  const os = s.os;
  const now = () => new Date().toISOString();
  const may = () => { if (me?.role === "viewer") fail(403, "Only a manager or owner can do that."); };
  let r;
  const m = (re) => p.match(re);
  const mod = (key) => facet(key) || fail(404, "There's no module by that name.");
  const msgs = (chId) => {
    const all = os.messages.filter((x) => x.channel_id === chId).sort((a, b) => a.at.localeCompare(b.at));
    return q.after ? all.filter((x) => x.at > q.after) : all.slice(-100);
  };
  const threadOf = (recId) => {
    const rr = os.records.find((x) => x.id === recId) || fail(404, "Record not found.");
    if (!os.threads[recId]) os.threads[recId] = { id: "chn_rec_" + recId, name: recId, kind: "record", record_id: recId, created_at: now() };
    return { channel: os.threads[recId], record: rr };
  };
  const say = (ch, text) => {
    const t = String(text || "").trim();
    if (!t) fail(400, "Write a message.");
    const own = s.agents.map((a) => a.name);
    const names = [...new Set([...own, ...ROLES])].sort((a, b) => b.length - a.length);
    const found = [];
    let rest = t;
    for (const n of names) {
      const re = new RegExp(`@${esc(n)}(?![\\w-])`, "i");
      if (re.test(rest)) { found.push(n); rest = rest.replace(new RegExp(re.source, "gi"), " "); }
      if (found.length >= 3) break;
    }
    const msg = { id: nid("msg"), channel_id: ch.id, author_kind: "person", author_id: me?.user?.id || "usr_demo", author_name: me?.user?.name || "Dana Price", body: t, mentions: found, at: now() };
    os.messages.push(msg);
    const asked = found.map((n) => {
      const a = s.agents.find((x) => x.name === n);
      if (a && a.status !== "running") {
        os.messages.push({ id: nid("msg"), channel_id: ch.id, author_kind: "system", author_id: null, author_name: "Agent House", body: `${n} wasn't asked: ${n} is paused. Switch it back on in Agents to ask it things.`, mentions: [], at: new Date(Date.now() + 1).toISOString() });
        return { agent: n, error: "paused" };
      }
      if (!a && ROLES.includes(n) && !os.agents.includes(n)) os.agents.push(n);
      const reply = ROLES.includes(n) ? answer(n, os, t) : `On it. I'll put what I find in front of you on Today.`;
      setTimeout(() => os.messages.push({ id: nid("msg"), channel_id: ch.id, author_kind: "agent", author_id: null, author_name: n, body: reply, mentions: [], at: new Date().toISOString() }), 1600);
      return { agent: n, run_id: nid("run") };
    });
    return { message: msg, asked };
  };

  if (method === "GET" && p === "/os/catalogue") {
    const total = {}, open = {};
    for (const x of os.records) { total[x.module] = (total[x.module] || 0) + 1; if (!KINDS[facet(x.module).kind].done.includes(x.status)) open[x.module] = (open[x.module] || 0) + 1; }
    return {
      modules: FACETS.map((f) => ({ key: f.key, area: f.area, name: f.name, app: f.app, kind: f.kind, depth: f.depth, agent: f.agent, link: f.link, records: total[f.key] || 0, open: open[f.key] || 0, agent_id: f.agent && os.agents.includes(f.agent) ? "agt_os_" + f.key : null })),
      totals: { modules: FACETS.length, records: os.records.length, agents: os.agents.length },
    };
  }
  if (method === "GET" && p === "/os/directory") {
    const hired = new Set([...s.agents.map((a) => a.name), ...os.agents]);
    return {
      people: (s.users?.length ? s.users.map((u) => ({ id: u.id, name: u.name || u.email.split("@")[0], email: u.email, role: u.role })) : PEOPLE),
      agents: [...s.agents.map((a) => ({ id: a.id, name: a.name, hired: true, status: a.status, modules: [] })), ...os.agents.map((n) => ({ id: "agt_os_" + n, name: n, hired: true, status: "running", modules: modulesFor(n).map((f) => f.key) })),
        ...ROLES.filter((n) => !hired.has(n)).map((n) => ({ id: null, name: n, hired: false, status: null, modules: modulesFor(n).map((f) => f.key) }))],
    };
  }
  if ((r = m(/^\/os\/m\/([^/]+)\/records$/))) {
    const f = mod(r[1]);
    if (method === "GET") {
      let list = os.records.filter((x) => x.module === f.key);
      if (q.status) list = list.filter((x) => x.status === q.status);
      if (q.q) { const w = q.q.toLowerCase(); list = list.filter((x) => [x.title, x.party, x.owner].some((v) => v && v.toLowerCase().includes(w))); }
      return { module: f.key, records: list.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(shape) };
    }
    if (method === "POST") {
      may();
      const x = { id: nid("rec"), module: f.key, title: "", status: KINDS[f.kind].statuses[0], owner: null, due_date: null, party: null, amount_pence: null, extra: {}, created_by: me?.user?.email || "dana@brightwork.example", created_at: now(), updated_at: now() };
      apply(x, f, { title: body?.title ?? "", ...body }, fail);
      os.records.unshift(x);
      return { record: shape(x) };
    }
  }
  if ((r = m(/^\/os\/records\/([^/]+)$/))) {
    const x = os.records.find((y) => y.id === r[1]) || fail(404, "Record not found.");
    if (method === "GET") return { record: shape(x) };
    if (method === "PATCH") { may(); apply(x, mod(x.module), body || {}, fail); return { record: shape(x) }; }
    if (method === "DELETE") { may(); os.records = os.records.filter((y) => y.id !== x.id); const t = os.threads[x.id]; if (t) os.messages = os.messages.filter((y) => y.channel_id !== t.id); delete os.threads[x.id]; return { ok: true }; }
  }
  if ((r = m(/^\/os\/records\/([^/]+)\/messages$/))) {
    const { channel } = threadOf(r[1]);
    if (method === "GET") return { channel, messages: msgs(channel.id) };
    if (method === "POST") return say(channel, body?.body);
  }
  if (p === "/os/channels") {
    if (method === "GET") return { channels: os.channels.map((c) => ({ ...c, messages: os.messages.filter((x) => x.channel_id === c.id).length, last_at: os.messages.filter((x) => x.channel_id === c.id).map((x) => x.at).sort().pop() || null })).sort((a, b) => (a.name === "general" ? -1 : b.name === "general" ? 1 : a.name.localeCompare(b.name))) };
    if (method === "POST") {
      may();
      const n = String(body?.name || "").toLowerCase().replace(/^#/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      if (n.length < 2) fail(400, "A channel needs a name, for example \"site-team\".");
      if (os.channels.some((c) => c.name === n)) fail(409, `#${n} already exists.`);
      const c = { id: nid("chn"), name: n, kind: "team", created_at: now() };
      os.channels.push(c);
      return { id: c.id, name: n };
    }
  }
  if ((r = m(/^\/os\/channels\/([^/]+)\/messages$/))) {
    const ch = os.channels.find((c) => c.id === r[1]) || fail(404, "Channel not found.");
    if (method === "GET") return { channel: ch, messages: msgs(ch.id) };
    if (method === "POST") return say(ch, body?.body);
  }
  fail(404, "No such endpoint.");
}
