// Every figure the workspace shows is worked out here, from the store. Nothing on screen is typed in by hand.
import type { AccountRef, Actor, Agent, Approval, ApprovalType, Company, GuardEvent, Invoice, Job, Presence, Ref, RuleId, State, Supplier, Touch, TouchChannel } from "./types";
import { evaluate, check, classifyLogged, RULE_COPY, VERDICT_COPY, type CTouch, type Evaluation } from "../../../../../packages/core/contact";
import { demoHistory } from "../../../../../packages/core/demoUsage";
import { dailyUsage, percentileBins, quantile, weekly, biggestRuns, balanceOf, type Day, type Entry } from "../../../../../packages/core/usage";
import { modeName } from "../../../../../packages/core/credits";
import { PLANS } from "../../../../../packages/core/templates";
import { MODE_ORDER, PLAN_CREDITS, TOPUP, type ModeKey } from "../../../../../config/model-pricing";
import { APPS, actionsPerMonth, shellApps } from "./catalogue";
import { pounds } from "./format";

const D = 86400e3, H = 3600e3;
export const possessive = (name: string) => (name.endsWith("s") ? name + "’" : name + "’s");
export const nowMs = (s: State) => Date.parse(s.now);
const within = (s: State, iso: string | null, fromDays: number, toDays = 0) => {
  if (!iso) return false;
  const t = Date.parse(iso), n = nowMs(s);
  // Anything after the demo clock (done in this session) counts as "now".
  return t > n - fromDays * D && (toDays === 0 || t <= n - toDays * D);
};
const startOfDay = (s: State) => { const d = new Date(nowMs(s)); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ---------- Lookups ---------- */
export const company = (s: State, id: string | null) => (id ? s.companies.find((c) => c.id === id) : undefined);
export const agent = (s: State, id: string) => s.agents.find((a) => a.id === id);
export const person = (s: State, id: string) => s.people.find((p) => p.id === id);
export const actorName = (s: State, a: { kind: string; id: string } | null) => (!a ? "" : a.kind === "agent" ? agent(s, a.id)?.name || "Agent" : person(s, a.id)?.name || "Someone");
export const agentLabel = (a: Agent) => `${a.name} · ${a.roleName}`;

/* ---------- Decisions ---------- */
export const pending = (s: State) => s.approvals.filter((a) => a.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const pendingCount = (s: State) => pending(s).length;
export const routine = (s: State) => pending(s).filter((a) => a.risk === "routine");
export const review = (s: State) => pending(s).filter((a) => a.risk === "review");

/* ---------- Money ---------- */
export const isUnpaid = (i: Invoice) => i.status === "sent" || i.status === "overdue";
export const isOverdue = (s: State, i: Invoice) => isUnpaid(i) && midnightOf(Date.parse(i.dueAt)) < midnightOf(nowMs(s));
const midnightOf = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Whole days between the due date and today. */
export const daysLate = (s: State, i: Invoice) => Math.max(0, Math.round((midnightOf(nowMs(s)) - midnightOf(Date.parse(i.dueAt))) / D));
export const overdueInvoices = (s: State) => s.invoices.filter((i) => isOverdue(s, i)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
export const overdueTotal = (s: State) => overdueInvoices(s).reduce((n, i) => n + i.total, 0);
export const overdueCount = (s: State) => overdueInvoices(s).length;
export const dueSoon = (s: State, days = 7) => s.invoices.filter((i) => isUnpaid(i) && !isOverdue(s, i) && midnightOf(Date.parse(i.dueAt)) <= midnightOf(nowMs(s)) + days * D);
export const dueSoonTotal = (s: State, days = 7) => dueSoon(s, days).reduce((n, i) => n + i.total, 0);
export const owedTotal = (s: State) => s.invoices.filter(isUnpaid).reduce((n, i) => n + i.total, 0);
export const ageing = (s: State) => {
  const b = [{ key: "0-30", label: "1–30 days", min: 1, max: 30 }, { key: "31-60", label: "31–60 days", min: 31, max: 60 }, { key: "60+", label: "60+ days", min: 61, max: Infinity }];
  return b.map((x) => { const list = overdueInvoices(s).filter((i) => daysLate(s, i) >= x.min && daysLate(s, i) <= x.max); return { ...x, count: list.length, total: list.reduce((n, i) => n + i.total, 0), ids: list.map((i) => i.id) }; });
};
export const remindersSent = (i: Invoice) => i.chaseLog.filter((c) => c.kind === "reminder").length;
export const collected = (s: State, fromDays: number, toDays = 0) => s.payments.filter((p) => within(s, p.at, fromDays, toDays)).reduce((n, p) => n + p.amount, 0);
export const collectedThisWeek = (s: State) => collected(s, 7);
/** The same week last month (28 to 35 days ago): what "this week" is compared with. */
export const collectedSameWeekLastMonth = (s: State) => collected(s, 35, 28);
export const billsDue = (s: State, days = 7) => s.bills.filter((b) => b.status !== "paid" && Date.parse(b.dueAt) <= nowMs(s) + days * D);
export const billsOverdue = (s: State) => s.bills.filter((b) => b.status !== "paid" && Date.parse(b.dueAt) < nowMs(s));
export const billsUnpaidTotal = (s: State) => s.bills.filter((b) => b.status !== "paid").reduce((n, b) => n + b.total, 0);
export const lifetimeValue = (s: State, companyId: string) => s.invoices.filter((i) => i.companyId === companyId && i.status === "paid").reduce((n, i) => n + i.total, 0);
/** Consecutive most recent invoices paid after their due date. */
export function lateRun(s: State, companyId: string) {
  const paid = s.invoices.filter((i) => i.companyId === companyId && i.status === "paid").sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  let n = 0;
  for (const i of paid) { if (Date.parse(i.paidAt!) > Date.parse(i.dueAt) + D) n++; else break; }
  return n;
}

/** Six weeks of cash: today's balance, plus invoices expected in, minus bills and payroll going out. */
export function cashForecast(s: State) {
  const n = nowMs(s);
  const payroll = 1360000, payrollDay = 28;
  const weeks = [];
  let bal = s.org.cashBalance;
  for (let w = 0; w < 6; w++) {
    const from = n + w * 7 * D, to = from + 7 * D;
    let inn = 0, out = 0;
    for (const i of s.invoices.filter(isUnpaid)) {
      // Overdue money is expected over the next two weeks; the rest on its due date.
      const exp = isOverdue(s, i) ? n + (i.companyId === "co_tarnbrook" ? 10 : 4) * D : Date.parse(i.dueAt);
      if (exp >= from && exp < to) inn += i.total;
    }
    // Regular contracts invoiced monthly and paid within terms.
    for (const j of s.jobs.filter((x) => x.kind === "clean" && x.monthlyValue && (x.status === "active" || x.status === "scheduled"))) {
      const d = new Date(from); const pay = new Date(d.getFullYear(), d.getMonth(), 25).getTime();
      if (w > 1 && pay >= from && pay < to) inn += j.monthlyValue!;
    }
    for (const b of s.bills.filter((x) => x.status !== "paid")) {
      const exp = Math.max(Date.parse(b.dueAt), n);
      if (exp >= from && exp < to) out += b.total;
    }
    for (let t = from; t < to; t += D) if (new Date(t).getDate() === payrollDay) out += payroll;
    if (w > 0) out += 48000; // fuel and supplies
    bal += inn - out;
    weeks.push({ week: w + 1, start: new Date(from).toISOString(), in: inn, out, balance: bal });
  }
  return weeks;
}

/* ---------- Customers ---------- */
export const leads = (s: State) => s.companies.filter((c) => c.status === "lead");
export const newLeadsThisWeek = (s: State) => s.companies.filter((c) => c.status === "lead" && within(s, c.createdAt, 7));
export const newLeadCount = (s: State) => newLeadsThisWeek(s).length;
export const repliesThisWeek = (s: State) => s.conversations.filter((c) => c.origin === "reply" && c.messages.some((m) => m.direction === "in" && within(s, m.at, 7)));
export const repliesToday = (s: State) => s.conversations.filter((c) => c.origin === "reply" && c.messages.some((m) => m.direction === "in" && Date.parse(m.at) >= startOfDay(s)));
export const wonThisWeek = (s: State) => s.deals.filter((d) => d.stage === "won" && within(s, d.updatedAt, 7) && d.value > 0);
export const STAGES = [
  { key: "new", label: "New", p: 0.1 }, { key: "qualified", label: "Qualified", p: 0.3 }, { key: "quoted", label: "Quoted", p: 0.5 },
  { key: "won", label: "Won", p: 1 }, { key: "lost", label: "Lost", p: 0 },
] as const;
export const openDeals = (s: State) => s.deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
export const pipelineValue = (s: State) => openDeals(s).reduce((n, d) => n + d.value, 0);
export const forecast = (s: State) => Math.round(openDeals(s).reduce((n, d) => n + d.value * (STAGES.find((x) => x.key === d.stage)!.p), 0));
export const quotesUnanswered = (s: State, days = 5) => s.quotes.filter((q) => q.status === "sent" && q.sentAt && Date.parse(q.sentAt) < nowMs(s) - days * D);
export const inboxCounts = (s: State) => {
  const c = { new: 0, open: 0, waiting: 0, resolved: 0 } as Record<string, number>;
  for (const x of s.conversations) c[x.status]++;
  return c;
};
export const openConversations = (s: State) => s.conversations.filter((c) => c.status === "new" || c.status === "open");

/* ---------- Work ---------- */
const weekday = (t: number) => { const d = new Date(t).getDay(); return d === 0 ? 7 : d; };
export function jobsOn(s: State, t: number) {
  const date = new Date(t).toISOString().slice(0, 10);
  return s.jobs.filter((j) => {
    if (j.status === "done" || j.status === "paused") return false;
    if (j.schedule.kind === "once") return j.schedule.date === date;
    return j.startsOn <= date && j.schedule.days.includes(weekday(t));
  }).sort((a, b) => a.schedule.time.localeCompare(b.schedule.time));
}
export const jobsToday = (s: State) => jobsOn(s, nowMs(s));
export const crewToday = (s: State) => [...new Set(jobsToday(s).flatMap((j) => j.crewIds))];
export const openTasks = (s: State) => s.tasks.filter((t) => t.status === "open");
export const diaryAhead = (s: State, days = 7) => s.diary.filter((d) => Date.parse(d.at) >= startOfDay(s) && Date.parse(d.at) < nowMs(s) + days * D).sort((a, b) => a.at.localeCompare(b.at));
export const scheduleText = (j: Job) => {
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (j.schedule.kind === "once") return `${new Date(j.schedule.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${j.schedule.time}`;
  const d = j.schedule.days;
  const days = d.length === 5 && d.join() === "1,2,3,4,5" ? "Mon to Fri" : d.map((x) => names[x]).join(", ");
  return `${days}, ${j.schedule.time}`;
};

/* ---------- Team and agents ---------- */
/** Agents at work: those running at least one app that's switched on. Setup and the Team hub both use this. */
export const activeAgentIds = (os: State["os"]) => [...new Set(APPS.filter((a) => a.agentId && os.apps[a.key] && os.apps[a.key].mode !== "off").map((a) => a.agentId!))];
export const agentCount = (s: State) => s.agents.filter((a) => activeAgentIds(s.os).includes(a.id)).length;
export const peopleCount = (s: State) => s.people.length;
export const appCount = (s: State) => (["customers", "money", "work", "team"] as const).reduce((n, h) => n + shellApps(s.os, h).length, 0);
export const monthlyActions = (s: State) => actionsPerMonth(s.os);
export function agentStats(s: State, agentId: string) {
  const week = s.activity.filter((e) => e.actor.kind === "agent" && e.actor.id === agentId && within(s, e.at, 7));
  const decided = s.approvals.filter((a) => a.agentId === agentId && (a.status === "approved" || a.status === "rejected"));
  const approved = decided.filter((a) => a.status === "approved").length;
  return {
    actionsThisWeek: week.length,
    approvalRate: decided.length ? approved / decided.length : null,
    minutesSavedThisWeek: week.reduce((n, e) => n + e.minutesSaved, 0),
    waiting: s.approvals.filter((a) => a.agentId === agentId && a.status === "pending").length,
    apps: APPS.filter((a) => a.agentId === agentId && s.os.apps[a.key] && s.os.apps[a.key].mode !== "off"),
  };
}
export const actionsThisWeek = (s: State) => s.activity.filter((e) => e.actor.kind === "agent" && within(s, e.at, 7)).length;
export const approvalRate = (s: State) => {
  const d = s.approvals.filter((a) => a.status === "approved" || a.status === "rejected");
  return d.length ? d.filter((a) => a.status === "approved").length / d.length : 0;
};

/* ---------- Outcomes (Home's first line) ---------- */
export const minutesSaved = (s: State, fromDays: number, toDays = 0) => s.activity.filter((e) => within(s, e.at, fromDays, toDays)).reduce((n, e) => n + e.minutesSaved, 0);
export function responseMinutes(s: State, fromDays: number, toDays = 0) {
  const times: number[] = [];
  for (const c of s.conversations) {
    const first = c.messages.find((m) => m.direction === "in");
    if (!first || !within(s, first.at, fromDays, toDays)) continue;
    const reply = c.messages.find((m) => m.direction === "out" && m.at > first.at);
    if (reply) times.push((Date.parse(reply.at) - Date.parse(first.at)) / 60e3);
  }
  return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
}
export function outcomes(s: State) {
  return {
    collected: collectedThisWeek(s), collectedBefore: collectedSameWeekLastMonth(s),
    hoursSaved: Math.round(minutesSaved(s, 7) / 6) / 10, hoursSavedBefore: Math.round(minutesSaved(s, 35, 28) / 6) / 10,
    responseMins: responseMinutes(s, 7), responseMinsBefore: responseMinutes(s, 42, 21),
  };
}

/* ---------- Trust ladder ---------- */
export const TRUST_AFTER = 10;
export function trustPrompts(s: State) {
  const out: { key: string; agentId: string; type: ApprovalType; label: string; streak: number; limit: number }[] = [];
  for (const a of s.agents) for (const r of a.autonomy) {
    if (r.mode !== "ask") continue;
    const key = a.id + ":" + r.type;
    if (s.prefs.trustDismissed.includes(key)) continue;
    const decided = s.approvals.filter((x) => x.agentId === a.id && x.type === r.type && x.decidedAt && x.status !== "auto").sort((x, y) => y.decidedAt!.localeCompare(x.decidedAt!));
    let streak = 0;
    for (const x of decided) { if (x.status === "approved" && !x.edited) streak++; else break; }
    if (streak >= TRUST_AFTER) out.push({ key, agentId: a.id, type: r.type, label: r.label, streak, limit: 50000 });
  }
  return out;
}
export const TRUST_COPY: Partial<Record<ApprovalType, string>> = { send_reminder: "send reminders", send_outreach: "send first emails", reply_enquiry: "reply to enquiries", pay_bill: "pay bills", post_briefing: "post the briefing", send_invoice: "send invoices", follow_up_quote: "follow up quotes" };

/* ---------- Leaks: money or time slipping away, each with a one-tap fix ---------- */
export type Leak = { id: string; title: string; reason: string; fix: string; ref: Ref; tone: "risk" | "attn" };
export function leaks(s: State): Leak[] {
  const out: Leak[] = [];
  const q = quotesUnanswered(s);
  if (q.length) out.push({ id: "leak_quotes", title: `${q.length} ${q.length === 1 ? "quote" : "quotes"} unanswered after 5 days`, reason: `${pounds(q.reduce((n, x) => n + x.total, 0))} a year waiting on ${q.map((x) => company(s, x.companyId)!.short).join(", ")}.`, fix: "Have Maya follow them up", ref: { type: "quote", id: q[0].id }, tone: "attn" });
  for (const c of s.companies.filter((x) => x.status === "customer")) {
    const n = lateRun(s, c.id);
    if (n >= 3) out.push({ id: "leak_late_" + c.id, title: `${c.short} paid late ${n} months running`, reason: "Move to upfront billing? Each late month costs you about two weeks of their fee in cash flow.", fix: "Create a task to agree upfront billing", ref: { type: "company", id: c.id }, tone: "risk" });
  }
  for (const i of s.invoices.filter((x) => x.status === "draft")) {
    const c = company(s, i.companyId)!;
    out.push({ id: "leak_draft_" + i.id, title: `${possessive(c.short)} first invoice hasn't gone out`, reason: `${pounds(i.total)} is sitting in drafts; the job starts this week.`, fix: "Have Fern send it", ref: { type: "invoice", id: i.id }, tone: "attn" });
  }
  return out.filter((l) => !s.prefs.leaksDismissed.includes(l.id)).slice(0, 4);
}

/* ---------- Links between records ---------- */
export function title(s: State, r: Ref): string {
  switch (r.type) {
    case "company": return company(s, r.id)?.name || "Company";
    case "contact": return s.contacts.find((x) => x.id === r.id)?.name || "Contact";
    case "deal": { const d = s.deals.find((x) => x.id === r.id); return d ? `${company(s, d.companyId)?.name}: ${d.title}` : "Deal"; }
    case "quote": return s.quotes.find((x) => x.id === r.id)?.number || "Quote";
    case "job": { const j = s.jobs.find((x) => x.id === r.id); return j ? `${company(s, j.companyId)?.short}: ${j.title}` : "Job"; }
    case "invoice": return r.id;
    case "bill": { const b = s.bills.find((x) => x.id === r.id); return b ? `${b.supplier}: ${b.category}` : "Bill"; }
    case "conversation": return s.conversations.find((x) => x.id === r.id)?.subject || "Conversation";
    case "task": return s.tasks.find((x) => x.id === r.id)?.title || "Task";
    case "approval": return s.approvals.find((x) => x.id === r.id)?.title || "Decision";
    case "person": return person(s, r.id)?.name || "Person";
    case "agent": { const a = agent(s, r.id); return a ? agentLabel(a) : "Agent"; }
    case "record": return s.records.find((x) => x.id === r.id)?.title || "Record";
    case "supplier": return s.suppliers.find((x) => x.id === r.id)?.name || "Supplier";
  }
}
/** Every record that touches a company, for its timeline. */
export function companyRefs(s: State, id: string): Ref[] {
  return [
    { type: "company", id },
    ...s.deals.filter((x) => x.companyId === id).map((x) => ({ type: "deal" as const, id: x.id })),
    ...s.quotes.filter((x) => x.companyId === id).map((x) => ({ type: "quote" as const, id: x.id })),
    ...s.jobs.filter((x) => x.companyId === id).map((x) => ({ type: "job" as const, id: x.id })),
    ...s.invoices.filter((x) => x.companyId === id).map((x) => ({ type: "invoice" as const, id: x.id })),
    ...s.conversations.filter((x) => x.companyId === id).map((x) => ({ type: "conversation" as const, id: x.id })),
  ];
}
export function timelineFor(s: State, refs: Ref[], limit = 40) {
  const keys = new Set(refs.map((r) => r.type + ":" + r.id));
  return s.activity.filter((e) => e.linkedRecord && keys.has(e.linkedRecord.type + ":" + e.linkedRecord.id)).slice(0, limit);
}
export const approvalsFor = (s: State, ref: Ref) => s.approvals.filter((a) => a.linkedRecord.type === ref.type && a.linkedRecord.id === ref.id);

/* ---------- Search (the Ask bar's "go to") ---------- */
export function search(s: State, q: string) {
  const w = q.trim().toLowerCase();
  if (!w) return [];
  const hits: { ref: Ref; label: string; sub: string }[] = [];
  const add = (ref: Ref, label: string, sub: string, hay: string) => { if (hay.toLowerCase().includes(w)) hits.push({ ref, label, sub }); };
  for (const c of s.companies) add({ type: "company", id: c.id }, c.name, c.status === "lead" ? "Lead" : c.status === "customer" ? "Customer" : "Lost", c.name + " " + c.postcode);
  for (const i of s.invoices.filter((x) => x.status !== "paid" || x.id.toLowerCase() === w)) add({ type: "invoice", id: i.id }, i.id, `${company(s, i.companyId)?.name} · ${pounds(i.total)}`, i.id + " " + company(s, i.companyId)?.name);
  for (const p of s.people) add({ type: "person", id: p.id }, p.name, p.role, p.name);
  for (const a of s.agents) add({ type: "agent", id: a.id }, agentLabel(a), "Agent", a.name + " " + a.roleName);
  for (const q2 of s.quotes) add({ type: "quote", id: q2.id }, q2.number, company(s, q2.companyId)?.name || "", q2.number);
  for (const b of s.bills.filter((x) => x.status !== "paid")) add({ type: "bill", id: b.id }, b.supplier, b.category, b.supplier + " " + b.category);
  for (const x of s.suppliers) add({ type: "supplier", id: x.id }, x.name, "Supplier · " + x.category, x.name + " " + x.category);
  return hits.slice(0, 8);
}

export type { Approval, Company };

/* ---------- Engagement: every touch with every buyer and supplier, checked by the contact rules ---------- */
export const accKey = (r: AccountRef) => r.kind + ":" + r.id;
export const sameAcc = (a: AccountRef, b: AccountRef) => a.kind === b.kind && a.id === b.id;
export const accountOf = (s: State, r: AccountRef): (Company | Supplier) | undefined => (r.kind === "company" ? company(s, r.id) : s.suppliers.find((x) => x.id === r.id));
export const accountName = (s: State, r: AccountRef) => { const a = accountOf(s, r); return !a ? "Account" : "short" in a ? a.short : a.name.replace(/ (Ltd|LLP)$/, ""); };
export const allAccounts = (s: State): AccountRef[] => [...s.companies.map((c) => ({ kind: "company" as const, id: c.id })), ...s.suppliers.map((x) => ({ kind: "supplier" as const, id: x.id }))];
/** A buyer is any company (lead, customer or lost); a supplier is someone we buy from. */
export const accountKind = (r: AccountRef) => (r.kind === "company" ? "Buyer" : "Supplier");
export const touchesFor = (s: State, r: AccountRef) => s.touches.filter((t) => sameAcc(t.account, r)).sort((a, b) => b.at.localeCompare(a.at));
/** The demo clock, moved on past anything done in this session (actions are stamped with the real time). */
const clockCache = new WeakMap<State, number>();
export function clockOf(s: State) {
  let c = clockCache.get(s);
  if (c == null) {
    c = nowMs(s);
    for (const t of s.touches) { const x = Date.parse(t.at); if (x > c) c = x; }
    for (const g of s.guard) { const x = Date.parse(g.at); if (x > c) c = x; }
    clockCache.set(s, c);
  }
  return c;
}
const toC = (t: Touch): CTouch => ({ at: t.at, actor: t.actor, direction: t.direction, channel: t.channel, outcome: t.outcome, quiet: t.quiet, contactId: t.contactId, thread: t.thread });
const evalCache = new WeakMap<State, Map<string, Evaluation>>();
/** Where an account stands under the contact rules now: packages/core/contact.ts, the same check the API runs. */
export function verdictFor(s: State, r: AccountRef): Evaluation {
  let m = evalCache.get(s);
  if (!m) { m = new Map(); evalCache.set(s, m); }
  const k = accKey(r);
  if (!m.has(k)) m.set(k, evaluate(accountOf(s, r) || { owner: null }, touchesFor(s, r).map(toC), s.contactRules, clockOf(s)));
  return m.get(k)!;
}
/** Whether a touch may go out now, for the Log a touch dialog and for agent drafts. */
export const checkAttempt = (s: State, r: AccountRef, a: { actor: Actor; channel: TouchChannel; contactId?: string | null; newThread: boolean }, at?: string) =>
  check(accountOf(s, r) || { owner: null }, touchesFor(s, r).map(toC), s.contactRules, at || clockOf(s) + 1, a);
export const pendingHolds = (s: State) => s.guard.filter((g) => g.pending);
export const holdsFor = (s: State, r: AccountRef) => pendingHolds(s).filter((g) => sameAcc(g.account, r));
export const presenceOn = (s: State, r: AccountRef) => s.presence.filter((p) => sameAcc(p.account, r));
export const sequencesFor = (s: State, r: AccountRef) => s.sequences.filter((x) => sameAcc(x.account, r));
export const ownerOf = (s: State, r: AccountRef) => accountOf(s, r)?.owner || null;

export type NeedsItem = { key: string; ref: AccountRef; kind: "confirm" | "reply" | "held"; dueAt: string | null; title: string; detail: string; guardId: string | null };
/** What's waiting on us, soonest limit first: acceptances to confirm, messages to answer, and held sends to decide. */
export function needsAttention(s: State): NeedsItem[] {
  const out: NeedsItem[] = [];
  for (const r of allAccounts(s)) {
    const e = verdictFor(s, r);
    const name = accountName(s, r);
    if (e.verdict === "confirm") out.push({ key: "c" + accKey(r), ref: r, kind: "confirm", dueAt: e.dueAt, title: `Confirm ${possessive(name)} acceptance`, detail: e.rules.find((x) => x.id === "R4")!.detail, guardId: null });
    if (e.verdict === "reply") out.push({ key: "r" + accKey(r), ref: r, kind: "reply", dueAt: e.dueAt, title: `Reply to ${name}`, detail: touchesFor(s, r).find((t) => t.direction === "in" && !t.quiet)?.text || "", guardId: null });
  }
  for (const g of pendingHolds(s)) {
    const e = verdictFor(s, g.account);
    out.push({ key: "h" + g.id, ref: g.account, kind: "held", dueAt: e.rules.find((x) => x.id === g.ruleId)?.dueAt || null, title: `${actorName(s, g.actor)}'s ${g.channel === "email" ? "email" : g.channel} to ${accountName(s, g.account)} is held`, detail: g.reason || RULE_COPY[g.ruleId].name, guardId: g.id });
  }
  return out.sort((a, b) => (a.dueAt || "9").localeCompare(b.dueAt || "9"));
}
export const engagementWaiting = (s: State) => needsAttention(s).length;

export type EngView = "all" | "needs" | "buyers" | "suppliers" | "quiet" | "dnc";
export const ENG_VIEWS: { key: EngView; label: string }[] = [
  { key: "all", label: "All" }, { key: "needs", label: "Needs action" }, { key: "buyers", label: "Buyers" },
  { key: "suppliers", label: "Suppliers" }, { key: "quiet", label: "In quiet period" }, { key: "dnc", label: "Do not contact" },
];
const inView = (s: State, r: AccountRef, v: EngView) => {
  const e = verdictFor(s, r);
  switch (v) {
    case "all": return true;
    case "needs": return e.verdict === "confirm" || e.verdict === "reply" || holdsFor(s, r).length > 0;
    case "buyers": return r.kind === "company";
    case "suppliers": return r.kind === "supplier";
    case "quiet": return e.rules.find((x) => x.id === "R2")!.state === "active";
    case "dnc": return e.verdict === "dnc";
  }
};
export const viewCounts = (s: State) => Object.fromEntries(ENG_VIEWS.map((v) => [v.key, allAccounts(s).filter((r) => inView(s, r, v.key)).length])) as Record<EngView, number>;
export type EngRow = {
  ref: AccountRef; key: string; name: string; kind: string; status: string; owner: Actor | null; verdict: Evaluation["verdict"]; dueAt: string | null;
  last: Touch | null; touches30: number; channels: TouchChannel[]; holds: number; presence: Presence[];
};
export type EngSort = { key: "name" | "verdict" | "due" | "last" | "touches" | "owner"; dir: 1 | -1 };
// Default order: what needs action first, then what limits contact, then the rest.
const VERDICT_RANK = { confirm: 0, reply: 1, quiet: 2, capped: 3, dnc: 4, clear: 5 } as const;
export function engagementRow(s: State, r: AccountRef): EngRow {
  const a = accountOf(s, r)!, e = verdictFor(s, r), xs = touchesFor(s, r);
  const recent = xs.filter((t) => Date.parse(t.at) > clockOf(s) - 30 * D);
  return {
    ref: r, key: accKey(r), name: accountName(s, r), kind: accountKind(r),
    status: r.kind === "company" ? { lead: "Lead", customer: "Customer", lost: "Lost" }[(a as Company).status] : (a as Supplier).category,
    owner: a.owner, verdict: e.verdict, dueAt: e.dueAt, last: xs[0] || null, touches30: recent.length,
    channels: [...new Set(recent.map((t) => t.channel))], holds: holdsFor(s, r).length, presence: presenceOn(s, r),
  };
}
/** The account grid: a saved view, then text, owner and channel filters, sorted. */
export function engagementAccounts(s: State, o: { view?: EngView; text?: string; owner?: string; channel?: string; sort?: EngSort } = {}): EngRow[] {
  const text = (o.text || "").trim().toLowerCase();
  const rows = allAccounts(s).filter((r) => inView(s, r, o.view || "all")).map((r) => engagementRow(s, r)).filter((x) =>
    (!text || x.name.toLowerCase().includes(text) || accountOf(s, x.ref)!.name.toLowerCase().includes(text)) &&
    (!o.owner || o.owner === "all" || (x.owner && x.owner.kind + ":" + x.owner.id === o.owner)) &&
    (!o.channel || o.channel === "all" || x.channels.includes(o.channel as TouchChannel)));
  const sort = o.sort || { key: "verdict", dir: 1 };
  const val = (x: EngRow): string | number => {
    switch (sort.key) {
      case "name": return x.name.toLowerCase();
      case "verdict": return VERDICT_RANK[x.verdict] * 1e13 + (x.dueAt ? Date.parse(x.dueAt) : 9e12);
      case "due": return x.dueAt ? Date.parse(x.dueAt) : 9e15;
      case "last": return x.last ? -Date.parse(x.last.at) : 0;
      case "touches": return -x.touches30;
      case "owner": return x.owner ? actorName(s, x.owner) : "~";
    }
  };
  return rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * sort.dir; });
}
/** Owners to filter by: everyone who owns at least one account. */
export const accountOwners = (s: State) => {
  const seen = new Map<string, Actor>();
  for (const r of allAccounts(s)) { const o = ownerOf(s, r); if (o) seen.set(o.kind + ":" + o.id, o); }
  return [...seen.entries()].map(([key, a]) => ({ key, actor: a, label: actorName(s, a) })).sort((a, b) => a.label.localeCompare(b.label));
};
export const CHANNELS: { key: TouchChannel; label: string; icon: string }[] = [
  { key: "email", label: "Email", icon: "Mail" }, { key: "phone", label: "Phone", icon: "Phone" }, { key: "whatsapp", label: "WhatsApp", icon: "MessageCircle" },
  { key: "linkedin", label: "LinkedIn", icon: "Link2" }, { key: "web", label: "Web form", icon: "Globe" }, { key: "visit", label: "Visit", icon: "Building2" },
];
export const channelLabel = (c: TouchChannel) => CHANNELS.find((x) => x.key === c)!.label;

const localDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayKeyLocal = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const senderOf = (t: Touch) => (t.direction === "in" ? "them" : t.actor?.kind === "agent" ? "agent" : "person");
/** The last `days` days, one cell a day, oldest first: each touch's direction, who sent it and on what. */
export function touchStrip(s: State, r: AccountRef, days = 14) {
  const today = localDay(clockOf(s));
  const xs = touchesFor(s, r);
  return Array.from({ length: days }, (_, i) => {
    const from = today - (days - 1 - i) * D;
    const list = xs.filter((t) => Date.parse(t.at) >= from && Date.parse(t.at) < from + D && Date.parse(t.at) <= clockOf(s));
    return { day: dayKeyLocal(from), touches: list.map((t) => ({ id: t.id, sender: senderOf(t), channel: t.channel, direction: t.direction })) };
  });
}

/** Two outbound touches on one account from different senders inside the quiet period, with no reply between. */
export function doubleContacts(s: State, from: number, to: number) {
  const out: Touch[] = [];
  const hours = s.contactRules.R2.hours * H;
  for (const r of allAccounts(s)) {
    const xs = touchesFor(s, r).slice().reverse();
    let lastOut: Touch | null = null;
    for (const t of xs) {
      if (t.direction === "in") { lastOut = null; continue; }
      const at = Date.parse(t.at);
      if (lastOut && at - Date.parse(lastOut.at) < hours && senderKey(lastOut) !== senderKey(t) && at >= from && at < to) out.push(t);
      lastOut = t;
    }
  }
  return out;
}
const senderKey = (t: Touch) => (t.actor ? t.actor.kind + ":" + t.actor.id : "them");

/** Outbound touches a day for the main chart, split by sender (people, agents) or by channel, with markers. */
export function touchesPerDay(s: State, days = 30, by: "sender" | "channel" = "sender") {
  const today = localDay(clockOf(s));
  const keys = by === "sender" ? ["person", "agent"] : CHANNELS.map((c) => c.key);
  const doubles = doubleContacts(s, today - (days - 1) * D, clockOf(s) + 1);
  const out = Array.from({ length: days }, (_, i) => {
    const from = today - (days - 1 - i) * D, to = from + D;
    const list = s.touches.filter((t) => t.direction === "out" && Date.parse(t.at) >= from && Date.parse(t.at) < to && Date.parse(t.at) <= clockOf(s));
    const parts = Object.fromEntries(keys.map((k) => [k, list.filter((t) => (by === "sender" ? senderOf(t) : t.channel) === k).length])) as Record<string, number>;
    const held = s.guard.filter((g) => (g.decision === "held" || g.decision === "blocked") && Date.parse(g.at) >= from && Date.parse(g.at) < to).length;
    const double = doubles.filter((t) => Date.parse(t.at) >= from && Date.parse(t.at) < to).length;
    return { day: dayKeyLocal(from), at: new Date(from).toISOString(), total: list.length, parts, held, double };
  });
  return { keys, days: out, max: Math.max(1, ...out.map((d) => d.total)) };
}

/** The six figures above the chart, each against the same length of time before it. */
export function engagementFigures(s: State, days = 7) {
  const n = clockOf(s), a = n - days * D, b = a - days * D;
  const inRange = (iso: string, from: number, to: number) => Date.parse(iso) > from && Date.parse(iso) <= to;
  const outs = (from: number, to: number) => s.touches.filter((t) => t.direction === "out" && inRange(t.at, from, to)).length;
  const ins = (from: number, to: number) => s.touches.filter((t) => t.direction === "in" && inRange(t.at, from, to)).length;
  const agentShare = (from: number, to: number) => { const o = s.touches.filter((t) => t.direction === "out" && inRange(t.at, from, to)); return o.length ? o.filter((t) => t.actor?.kind === "agent").length / o.length : 0; };
  const guardN = (from: number, to: number, ds: string[]) => s.guard.filter((g) => ds.includes(g.decision) && inRange(g.at, from, to)).length;
  const replyHours = (from: number, to: number) => {
    const times: number[] = [];
    for (const r of allAccounts(s)) {
      const xs = touchesFor(s, r).slice().reverse();
      for (let i = 0; i < xs.length; i++) {
        const t = xs[i];
        if (t.direction !== "in" || t.quiet || !inRange(t.at, from, to)) continue;
        const reply = xs.slice(i + 1).find((x) => x.direction === "out");
        if (reply) times.push((Date.parse(reply.at) - Date.parse(t.at)) / H);
      }
    }
    times.sort((x, y) => x - y);
    return times.length ? times[Math.floor((times.length - 1) / 2)] : 0;
  };
  return [
    { key: "out", label: "Outbound touches", value: outs(a, n), before: outs(b, a), higherIsBetter: true, unit: "count" as const },
    { key: "in", label: "Messages from them", value: ins(a, n), before: ins(b, a), higherIsBetter: true, unit: "count" as const },
    { key: "agents", label: "Sent by agents", value: agentShare(a, n), before: agentShare(b, a), higherIsBetter: true, unit: "share" as const },
    { key: "reply", label: "Median time to reply", value: replyHours(a, n), before: replyHours(b, a), higherIsBetter: false, unit: "hours" as const },
    { key: "double", label: "Double contacts", value: doubleContacts(s, a, n).length, before: doubleContacts(s, b, a).length, higherIsBetter: false, unit: "count" as const },
    { key: "guard", label: "Held or blocked", value: guardN(a, n, ["held", "blocked"]), before: guardN(b, a, ["held", "blocked"]), higherIsBetter: false, unit: "count" as const },
  ];
}

/** One lane per person or agent (and one for them), with their touches over the last `days` days. */
export function waterfall(s: State, r: AccountRef, days = 14) {
  const to = clockOf(s), from = localDay(to) - (days - 1) * D;
  const xs = touchesFor(s, r).filter((t) => Date.parse(t.at) >= from && Date.parse(t.at) <= to);
  const lanes = new Map<string, { key: string; actor: Actor | null; label: string; touches: Touch[] }>();
  for (const t of xs.slice().reverse()) {
    const k = t.direction === "in" ? "them" : senderKey(t);
    if (!lanes.has(k)) lanes.set(k, { key: k, actor: t.direction === "in" ? null : t.actor, label: t.direction === "in" ? accountName(s, r) : actorName(s, t.actor), touches: [] });
    lanes.get(k)!.touches.push(t);
  }
  const held = s.guard.filter((g) => sameAcc(g.account, r) && (g.decision === "held" || g.decision === "blocked") && Date.parse(g.at) >= from);
  for (const g of held) {
    const k = g.actor.kind + ":" + g.actor.id;
    if (!lanes.has(k)) lanes.set(k, { key: k, actor: g.actor, label: actorName(s, g.actor), touches: [] });
  }
  return { from, to, lanes: [...lanes.values()].sort((a, b) => (a.key === "them" ? -1 : b.key === "them" ? 1 : 0)), held };
}

export type FeedItem = { key: string; at: string; kind: "touch" | "guard"; touch?: Touch; guard?: GuardEvent };
export function accountFeed(s: State, r: AccountRef, filter: "all" | "messages" | "guard" = "all"): FeedItem[] {
  const t = filter === "guard" ? [] : touchesFor(s, r).filter((x) => Date.parse(x.at) <= clockOf(s)).map((x) => ({ key: x.id, at: x.at, kind: "touch" as const, touch: x }));
  const g = filter === "messages" ? [] : s.guard.filter((x) => sameAcc(x.account, r)).map((x) => ({ key: x.id, at: x.at, kind: "guard" as const, guard: x }));
  return [...t, ...g].sort((a, b) => b.at.localeCompare(a.at));
}
export function accountDetails(s: State, r: AccountRef) {
  const a = accountOf(s, r)!;
  const contacts = r.kind === "company" ? s.contacts.filter((c) => c.companyId === r.id) : (a as Supplier).contactName ? [{ id: r.id, name: (a as Supplier).contactName!, role: "Contact", email: (a as Supplier).email, phone: (a as Supplier).phone }] : [];
  return { account: a, kind: accountKind(r), owner: a.owner, handoffTo: a.handoffTo, dnc: a.dnc, contacts, sequences: sequencesFor(s, r), touches: touchesFor(s, r).length };
}

export type GuardFilter = { decision?: "all" | GuardEvent["decision"]; actor?: "all" | "person" | "agent" };
export const guardLog = (s: State, f: GuardFilter = {}) =>
  s.guard.filter((g) => (!f.decision || f.decision === "all" || g.decision === f.decision) && (!f.actor || f.actor === "all" || g.actor.kind === f.actor)).sort((a, b) => b.at.localeCompare(a.at));
export const guardCounts = (s: State) => ({ all: s.guard.length, held: s.guard.filter((g) => g.decision === "held").length, blocked: s.guard.filter((g) => g.decision === "blocked").length, overridden: s.guard.filter((g) => g.decision === "overridden").length, breach: s.guard.filter((g) => g.decision === "breach").length, pending: pendingHolds(s).length });
/** How many accounts each rule is acting on right now. */
export const ruleImpact = (s: State, id: RuleId) => allAccounts(s).filter((r) => { const x = verdictFor(s, r).rules.find((y) => y.id === id)!; return x.state === "active" || x.state === "fail"; }).length;
/** The grid as CSV rows, header first. */
export function engagementCsv(s: State, rows: EngRow[]) {
  return [["Account", "Type", "Status", "Owner", "Verdict", "Due", "Last touch", "Last channel", "Touches in 30 days"],
    ...rows.map((x) => [accountOf(s, x.ref)!.name, x.kind, x.status, x.owner ? actorName(s, x.owner) : "", VERDICT_COPY[x.verdict].label, x.dueAt || "", x.last?.at || "", x.last ? channelLabel(x.last.channel) : "", x.touches30])];
}

/* ---------- Usage and credits: the AI Team's history, from the credits ledger's own rules ---------- */
type Ledger = { entries: Entry[]; days: Map<string, Day>; big: number; key: [unknown, unknown, unknown] };
let ledgerMemo: Ledger | null = null;
/** Every run since the workspace joined, priced from config/model-pricing.ts (packages/core/demoUsage.ts). */
export function usageLedger(s: State): Ledger {
  if (ledgerMemo && ledgerMemo.key[0] === s.usage && ledgerMemo.key[1] === s.agents && ledgerMemo.key[2] === s.now) return ledgerMemo;
  const agents = s.agents.filter((a) => a.template && a.hiredAt).map((a) => ({ id: a.id, name: a.name, template: a.template!, mode: (a.mode || "standard") as ModeKey, rhythm: a.rhythm || "weekdays", hiredAt: a.hiredAt! }));
  const entries = demoHistory({ now: new Date(s.now), joinedAt: s.usage.joinedAt, plan: s.usage.plan, planChanges: s.usage.planChanges, agents, modeChanges: s.usage.modeChanges, pausedDays: s.usage.pausedDays, topups: s.usage.topups });
  const runs = entries.filter((e) => e.kind === "run").map((e) => -e.credits).sort((a, b) => a - b);
  ledgerMemo = { entries, days: dailyUsage(entries), big: quantile(runs, 0.98), key: [s.usage, s.agents, s.now] };
  return ledgerMemo;
}
const used = (es: Entry[], from: number, to: number, agentId?: string | null) => es.filter((e) => (e.kind === "run" || e.kind === "system") && Date.parse(e.at) > from && Date.parse(e.at) <= to && (!agentId || e.agent_id === agentId));
const creditsOf = (es: Entry[]) => -es.reduce((n, e) => n + e.credits, 0);
const periodOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(new Date(iso)).filter((p) => p.type !== "literal").map((p) => p.value).reverse().join("-");
export const planName = (k: string) => PLANS[k]?.name || k;
/** 1 credit is 1p of AI cost (packages/core/credits.ts), so a credit total is also its cost in pence. */
export const creditCost = (credits: number) => Math.round(credits);

/** The five figures for the last `days` days, each against the `days` before. */
export function usageFigures(s: State, days = 30) {
  const { entries } = usageLedger(s);
  const n = nowMs(s), a = n - days * D, b = a - days * D;
  const fig = (from: number, to: number) => {
    const es = used(entries, from, to), credits = creditsOf(es), actions = es.filter((e) => e.kind === "run").length;
    return { credits, cost: creditCost(credits), actions, perAction: actions ? credits / actions : 0 };
  };
  const bal = balanceOf(entries, periodOf(s.now));
  return { now: fig(a, n), before: fig(b, a), left: Math.max(0, bal.total), days };
}

export type HeatCell = { day: string; value: number; level: number; before: boolean; future: boolean; pins: number[] };
export type Pin = { n: number; day: string; label: string; kind: "joined" | "plan" | "agent" | "mode" | "paused" };
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Usage pins: joined, plan changes, new agents, mode changes and days the agents were paused, numbered by date. */
export function usagePins(s: State, from: number): Pin[] {
  const u = s.usage, list: Omit<Pin, "n">[] = [{ day: utcDay(Date.parse(u.joinedAt)), label: "Joined Agent House", kind: "joined" }];
  for (const c of u.planChanges) list.push({ day: utcDay(Date.parse(c.at)), label: `Moved from ${planName(c.from)} to ${planName(c.to)}`, kind: "plan" });
  for (const a of s.agents) if (a.hiredAt && Date.parse(a.hiredAt) > Date.parse(u.joinedAt) + D) list.push({ day: utcDay(Date.parse(a.hiredAt)), label: `${a.name} joined the AI Team`, kind: "agent" });
  for (const c of u.modeChanges) list.push({ day: utcDay(Date.parse(c.at)), label: `${agent(s, c.agentId)?.name} moved from ${modeName(c.from)} to ${modeName(c.to)}`, kind: "mode" });
  for (const d of u.pausedDays) list.push({ day: d, label: "Agents paused all day", kind: "paused" });
  return list.filter((p) => Date.parse(p.day) >= from - D).sort((x, y) => x.day.localeCompare(y.day)).map((p, i) => ({ ...p, n: i + 1 }));
}
/** 52 weeks, one column a week, Monday to Sunday: credits (or actions) a day in five levels, binned at the 30th, 60th and 90th percentiles. */
export function usageCalendar(s: State, o: { metric?: "credits" | "actions"; agentId?: string | null } = {}) {
  const metric = o.metric || "credits", { entries } = usageLedger(s);
  const days = o.agentId ? dailyUsage(entries, { agentId: o.agentId }) : usageLedger(s).days;
  const n = nowMs(s), today = Date.parse(utcDay(n)), dow = (new Date(today).getUTCDay() + 6) % 7; // Monday = 0
  const start = today - dow * D - 51 * 7 * D, joined = Date.parse(utcDay(Date.parse(s.usage.joinedAt)));
  const value = (k: string) => { const d = days.get(k); return !d ? 0 : metric === "credits" ? d.credits : d.actions; };
  const shown: number[] = [];
  for (let t = Math.max(start, joined); t <= today; t += D) shown.push(value(utcDay(t)));
  const bins = percentileBins(shown);
  const pins = usagePins(s, start);
  const weeks: HeatCell[][] = [], months: { col: number; label: string }[] = [];
  for (let w = 0; w < 52; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const t = start + (w * 7 + d) * D, k = utcDay(t), v = value(k);
      col.push({ day: k, value: v, level: t < joined || t > today ? 0 : bins.level(v), before: t < joined, future: t > today, pins: pins.filter((p) => p.day === k).map((p) => p.n) });
      if (new Date(t).getUTCDate() === 1) months.push({ col: w, label: new Date(t).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) });
    }
    weeks.push(col);
  }
  return { metric, weeks, months, thresholds: bins.thresholds, pins, total: shown.reduce((a, b) => a + b, 0) };
}
/** What one day held: credits, actions, cost, the split by agent, and its biggest run if it was a big one. */
export function usageDay(s: State, day: string, agentId?: string | null) {
  const L = usageLedger(s), d = (agentId ? dailyUsage(L.entries, { agentId }) : L.days).get(day);
  const credits = d?.credits || 0;
  return {
    day, credits, actions: d?.actions || 0, cost: creditCost(credits),
    byAgent: Object.entries(d?.byAgent || {}).map(([id, c]) => ({ id, name: id === "system" ? "AI Team (system)" : agent(s, id)?.name || id, credits: c })).sort((a, b) => b.credits - a.credits),
    bigRun: d?.biggest && d.biggest.credits >= L.big ? { ...d.biggest, agent: d.biggest.agent_id ? agent(s, d.biggest.agent_id)?.name || "" : "" } : null,
  };
}
/** Spend by agent over the last `days` days, ranked, with a 12-week strip each. */
export function spendByAgent(s: State, days = 30) {
  const { entries } = usageLedger(s), n = nowMs(s), from = n - days * D;
  const total = creditsOf(used(entries, from, n));
  return s.agents.map((a) => {
    const es = used(entries, from, n, a.id), credits = creditsOf(es);
    return { id: a.id, name: a.name, role: a.roleName, mode: a.mode || "standard", credits, cost: creditCost(credits), runs: es.filter((e) => e.kind === "run").length, share: total ? credits / total : 0, weekly: weekly(entries, n, 12, a.id) };
  }).sort((x, y) => y.credits - x.credits);
}
/** Deep against Standard (and the rest): each mode's share of credits and of actions in the last `days` days. */
export function modeShare(s: State, days = 30) {
  const { entries } = usageLedger(s), n = nowMs(s), es = used(entries, n - days * D, n).filter((e) => e.kind === "run");
  const credits = creditsOf(es), actions = es.length;
  return MODE_ORDER.map((m) => { const mine = es.filter((e) => e.mode === m); return { mode: m, name: modeName(m), credits: creditsOf(mine), actions: mine.length, creditShare: credits ? creditsOf(mine) / credits : 0, actionShare: actions ? mine.length / actions : 0 }; }).filter((x) => x.actions > 0);
}
/** This month on the plan: used against the allowance, where the month is heading, and each agent's budget. */
export function planStatus(s: State) {
  const { entries } = usageLedger(s), period = periodOf(s.now), n = nowMs(s);
  const month = entries.filter((e) => e.period === period);
  const usedNow = creditsOf(month.filter((e) => e.kind === "run" || e.kind === "system"));
  const planCredits = PLAN_CREDITS[s.usage.plan] || 0, bal = balanceOf(entries, period);
  const topup = Math.max(0, bal.topup), allowance = planCredits + topup;
  const d = new Date(n), first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const projected = usedNow / Math.max(1 / 24, (n - first) / D) * ((next - first) / D);
  const budgets = s.agents.filter((a) => a.monthlyBudget).map((a) => ({ id: a.id, name: a.name, budget: a.monthlyBudget!, used: creditsOf(month.filter((e) => e.kind === "run" && e.agent_id === a.id)) }));
  return { plan: s.usage.plan, name: planName(s.usage.plan), planCredits, topup, allowance, used: usedNow, left: Math.max(0, bal.total), projected, resetOn: new Date(next).toISOString(), topupOffer: TOPUP, budgets };
}
/** The single jobs that used the most credits in the last `days` days. */
export const topRuns = (s: State, days = 30, n = 5) => {
  const now = nowMs(s);
  return biggestRuns(usageLedger(s).entries, now - days * D, now, n).map((e) => ({ id: e.run_id!, at: e.at, agentId: e.agent_id!, agent: agent(s, e.agent_id!)?.name || "", mode: e.mode!, note: e.note || "", credits: -e.credits, cost: creditCost(-e.credits) }));
};
/** What logging a touch from earlier would record: the rule it broke at the time, if any. */
export function previewLogged(s: State, r: AccountRef, x: { actor: Actor; channel: TouchChannel; at: string; contactId?: string | null; thread?: string | null }) {
  const before = touchesFor(s, r).filter((t) => Date.parse(t.at) < Date.parse(x.at)).map(toC);
  return classifyLogged(accountOf(s, r) || { owner: null }, before, s.contactRules, { at: x.at, actor: x.actor, direction: "out", channel: x.channel, contactId: x.contactId ?? null, thread: x.thread ?? null });
}
/** "due in 3 h", "2 h overdue", "until 3 May": how long a rule has left, from the demo clock. */
export function dueText(s: State, iso: string | null, kind: "due" | "until" = "due") {
  if (!iso) return "";
  const ms = Date.parse(iso) - clockOf(s), a = Math.abs(ms);
  const span = a < H ? `${Math.max(1, Math.round(a / 60e3))} min` : a < 2 * D ? `${Math.round(a / H)} h` : `${Math.round(a / D)} days`;
  if (kind === "until") return a > 14 * D ? `until ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : `for ${span}`;
  return ms >= 0 ? `due in ${span}` : `${span} overdue`;
}
export const isOverdueAt = (s: State, iso: string | null) => !!iso && Date.parse(iso) < clockOf(s);
