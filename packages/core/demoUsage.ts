// A believable few months of credit use for a demo business: the offline demo shows it, and scripts/seed-demo.mjs
// writes it to a local database. Deterministic (same seed, same ledger), priced with the real config, and built by
// the ledger's own rules: plan credits first, then top-ups, plan credits lapse on the 1st.
import { MODES, PLAN_CREDITS, TOPUP, SYSTEM_MODE, type ModeKey } from "../../config/model-pricing";
import { creditsFor, runCharge, toLedger } from "./credits";
import { taskTypeOf, type TaskType } from "./modes";
import type { Entry, UsageAgent } from "./usage";

export type DemoAgent = UsageAgent & { rhythm: string; mode: ModeKey };

/** A typical run of each kind of job: model requests and tokens per request (uncached in, cache reads, cache writes, out). */
const PROFILE: Record<TaskType, { requests: number; input: number; read: number; write: number; output: number }> = {
  triage: { requests: 3, input: 2000, read: 10_000, write: 2700, output: 800 },
  drafting: { requests: 5, input: 1600, read: 12_000, write: 2400, output: 800 },
  bookkeeping: { requests: 4, input: 1500, read: 9000, write: 2000, output: 600 },
  briefing: { requests: 4, input: 2500, read: 15_000, write: 3000, output: 1200 },
  coordination: { requests: 4, input: 1800, read: 11_000, write: 2200, output: 700 },
  research: { requests: 8, input: 2500, read: 19_000, write: 3100, output: 1000 },
  analysis: { requests: 7, input: 3000, read: 20_000, write: 3500, output: 1100 },
  strategy: { requests: 8, input: 3800, read: 25_000, write: 5000, output: 1900 },
};
const RUNS_PER_MONTH: Record<string, number> = { weekdays: 22, daily: 30, weekly: 4, monthly: 2, on_demand: 10, on_event: 64 };

/** The demo business's AI Team. Inbox is on Deep (so the Usage page has a saving to suggest); Research has a budget it reaches. */
export const DEMO_AGENTS: DemoAgent[] = [
  { id: "agt_inb", name: "Inbox", template: "inbox", mode: "deep", rhythm: "on_event" },
  { id: "agt_out", name: "Outreach", template: "outreach", mode: "standard", rhythm: "weekdays" },
  { id: "agt_cc", name: "Credit control", template: "credit-control", mode: "standard", rhythm: "weekdays" },
  { id: "agt_res", name: "Research", template: "research", mode: "deep", rhythm: "on_demand", monthly_budget: 150 },
  { id: "agt_brief", name: "Weekly briefing", template: "briefing", mode: "standard", rhythm: "weekly" },
  { id: "agt_strat", name: "Growth strategist", template: "custom", mode: "strategy", rhythm: "monthly", role: "Quarterly growth strategy and pricing review", instructions: "Write the quarter's growth plan and pricing review for the owner." },
];

const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const ukPeriod = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(d).filter((p) => p.type !== "literal").map((p) => p.value).reverse().join("-");
const monthStart = (d: Date, back: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1, 0, 30));

/**
 * The ledger for `months` months up to `now`: a grant on each 1st, each agent's runs (the current month only up to
 * today), a top-up, a little AI Team (system) use, and the lapse of plan credits left at each month's end.
 * Run ids are given so the seed can write matching agent_run rows.
 */
export function demoLedger(o: { plan?: string; now?: Date; months?: number; seed?: number; agents?: DemoAgent[] } = {}) {
  const plan = o.plan || "growth", now = o.now || new Date(), months = o.months ?? 3, agents = o.agents || DEMO_AGENTS;
  const r = rng(o.seed ?? 7);
  const events: (Entry & { sort: number })[] = [];
  const ev = (e: Omit<Partial<Entry>, "at"> & { kind: string; at: Date }) => events.push({ credits: 0, from_plan: 0, from_topup: 0, period: ukPeriod(e.at), tokens_in: 0, cache_read: 0, cache_write: 0, tokens_out: 0, requests: 0, ...e, at: e.at.toISOString(), sort: e.at.getTime() } as any);
  let n = 0;
  for (let back = months - 1; back >= 0; back--) {
    const start = monthStart(now, back);
    const end = back === 0 ? now : monthStart(now, back - 1);
    const days = (end.getTime() - start.getTime()) / 864e5, full = (monthStart(now, back - 1).getTime() - start.getTime()) / 864e5;
    ev({ kind: "plan_grant", at: start, credits: PLAN_CREDITS[plan] || 0, note: `${plan} plan credits` });
    if (back === 1) ev({ kind: "topup", at: new Date(start.getTime() + 18.4 * 864e5), credits: TOPUP.credits, note: "1,000 credits top-up" });
    for (const a of agents) {
      const count = Math.round(RUNS_PER_MONTH[a.rhythm] * (days / full) * (0.85 + r() * 0.3));
      const p = PROFILE[taskTypeOf({ template: a.template, text: a.template === "custom" ? `${a.role} ${a.instructions}` : null })];
      for (let i = 0; i < count; i++) {
        // Between 02:00 on the 1st and 22:00 on the last day, so every run is in its month in UK time too.
        const at = new Date(start.getTime() + 2 * 3600e3 + ((i + r()) / Math.max(count, 1)) * (days * 864e5 - 4 * 3600e3));
        const x = 0.6 + r() * 0.8, req = Math.max(1, Math.round(p.requests * (0.7 + r() * 0.6)));
        const tokens = { input: Math.round(p.input * x * req), cacheRead: Math.round(p.read * x * req), cacheWrite: Math.round(p.write * x), output: Math.round(p.output * x * req) };
        ev({ kind: "run", at, agent_id: a.id, run_id: `run_demo${++n}`, mode: a.mode, model: MODES[a.mode].model, credits: -creditsFor(MODES[a.mode].model, tokens, req),
          tokens_in: tokens.input, cache_read: tokens.cacheRead, cache_write: tokens.cacheWrite, tokens_out: tokens.output, requests: req, ok: r() > 0.04 });
      }
    }
    const sys = Math.round(14 * (days / full));
    for (let i = 0; i < sys; i++) {
      const tokens = { input: Math.round(2500 + r() * 3000), cacheRead: 0, cacheWrite: 0, output: Math.round(300 + r() * 500) };
      ev({ kind: "system", at: new Date(start.getTime() + 2 * 3600e3 + r() * (days * 864e5 - 4 * 3600e3)), model: MODES[SYSTEM_MODE].model, credits: -creditsFor(MODES[SYSTEM_MODE].model, tokens), note: r() > 0.5 ? "Command bar" : "Learning a house rule",
        tokens_in: tokens.input, tokens_out: tokens.output, requests: 1 });
    }
  }
  events.sort((a, b) => a.sort - b.sort);
  // Apply the ledger's rules in time order: split use between plan and top-up credits, enforce budgets, lapse at month end.
  const out: Entry[] = [];
  let period = "", plan_ = 0, topup = 0;
  const used: Record<string, number> = {};
  const paused: Record<string, string> = {};
  for (const e of events) {
    if (e.period !== period) {
      if (period && Math.abs(plan_) >= 0.005) out.push({ kind: "plan_expiry", at: new Date(e.sort - 1000).toISOString(), period, credits: toLedger(-plan_), from_plan: toLedger(-plan_), from_topup: 0, note: "Unused plan credits lapse on the 1st", tokens_in: 0, cache_read: 0, cache_write: 0, tokens_out: 0, requests: 0 } as Entry);
      period = e.period; plan_ = 0;
      for (const k of Object.keys(used)) delete used[k];
    }
    const { sort, ...x } = e;
    if (x.kind === "plan_grant") { plan_ += x.credits; out.push({ ...x, from_plan: x.credits }); continue; }
    if (x.kind === "topup") { topup += x.credits; out.push({ ...x, from_topup: x.credits }); continue; }
    const agent = agents.find((a) => a.id === x.agent_id);
    if (agent?.monthly_budget != null && (used[agent.id] || 0) >= agent.monthly_budget) { paused[agent.id] = period; continue; }
    if (Math.max(0, plan_) + Math.max(0, topup) <= 0) continue; // paused: no credits left
    const c = x.kind === "run" ? runCharge(-x.credits) : toLedger(-x.credits);
    const fromPlan = Math.min(c, Math.max(0, plan_)), fromTop = Math.min(c - fromPlan, Math.max(0, topup));
    plan_ -= c - fromTop; topup -= fromTop;
    if (agent) used[agent.id] = (used[agent.id] || 0) + c;
    if (agent?.monthly_budget != null && used[agent.id] >= agent.monthly_budget) paused[agent.id] = period;
    out.push({ ...x, credits: -c, from_plan: toLedger(-(c - fromTop)), from_topup: toLedger(-fromTop) });
  }
  return { entries: out, period, budgetPaused: paused, agents: agents.map((a) => ({ ...a, budget_paused_period: paused[a.id] === period ? period : null })) };
}

/* ---------- A workspace's whole history, day by day, for the Usage page's heatmap ---------- */

export type HistoryAgent = DemoAgent & { hiredAt: string };
/** What a run did, by template, for the tooltip and biggest runs. Big runs are the long ones an agent does now and then. */
const RUN_NOTE: Record<string, [string, string]> = {
  outreach: ["Wrote first emails and follow-ups", "Researched and qualified a batch of new leads"],
  inbox: ["Read the inbox and drafted replies", "Worked through a backlog of enquiries"],
  "credit-control": ["Checked what's overdue and drafted reminders", "Reviewed every account's payment history"],
  orchestrator: ["Updated jobs, the rota and supplies", "Rebuilt next month's rota"],
  bookkeeping: ["Matched payments and recorded bills", "Reconciled the quarter's bank feed"],
  briefing: ["Wrote the weekly briefing", "Wrote the quarterly review"],
};
const BIG_ODDS = 0.025, BIG_X = 7;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Every run from the day the workspace joined until `now`, priced with the real config and charged by the ledger's
 * rules: each month's plan credits (from the plan in force on the 1st, after any change), then top-ups, and plan
 * credits lapse at month end. Agents start on the day they were hired, run in the mode in force that day, and
 * nothing runs on a day the owner paused them. Deterministic for the same input.
 */
export function demoHistory(o: {
  now: Date; joinedAt: string; plan: string; planChanges?: { at: string; from: string; to: string }[];
  agents: HistoryAgent[]; modeChanges?: { at: string; agentId: string; from: string; to: string }[];
  pausedDays?: string[]; topups?: { at: string; credits: number }[]; seed?: number;
}): Entry[] {
  const r = rng(o.seed ?? 21);
  const changes = [...(o.planChanges || [])].sort((a, b) => a.at.localeCompare(b.at));
  const planAt = (ms: number) => { let p = changes.length ? changes[0].from : o.plan; for (const c of changes) if (Date.parse(c.at) <= ms) p = c.to; return p; };
  const modeAt = (a: HistoryAgent, ms: number) => {
    const mine = (o.modeChanges || []).filter((c) => c.agentId === a.id).sort((x, y) => x.at.localeCompare(y.at));
    let m = mine.length ? mine[0].from : a.mode;
    for (const c of mine) if (Date.parse(c.at) <= ms) m = c.to;
    return m as ModeKey;
  };
  const paused = new Set(o.pausedDays || []);
  const start = Date.parse(o.joinedAt), end = o.now.getTime();
  const events: (Entry & { sort: number })[] = [];
  const ev = (e: Omit<Partial<Entry>, "at"> & { kind: string; at: number }) => events.push({ credits: 0, from_plan: 0, from_topup: 0, tokens_in: 0, cache_read: 0, cache_write: 0, tokens_out: 0, requests: 0, ...e, period: ukPeriod(new Date(e.at)), at: new Date(e.at).toISOString(), sort: e.at });
  // A grant on the 1st of every month from the one the workspace joined in (the first is the day it joined).
  for (let m = monthStart(new Date(start), 0); m.getTime() <= end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1, 0, 30))) {
    const at = Math.max(m.getTime(), start), plan = planAt(at);
    ev({ kind: "plan_grant", at, credits: PLAN_CREDITS[plan] || 0, note: `${plan} plan credits` });
  }
  for (const t of o.topups || []) if (Date.parse(t.at) <= end) ev({ kind: "topup", at: Date.parse(t.at), credits: t.credits, note: `${t.credits.toLocaleString("en-GB")} credits top-up` });
  let n = 0;
  for (let d = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate()); d <= end; d += 864e5) {
    if (paused.has(dayKey(d))) continue;
    const dow = new Date(d).getUTCDay(), weekday = dow >= 1 && dow <= 5;
    for (const a of o.agents) {
      if (Date.parse(a.hiredAt) > d + 864e5 - 1) continue;
      const want = a.rhythm === "weekdays" ? (weekday ? 1 : 0) : a.rhythm === "daily" ? 1 : a.rhythm === "weekly" ? (dow === 1 ? 1 : 0)
        : a.rhythm === "monthly" ? (new Date(d).getUTCDate() === 2 ? 1 : 0) : a.rhythm === "on_event" ? (weekday ? 2 + Math.floor(r() * 3) : Math.floor(r() * 2)) : (r() < 0.33 ? 1 : 0);
      for (let i = 0; i < want; i++) {
        const at = d + (7 + ((i + r()) / Math.max(want, 1)) * 12) * 3600e3;
        if (at < start || at > end) continue;
        const mode = modeAt(a, at), big = r() < BIG_ODDS;
        const p = PROFILE[taskTypeOf({ template: a.template })];
        const x = (0.6 + r() * 0.8) * (big ? BIG_X : 1), req = Math.max(1, Math.round(p.requests * (0.7 + r() * 0.6) * (big ? 2 : 1)));
        const tokens = { input: Math.round(p.input * x * req), cacheRead: Math.round(p.read * x * req), cacheWrite: Math.round(p.write * x), output: Math.round(p.output * x * req) };
        const note = (RUN_NOTE[a.template] || ["Ran its usual job", "A long run"])[big ? 1 : 0];
        ev({ kind: "run", at, agent_id: a.id, run_id: `run_h${++n}`, mode, model: MODES[mode].model, credits: -creditsFor(MODES[mode].model, tokens, req), note,
          tokens_in: tokens.input, cache_read: tokens.cacheRead, cache_write: tokens.cacheWrite, tokens_out: tokens.output, requests: req, ok: r() > 0.03 });
      }
    }
  }
  events.sort((a, b) => a.sort - b.sort);
  const out: Entry[] = [];
  let period = "", plan_ = 0, topup = 0;
  for (const e of events) {
    if (e.period !== period) {
      if (period && Math.abs(plan_) >= 0.005) out.push({ kind: "plan_expiry", at: new Date(e.sort - 1000).toISOString(), period, credits: toLedger(-plan_), from_plan: toLedger(-plan_), from_topup: 0, note: "Unused plan credits lapse on the 1st", tokens_in: 0, cache_read: 0, cache_write: 0, tokens_out: 0, requests: 0 });
      period = e.period; plan_ = 0;
    }
    const { sort, ...x } = e;
    if (x.kind === "plan_grant") { plan_ += x.credits; out.push({ ...x, from_plan: x.credits }); continue; }
    if (x.kind === "topup") { topup += x.credits; out.push({ ...x, from_topup: x.credits }); continue; }
    if (Math.max(0, plan_) + Math.max(0, topup) <= 0) continue; // out of credits: the AI Team is paused
    const c = runCharge(-x.credits);
    const fromPlan = Math.min(c, Math.max(0, plan_)), fromTop = Math.min(c - fromPlan, Math.max(0, topup));
    plan_ -= c - fromTop; topup -= fromTop;
    out.push({ ...x, credits: -c, from_plan: toLedger(-(c - fromTop)), from_topup: toLedger(-fromTop) });
  }
  return out;
}
