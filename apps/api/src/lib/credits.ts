// The credit ledger. Every grant, reset, top-up and run is an entry; balances are sums over entries.
// Plan credits belong to a month (UK time) and lapse on the 1st; top-up credits (and the trial's) roll over.
// Use draws on plan credits first, then top-up credits.
import { newId, nowIso } from "../../../../packages/core/util";
import { PLAN_CREDITS, TRIAL_CREDITS, TOPUP, MODES, type ModeKey } from "../../../../config/model-pricing";
import { toLedger, runCharge, creditsFor, type Tokens } from "../../../../packages/core/credits";
import { type Env, one, all, run, audit } from "./db";
import { HttpError } from "./http";
import { notifyChannel } from "./delivery";

/* ---------- Periods ---------- */
const ukParts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
/** The credit month a moment falls in, in UK time: "2026-10". */
export const periodOf = (d = new Date()) => { const p = ukParts(d); return `${p.year}-${p.month}`; };
export const nextPeriod = (p: string) => { const [y, m] = p.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
/** When plan credits next reset: midnight UK time on the 1st of next month, as an ISO date (YYYY-MM-01). */
export const resetDate = (d = new Date()) => nextPeriod(periodOf(d)) + "-01";
/** How much of the current month is left, 0..1, for prorating mid-month plan starts and upgrades. */
export function monthLeft(d = new Date()) {
  const p = ukParts(d), y = Number(p.year), m = Number(p.month);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return (days - Number(p.day) + 1) / days;
}

/* ---------- Grants and resets ---------- */
const insertEntry = (env: Env, e: { org: string; kind: string; credits: number; plan: number; topup: number; period: string; ref: string; note?: string; at?: string }) =>
  run(env, `INSERT INTO credit_entry (id, org_id, kind, credits, from_plan, from_topup, period, ref, note, at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id, kind, ref) DO NOTHING`,
    newId("cr"), e.org, e.kind, toLedger(e.credits), toLedger(e.plan), toLedger(e.topup), e.period, e.ref, e.note ?? null, e.at ?? nowIso());

/**
 * Bring a business's ledger up to the current month. Safe to call any time and as often as you like: every entry
 * is unique by (kind, ref). Lapses plan credits left from earlier months, applies a downgrade waiting for the 1st,
 * and grants this month's plan credits. A trial gets its one grant, as rolling credits, once.
 */
export async function ensurePeriod(env: Env, orgId: string, now = new Date()) {
  const org = await one<any>(env, "SELECT id, plan, pending_plan, cancelled_at, purged_at FROM org WHERE id = ?", orgId);
  if (!org || org.purged_at) return;
  const period = periodOf(now);
  if (org.plan === "trial") {
    await insertEntry(env, { org: orgId, kind: "trial_grant", credits: TRIAL_CREDITS, plan: 0, topup: TRIAL_CREDITS, period, ref: "trial", note: "Free trial" });
    return;
  }
  // Plan credits left over (or overdrawn by a run's last step) in an earlier month go back to zero.
  const old = await all<any>(env, "SELECT period, SUM(from_plan) AS left FROM credit_entry WHERE org_id = ? AND period < ? GROUP BY period HAVING ABS(SUM(from_plan)) >= 0.005", orgId, period);
  for (const o of old) await insertEntry(env, { org: orgId, kind: "plan_expiry", credits: -o.left, plan: -o.left, topup: 0, period: o.period, ref: o.period, note: o.left > 0 ? "Unused plan credits lapse on the 1st" : "Overdraft forgiven" });
  if (org.cancelled_at) return;
  let plan = org.plan;
  // A downgrade takes effect at the reset, before the new month's credits are granted.
  if (org.pending_plan && !(await one(env, "SELECT 1 AS x FROM credit_entry WHERE org_id = ? AND kind = 'plan_grant' AND ref = ?", orgId, period))) {
    plan = org.pending_plan;
    await run(env, "UPDATE org SET plan = ?, pending_plan = NULL WHERE id = ?", plan, orgId);
    await audit(env, orgId, "billing", "plan_downgraded", plan);
  }
  const credits = PLAN_CREDITS[plan];
  if (credits) await insertEntry(env, { org: orgId, kind: "plan_grant", credits, plan: credits, topup: 0, period, ref: period, note: `${plan} plan credits` });
}

/** This month's plan credits for a plan that starts part-way through the month: prorated, like its first invoice. */
export async function grantPlanStart(env: Env, orgId: string, plan: string, now = new Date()) {
  const credits = Math.round((PLAN_CREDITS[plan] || 0) * monthLeft(now));
  const period = periodOf(now);
  await insertEntry(env, { org: orgId, kind: "plan_grant", credits, plan: credits, topup: 0, period, ref: period, note: `${plan} plan credits (from today to the 1st)` });
}

/** An upgrade mid-month: the extra monthly credits, prorated to the rest of the month (as the charge is). */
export async function grantUpgrade(env: Env, orgId: string, from: string, to: string, ref: string, now = new Date()) {
  const extra = Math.round(((PLAN_CREDITS[to] || 0) - (PLAN_CREDITS[from] || 0)) * monthLeft(now));
  if (extra <= 0) return 0;
  await insertEntry(env, { org: orgId, kind: "upgrade_grant", credits: extra, plan: extra, topup: 0, period: periodOf(now), ref, note: `Upgrade from ${from} to ${to}` });
  return extra;
}

/** A paid top-up. Idempotent by the payment's id, so a replayed webhook adds nothing. */
export async function grantTopup(env: Env, orgId: string, ref: string, credits = TOPUP.credits, now = new Date()) {
  const r = await insertEntry(env, { org: orgId, kind: "topup", credits, plan: 0, topup: credits, period: periodOf(now), ref, note: `${credits.toLocaleString("en-GB")} credits top-up` });
  if (r.meta.changes) {
    // Running out again later this month is worth another notice.
    await run(env, "UPDATE org SET credits_out_notified = NULL WHERE id = ?", orgId);
    await audit(env, orgId, "billing", "credits_topped_up", ref, { credits });
  }
  return !!r.meta.changes;
}

/* ---------- Balances ---------- */
export type Balance = { plan: number; topup: number; total: number; period: string; reset_on: string };

export async function balance(env: Env, orgId: string, now = new Date()): Promise<Balance> {
  await ensurePeriod(env, orgId, now);
  const period = periodOf(now);
  const r = await one<any>(env, `SELECT
      (SELECT COALESCE(SUM(from_plan), 0) FROM credit_entry WHERE org_id = ?1 AND period = ?2) AS plan,
      (SELECT COALESCE(SUM(from_topup), 0) FROM credit_entry WHERE org_id = ?1) AS topup`, orgId, period);
  const plan = toLedger(r?.plan || 0), topup = toLedger(r?.topup || 0);
  return { plan, topup, total: toLedger(Math.max(0, plan) + Math.max(0, topup)), period, reset_on: resetDate(now) };
}

/** Credits still being used by runs in progress, which aren't on the ledger until they finish. */
async function inFlight(env: Env, where: "org" | "agent", id: string, exceptRun?: string) {
  const r = where === "org"
    ? await one<any>(env, "SELECT COALESCE(SUM(credits), 0) AS n FROM agent_run WHERE org_id = ? AND status = 'running' AND id != ?", id, exceptRun || "")
    : await one<any>(env, "SELECT COALESCE(SUM(credits), 0) AS n FROM agent_run WHERE agent_id = ? AND status = 'running' AND id != ?", id, exceptRun || "");
  return Number(r?.n || 0);
}

/** What the business can still spend: its balance less what runs in progress have used so far. */
export async function available(env: Env, orgId: string, exceptRun?: string) {
  return toLedger((await balance(env, orgId)).total - (await inFlight(env, "org", orgId, exceptRun)));
}

/** Credits an agent has used this month, including a run in progress. */
export async function agentUsed(env: Env, agentId: string, now = new Date()) {
  const r = await one<any>(env, "SELECT COALESCE(-SUM(credits), 0) AS n FROM credit_entry WHERE agent_id = ? AND kind = 'run' AND period = ?", agentId, periodOf(now));
  return toLedger(Number(r?.n || 0) + (await inFlight(env, "agent", agentId)));
}

/* ---------- Spending ---------- */
export type Spend = { orgId: string; credits: number; cost: number; tokens: Tokens; requests: number; model: string; mode?: string | null; agentId?: string | null; runId?: string | null; taskType?: string | null; note?: string; kind: "run" | "system"; ref: string };

/**
 * Put use on the ledger, split between plan and top-up credits in one statement so concurrent writes can't both
 * take the same plan credits. Idempotent by ref (a run id), so a retried settle or a sweep can't charge twice.
 */
export async function spend(env: Env, s: Spend, now = new Date()) {
  await ensurePeriod(env, s.orgId, now);
  const period = periodOf(now), c = toLedger(s.credits);
  const r = await run(env, `INSERT INTO credit_entry (id, org_id, kind, credits, from_plan, from_topup, period, agent_id, run_id, mode, model, task_type, tokens_in, cache_read, cache_write, tokens_out, requests, cost, ref, note, at)
    SELECT ?1, ?2, ?3, -?4, -MIN(?4, MAX(p, 0)), -(?4 - MIN(?4, MAX(p, 0))), ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
    FROM (SELECT COALESCE(SUM(from_plan), 0) AS p FROM credit_entry WHERE org_id = ?2 AND period = ?5) WHERE true -- (SQLite needs a WHERE before an upsert's ON CONFLICT)
    ON CONFLICT(org_id, kind, ref) DO NOTHING`,
    newId("cr"), s.orgId, s.kind, c, period, s.agentId ?? null, s.runId ?? null, s.mode ?? null, s.model, s.taskType ?? null,
    s.tokens.input, s.tokens.cacheRead, s.tokens.cacheWrite, s.tokens.output, s.requests, s.cost, s.ref, s.note ?? null, now.toISOString());
  if (r.meta.changes) await afterSpend(env, s.orgId, s.agentId ?? null, now);
  return !!r.meta.changes;
}

/** Charge a finished (or stopped) run: its cost at 2dp, never below the per-run minimum. */
export const chargeRun = (env: Env, s: Omit<Spend, "kind" | "credits" | "ref"> & { runId: string }, now = new Date()) =>
  spend(env, { ...s, kind: "run", credits: runCharge(s.cost), ref: s.runId }, now);

/** An AI Team (system) call: the command router, a swarm draft, learning a house rule. No per-run minimum. */
export async function chargeSystem(env: Env, orgId: string, model: string, tokens: Tokens, requests: number, note: string, now = new Date()) {
  const cost = creditsFor(model, tokens, requests);
  if (!cost) return;
  await spend(env, { orgId, kind: "system", credits: cost, cost, tokens, requests, model, ref: newId("sys"), note }, now);
}

/* ---------- Pausing ---------- */
export const CREDITS_USED = "Your AI Team has used this month's credits. Top up in Usage to carry on now, or it starts again on the 1st. Nothing is charged without your say-so.";
export const agentBudgetUsed = (name: string) => `${name} has reached its monthly credit budget, so it's paused until the 1st. Raise or remove its budget in its settings to carry on now.`;

/** Null while the business has credits, else why the AI Team is paused. */
export async function creditsProblem(env: Env, orgId: string, exceptRun?: string) {
  return (await available(env, orgId, exceptRun)) <= 0 ? CREDITS_USED : null;
}

export async function requireCredits(env: Env, orgId: string) {
  const p = await creditsProblem(env, orgId);
  if (p) throw new HttpError(402, "credits_used", p, { top_up: { credits: TOPUP.credits, pence: TOPUP.pence } });
}

/** Null while an agent is within its own monthly budget (or has none), else why it's paused. */
export async function agentBudgetProblem(env: Env, agent: { id: string; name: string; monthly_budget?: number | null; budget_paused_period?: string | null }, now = new Date()) {
  if (agent.monthly_budget == null) return null;
  return (await agentUsed(env, agent.id, now)) >= agent.monthly_budget ? agentBudgetUsed(agent.name) : null;
}

/** After use: pause an agent that reached its budget, and tell the owner once a month when credits run out. */
async function afterSpend(env: Env, orgId: string, agentId: string | null, now: Date) {
  const period = periodOf(now);
  if (agentId) {
    const a = await one<any>(env, "SELECT id, name, monthly_budget, budget_paused_period, channel_id FROM agent WHERE id = ?", agentId);
    if (a && a.monthly_budget != null && a.budget_paused_period !== period && (await agentUsed(env, a.id, now)) >= a.monthly_budget) {
      const r = await run(env, "UPDATE agent SET budget_paused_period = ? WHERE id = ? AND (budget_paused_period IS NULL OR budget_paused_period != ?)", period, a.id, period);
      if (r.meta.changes) {
        await notifyChannel(env, orgId, a.channel_id, `${a.name} paused: monthly budget reached`, `${agentBudgetUsed(a.name)}\n\nOnly ${a.name} is paused; the rest of your AI Team carries on.\n${env.APP_URL}#/workspace/usage`);
        await audit(env, orgId, "credits", "agent_budget_reached", a.id, { budget: a.monthly_budget });
      }
    }
  }
  if ((await balance(env, orgId, now)).total <= 0) {
    const r = await run(env, "UPDATE org SET credits_out_notified = ? WHERE id = ? AND (credits_out_notified IS NULL OR credits_out_notified != ?)", period, orgId, period);
    if (r.meta.changes) {
      await notifyChannel(env, orgId, null, "Your AI Team has paused: credits used", `${CREDITS_USED}\n\nTop up ${TOPUP.credits.toLocaleString("en-GB")} credits for £${(TOPUP.pence / 100).toFixed(0)}: ${env.APP_URL}#/workspace/usage`);
      await audit(env, orgId, "credits", "credits_used", period);
    }
  }
}

/** An agent's budget changed: if it now has room (or no cap), it carries on this month. */
export async function clearBudgetPause(env: Env, agentId: string) {
  const a = await one<any>(env, "SELECT id, name, monthly_budget FROM agent WHERE id = ?", agentId);
  if (!a) return;
  if (a.monthly_budget == null || (await agentUsed(env, a.id)) < a.monthly_budget) await run(env, "UPDATE agent SET budget_paused_period = NULL WHERE id = ?", a.id);
}

/* ---------- Estimates ---------- */
/** The last runs of a kind of job, as tokens, so they can be priced on any mode. This business first, then everyone's. */
export async function pastRuns(env: Env, orgId: string, taskType: string, limit = 20) {
  const q = (own: boolean) => all<any>(env, `SELECT tokens_in, cache_read, cache_write, tokens_out, requests FROM credit_entry WHERE kind = 'run' AND task_type = ? ${own ? "AND org_id = ?" : ""} AND requests > 0 ORDER BY at DESC LIMIT ?`, ...(own ? [taskType, orgId, limit] : [taskType, limit]));
  let rows = await q(true);
  if (rows.length < 5) rows = await q(false);
  return rows.map((r) => ({ tokens: { input: r.tokens_in, cacheRead: r.cache_read, cacheWrite: r.cache_write, output: r.tokens_out }, requests: r.requests }));
}

export const modeModel = (mode: string) => MODES[(mode in MODES ? mode : "standard") as ModeKey].model;
