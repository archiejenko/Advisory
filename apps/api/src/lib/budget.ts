// The AI budget: what a business's agents may spend on the model in a month, by plan. Plan actions count tool
// calls; this caps the model calls themselves, which cost money whether or not a tool is used.
import { type Env, one } from "./db";
import { HttpError } from "./http";

/** Pence a month, by plan. MODEL_BUDGETS (JSON, e.g. {"trial":500}) overrides any of them per deployment. */
export const MODEL_BUDGET_PENCE: Record<string, number> = { trial: 500, pilot: 4000, starter: 1500, growth: 4000, scale: 10000 };

export function modelBudget(env: Env, plan?: string) {
  let override: Record<string, number> = {};
  try { override = JSON.parse(env.MODEL_BUDGETS || "{}"); } catch {}
  const p = plan || "trial";
  return Number(override[p] ?? MODEL_BUDGET_PENCE[p] ?? MODEL_BUDGET_PENCE.trial);
}

/**
 * Spent this month: model cost already on record (finished runs, swarm drafts, the command router), plus the
 * running total of runs still going, which aren't on record until they settle.
 */
export async function modelSpend(env: Env, orgId: string) {
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const r = await one<{ n: number }>(env, `SELECT
      (SELECT COALESCE(SUM(cost_pence), 0) FROM usage_event WHERE org_id = ? AND kind IN ('agent_run', 'swarm_plan', 'router') AND at >= ?)
    + (SELECT COALESCE(SUM(cost_pence), 0) FROM agent_run WHERE org_id = ? AND status = 'running') AS n`, orgId, month, orgId);
  return Number(r?.n || 0);
}

export const BUDGET_USED = "This month's AI budget for your plan is used. Agents start again on the 1st, or move to a bigger plan in Usage and plan.";

/** Null while there's budget left, else the reason to stop. */
export async function budgetProblem(env: Env, org: { id: string; plan?: string }) {
  return (await modelSpend(env, org.id)) >= modelBudget(env, org.plan) ? BUDGET_USED : null;
}

export async function requireBudget(env: Env, org: { id: string; plan?: string }) {
  const problem = await budgetProblem(env, org);
  if (problem) throw new HttpError(402, "budget_used", problem);
}
