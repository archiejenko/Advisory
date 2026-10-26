// The Brightwork demo seed must reconcile exactly: every headline figure on screen comes from these selectors.
import { describe, expect, it } from "vitest";
import { seed } from "../../apps/web/src/workspace/demo/seed";
import * as q from "../../apps/web/src/workspace/demo/selectors";
import { pounds } from "../../apps/web/src/workspace/demo/format";

// Every day of a week, at an early, a working and a late hour.
const CLOCKS: number[] = [];
for (let d = 0; d < 7; d++) for (const h of [0.5, 9, 18.75]) CLOCKS.push(Date.UTC(2026, 9, 26 + d, 0, 0) + h * 3600e3);

describe.each(CLOCKS.map((t) => [new Date(t).toISOString(), t]))("Brightwork seed at %s", (_label, t) => {
  const s = seed(t as number);

  it("has exactly 3 overdue invoices totalling £2,336.00", () => {
    const o = q.overdueInvoices(s);
    expect(o.length).toBe(3);
    expect(q.overdueTotal(s)).toBe(233600);
    expect(pounds(q.overdueTotal(s))).toBe("£2,336.00");
    expect(o.map((i) => q.company(s, i.companyId)!.name).sort()).toEqual(["Didsbury Lettings Ltd", "Spinningfields Law LLP", "Tarnbrook Logistics Ltd"]);
  });

  it("has INV-1047 from Tarnbrook, £1,280.00, 21 days late, one reminder sent", () => {
    const i = s.invoices.find((x) => x.id === "INV-1047")!;
    expect(i.companyId).toBe("co_tarnbrook");
    expect(i.total).toBe(128000);
    expect(q.daysLate(s, i)).toBe(21);
    expect(q.remindersSent(i)).toBe(1);
    expect(s.invoices.find((x) => x.companyId === "co_didsbury" && q.isOverdue(s, x))!.total).toBe(65600);
    expect(s.invoices.find((x) => x.companyId === "co_spinning" && q.isOverdue(s, x))!.total).toBe(40000);
  });

  it("has £320.00 due in the next 7 days", () => expect(q.dueSoonTotal(s)).toBe(32000));

  it("has 10 decisions waiting: 4 routine and 6 to review", () => {
    expect(q.pendingCount(s)).toBe(10);
    expect(q.routine(s).length).toBe(4);
    expect(q.review(s).length).toBe(6);
  });

  it("has 6 new leads, 2 replies (1 today) and Ancoats won this week", () => {
    expect(q.newLeadCount(s)).toBe(6);
    expect(q.newLeadsThisWeek(s).some((c) => c.name === "Peel Street Accountants Ltd")).toBe(true);
    expect(q.repliesThisWeek(s).length).toBe(2);
    expect(q.repliesToday(s).length).toBe(1);
    expect(q.wonThisWeek(s).map((d) => d.companyId)).toEqual(["co_ancoats"]);
    expect(s.quotes.find((x) => x.companyId === "co_ancoats")!.status).toBe("accepted");
    expect(s.jobs.some((j) => j.companyId === "co_ancoats" && j.kind === "clean")).toBe(true);
  });

  it("has a pending outreach for Peel Street and drafted replies for Salford Quays and Castlefield", () => {
    const p = q.pending(s);
    expect(p.some((a) => a.type === "send_outreach" && a.linkedRecord.id === "co_peel")).toBe(true);
    expect(p.some((a) => a.linkedRecord.id === "cv_salford")).toBe(true);
    const c = p.find((a) => a.linkedRecord.id === "cv_castlefield")!;
    expect(c.note).toMatch(/diary/i);
    expect(c.preview.kind === "email" && c.preview.body).toMatch(/5\.30pm/);
    expect(p.find((a) => a.id === "apr_tarnbrook")!.reason).toMatch(/21 days late/);
  });

  it("has six agents and eight people", () => {
    expect(q.agentCount(s)).toBe(6);
    expect(s.agents.map((a) => a.roleName)).toEqual(["Sales", "Customer service", "Credit control", "Operations", "Finance", "Briefing"]);
    expect(q.peopleCount(s)).toBe(8);
    expect(s.people.find((p) => p.name === "Dana Price")!.role).toBe("Owner");
  });

  it("links every record to something that exists", () => {
    const ids = new Set([...s.companies, ...s.contacts, ...s.deals, ...s.quotes, ...s.jobs, ...s.invoices, ...s.bills, ...s.conversations, ...s.tasks, ...s.approvals, ...s.people, ...s.agents, ...s.records].map((x) => x.id));
    for (const a of s.approvals) expect(ids.has(a.linkedRecord.id), a.id).toBe(true);
    for (const x of s.tasks) if (x.linkedRecord) expect(ids.has(x.linkedRecord.id), x.id).toBe(true);
    for (const e of s.activity) if (e.linkedRecord) expect(ids.has(e.linkedRecord.id), e.verb).toBe(true);
    for (const m of s.chat) if (m.card) expect(ids.has(m.card.ref.id), m.body).toBe(true);
    for (const i of s.invoices) expect(ids.has(i.companyId)).toBe(true);
    for (const d of s.deals) expect(ids.has(d.companyId)).toBe(true);
    for (const qu of s.quotes) expect(ids.has(qu.dealId)).toBe(true);
  });

  it("has history to compare against: 8 weeks of payments and agent work", () => {
    const oldest = Math.min(...s.payments.map((p) => Date.parse(p.at)));
    expect(t as number - oldest).toBeGreaterThan(56 * 86400e3);
    expect(q.minutesSaved(s, 35, 7)).toBeGreaterThan(0);
    expect(q.responseMinutes(s, 35, 7)).toBeGreaterThan(0);
    expect(q.lateRun(s, "co_tarnbrook")).toBeGreaterThanOrEqual(4);
  });

  it("has one trust-ladder prompt ready: Credit control reminders", () => {
    const t2 = q.trustPrompts(s);
    expect(t2.map((x) => x.key)).toEqual(["agt_credit:send_reminder"]);
  });

  it("has 2 to 4 leaks", () => {
    const l = q.leaks(s);
    expect(l.length).toBeGreaterThanOrEqual(2);
    expect(l.length).toBeLessThanOrEqual(4);
    expect(l.some((x) => x.title.startsWith("3 quotes unanswered"))).toBe(true);
    expect(l.some((x) => /Tarnbrook paid late 4 months running/.test(x.title))).toBe(true);
  });
});

describe("store actions keep the figures in step", async () => {
  const store = await import("../../apps/web/src/workspace/demo/store");
  it("approving removes the decision, logs it, and undo puts it all back", () => {
    store.init(seed(Date.UTC(2026, 9, 26, 18)));
    const before = store.getState();
    const tok = store.approve("apr_tarnbrook")!;
    let s = store.getState();
    expect(q.pendingCount(s)).toBe(9);
    expect(q.remindersSent(s.invoices.find((x) => x.id === "INV-1047")!)).toBe(2);
    expect(s.activity[0].verb).toMatch(/second reminder for INV-1047/);
    store.undo(tok);
    s = store.getState();
    expect(q.pendingCount(s)).toBe(10);
    expect(q.remindersSent(s.invoices.find((x) => x.id === "INV-1047")!)).toBe(1);
    expect(s.activity.length).toBe(before.activity.length);
  });
  it("accepting the trust prompt sends reminders under £500 without asking", () => {
    store.init(seed(Date.UTC(2026, 9, 26, 18)));
    store.acceptTrust("agt_credit", "send_reminder", 50000);
    const s = store.getState();
    expect(q.pendingCount(s)).toBe(9); // Spinningfields (£400) went; Didsbury (£656) and Tarnbrook (£1,280) still ask
    expect(s.agents.find((a) => a.id === "agt_credit")!.autonomy[0]).toMatchObject({ mode: "auto", maxValue: 50000 });
    expect(q.trustPrompts(s)).toEqual([]);
  });
  it("paying the overdue bill lowers the cash balance", () => {
    store.init(seed(Date.UTC(2026, 9, 26, 18)));
    const cash = store.getState().org.cashBalance;
    store.approve("apr_bill");
    expect(store.getState().org.cashBalance).toBe(cash - 68420);
    expect(q.billsOverdue(store.getState()).length).toBe(0);
  });
});
