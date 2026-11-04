// The Usage page's history: every run since the workspace joined, priced from config/model-pricing.ts and charged by
// the credits ledger's rules, then binned for the heatmap. No figure on the page is typed in.
import { describe, expect, it } from "vitest";
import { demoHistory } from "../../packages/core/demoUsage";
import { dailyUsage, percentileBins, quantile, biggestRuns, weekly, balanceOf } from "../../packages/core/usage";
import { creditsFor } from "../../packages/core/credits";
import { PLAN_CREDITS, MODES } from "../../config/model-pricing";
import { seed } from "../../apps/web/src/workspace/demo/seed";
import * as q from "../../apps/web/src/workspace/demo/selectors";

const NOW = Date.UTC(2026, 10, 4, 15);
const s = seed(NOW);
const D = 864e5;

describe("demoHistory", () => {
  const input = () => ({ now: new Date(NOW), joinedAt: s.usage.joinedAt, plan: s.usage.plan, planChanges: s.usage.planChanges, modeChanges: s.usage.modeChanges, pausedDays: s.usage.pausedDays, topups: s.usage.topups,
    agents: s.agents.map((a) => ({ id: a.id, name: a.name, template: a.template!, mode: a.mode!, rhythm: a.rhythm!, hiredAt: a.hiredAt! })) });
  const es = demoHistory(input());
  const runs = es.filter((e) => e.kind === "run");

  it("is the same every time for the same input", () => expect(demoHistory(input())).toEqual(es));
  it("starts the day the workspace joined, and stops now", () => {
    expect(Math.min(...es.map((e) => Date.parse(e.at)))).toBeGreaterThanOrEqual(Date.parse(s.usage.joinedAt));
    expect(Math.max(...es.map((e) => Date.parse(e.at)))).toBeLessThanOrEqual(NOW);
  });
  it("Bea only runs after she was hired", () => {
    const bea = runs.filter((e) => e.agent_id === "agt_brief");
    expect(bea.length).toBeGreaterThan(10);
    expect(Math.min(...bea.map((e) => Date.parse(e.at)))).toBeGreaterThanOrEqual(Date.parse(s.agents.find((a) => a.id === "agt_brief")!.hiredAt!));
  });
  it("nothing runs on the day the agents were paused", () => expect(runs.filter((e) => e.at.startsWith(s.usage.pausedDays[0]))).toEqual([]));
  it("runs in the mode in force that day: Maya was on Deep for a month", () => {
    const maya = runs.filter((e) => e.agent_id === "agt_sales");
    const [on, off] = [Date.parse(s.usage.modeChanges[1].at), Date.parse(s.usage.modeChanges[2].at)];
    expect(maya.filter((e) => Date.parse(e.at) > on && Date.parse(e.at) < off).every((e) => e.mode === "deep")).toBe(true);
    expect(maya.filter((e) => Date.parse(e.at) > off).every((e) => e.mode === "standard")).toBe(true);
  });
  it("prices every run from the pricing config, never below the per-run minimum", () => {
    for (const e of runs.slice(0, 50)) {
      const raw = creditsFor(MODES[e.mode as keyof typeof MODES].model, { input: e.tokens_in, cacheRead: e.cache_read, cacheWrite: e.cache_write, output: e.tokens_out }, e.requests);
      expect(-e.credits).toBeCloseTo(Math.max(1, Math.round(raw * 100) / 100), 2);
    }
  });
  it("grants each month's plan credits from the plan in force: Starter before the change, Growth after", () => {
    const grants = es.filter((e) => e.kind === "plan_grant");
    const change = Date.parse(s.usage.planChanges[0].at);
    for (const g of grants) expect(g.credits).toBe(Date.parse(g.at) < change ? PLAN_CREDITS.starter : PLAN_CREDITS.growth);
  });
  it("splits every charge between plan and top-up credits, and lapses plan credits at month end", () => {
    for (const e of runs) expect(e.from_plan + e.from_topup).toBeCloseTo(e.credits, 2);
    expect(es.filter((e) => e.kind === "plan_expiry").length).toBeGreaterThan(3);
    expect(es.some((e) => e.kind === "topup" && e.credits === 1000)).toBe(true);
  });
  it("has a few big runs", () => expect(runs.filter((e) => /backlog|batch|Reconciled|Rebuilt|every account|quarterly/.test(e.note || "")).length).toBeGreaterThan(5));
});

describe("aggregation", () => {
  it("daily totals add up to the ledger", () => {
    const es = q.usageLedger(s).entries;
    const days = dailyUsage(es);
    const sum = [...days.values()].reduce((n, d) => n + d.credits, 0);
    expect(sum).toBeCloseTo(-es.filter((e) => e.kind === "run" || e.kind === "system").reduce((n, e) => n + e.credits, 0), 6);
    for (const d of days.values()) expect(Object.values(d.byAgent).reduce((a, b) => a + b, 0)).toBeCloseTo(d.credits, 6);
  });
  it("filters by agent", () => {
    const es = q.usageLedger(s).entries;
    const theo = dailyUsage(es, { agentId: "agt_cs" });
    for (const d of theo.values()) expect(Object.keys(d.byAgent)).toEqual(["agt_cs"]);
  });
  it("bins at the 30th, 60th and 90th percentiles of days with any use", () => {
    const v = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = percentileBins(v);
    expect(b.thresholds).toEqual([quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.3), quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.6), quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)]);
    [3.7, 6.4, 9.1].forEach((x, i) => expect(b.thresholds[i]).toBeCloseTo(x, 10));
    expect([0, 1, 3.6, 3.8, 6.3, 9, 9.2, 10].map(b.level)).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
  });
  it("biggest runs are the top five by credits", () => {
    const es = q.usageLedger(s).entries;
    const top = biggestRuns(es, NOW - 30 * D, NOW, 5);
    expect(top).toHaveLength(5);
    const all = es.filter((e) => e.kind === "run" && Date.parse(e.at) >= NOW - 30 * D).map((e) => -e.credits).sort((a, b) => b - a);
    expect(top.map((e) => -e.credits)).toEqual(all.slice(0, 5));
  });
  it("weekly totals for the strip", () => {
    const es = q.usageLedger(s).entries;
    const w = weekly(es, NOW, 12, "agt_cs");
    expect(w).toHaveLength(12);
    expect(w.every((x) => x > 0)).toBe(true);
  });
});

describe("the Usage page's selectors", () => {
  it("the heatmap is 52 weeks of Monday to Sunday, greyed before the workspace joined, nothing in the future", () => {
    const c = q.usageCalendar(s);
    expect(c.weeks).toHaveLength(52);
    for (const w of c.weeks) {
      expect(w).toHaveLength(7);
      expect(new Date(w[0].day).getUTCDay()).toBe(1);
    }
    const cells = c.weeks.flat();
    expect(cells.filter((x) => x.before).length).toBeGreaterThan(50);
    expect(cells.filter((x) => x.before).every((x) => x.level === 0)).toBe(true);
    expect(cells.filter((x) => x.future).every((x) => x.level === 0)).toBe(true);
    expect(cells.find((x) => x.day === new Date(NOW).toISOString().slice(0, 10))!.future).toBe(false);
    expect(new Set(cells.map((x) => x.level))).toEqual(new Set([0, 1, 2, 3, 4]));
  });
  it("credits and actions bin separately, and the agent filter applies", () => {
    const a = q.usageCalendar(s, { metric: "actions" }), t = q.usageCalendar(s, { agentId: "agt_cs" });
    expect(a.thresholds).not.toEqual(q.usageCalendar(s).thresholds);
    expect(t.total).toBeLessThan(q.usageCalendar(s).total);
  });
  it("pins: joined, plan change, Bea joining, mode changes and the paused day, numbered by date", () => {
    const p = q.usageCalendar(s).pins;
    expect(new Set(p.map((x) => x.kind))).toEqual(new Set(["joined", "plan", "agent", "mode", "paused"]));
    expect(p.map((x) => x.n)).toEqual(p.map((_, i) => i + 1));
    expect(p.map((x) => x.day)).toEqual([...p.map((x) => x.day)].sort());
  });
  it("a day's tooltip splits credits by agent and adds up", () => {
    const busy = q.usageCalendar(s).weeks.flat().filter((x) => !x.before && !x.future && x.value > 0)[10];
    const d = q.usageDay(s, busy.day);
    expect(d.byAgent.reduce((n, x) => n + x.credits, 0)).toBeCloseTo(d.credits, 6);
    expect(d.cost).toBe(Math.round(d.credits));
  });
  it("figures for the last 30 days, with credits left this cycle from the ledger", () => {
    const f = q.usageFigures(s);
    expect(f.now.credits).toBeGreaterThan(0);
    expect(f.now.perAction).toBeCloseTo(f.now.credits / f.now.actions, 6);
    expect(f.left).toBe(Math.max(0, balanceOf(q.usageLedger(s).entries, "2026-11").total));
  });
  it("spend by agent is ranked and its shares add to one", () => {
    const r = q.spendByAgent(s);
    expect(r).toHaveLength(6);
    expect(r.map((x) => x.credits)).toEqual([...r.map((x) => x.credits)].sort((a, b) => b - a));
    expect(r.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 6);
  });
  it("the plan card reads Growth from the pricing config", () => {
    const p = q.planStatus(s);
    expect(p.planCredits).toBe(PLAN_CREDITS.growth);
    expect(p.name).toBe("Growth");
    expect(p.used).toBeGreaterThan(0);
  });
  it("mode shares add to one, with Deep and Standard both in use", () => {
    const m = q.modeShare(s);
    expect(m.map((x) => x.mode).sort()).toEqual(["deep", "standard"]);
    expect(m.reduce((n, x) => n + x.creditShare, 0)).toBeCloseTo(1, 6);
    expect(m.reduce((n, x) => n + x.actionShare, 0)).toBeCloseTo(1, 6);
  });
});
