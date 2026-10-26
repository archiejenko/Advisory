// Every figure the workspace shows is worked out here, from the store. Nothing on screen is typed in by hand.
import type { Agent, Approval, ApprovalType, Company, Invoice, Job, Ref, State } from "./types";
import { APPS, actionsPerMonth, shellApps } from "./catalogue";
import { pounds } from "./format";

const D = 86400e3;
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
export const agentCount = (s: State) => s.agents.length;
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
  return hits.slice(0, 8);
}

export type { Approval, Company };
