// Where a month's credits went, from its ledger entries. One source for the Usage page's API and the demo.
import { MODES, MODELS, MODE_ORDER, PLAN_CREDITS, TOPUP, CONFIRM_OVER_DEFAULT, type ModeKey } from "../../config/model-pricing";
import { showCredits, modeLabel, isMode, toLedger } from "./credits";
import { cheaperSuggestion } from "./modes";

export type Entry = {
  kind: string; at: string; credits: number; from_plan: number; from_topup: number; period: string;
  agent_id?: string | null; run_id?: string | null; mode?: string | null; model?: string | null; note?: string | null;
  tokens_in: number; cache_read: number; cache_write: number; tokens_out: number; requests: number;
  /** For runs: whether the run went through (failed runs make a cheaper mode a riskier suggestion). */
  ok?: boolean;
};
export type UsageAgent = { id: string; name: string; template: string; mode: string; role?: string | null; instructions?: string | null; monthly_budget?: number | null; budget_paused_period?: string | null };

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

/** The month's credits for the Usage page. `month` entries are that month's; `balance` is now. */
export function summariseCredits(o: {
  month: string; period: string; plan: string; entries: Entry[]; agents: UsageAgent[];
  balance: { plan: number; topup: number; total: number; available: number }; reset_on: string;
  pending_plan?: string | null; confirm_over?: number | null; topup_available: boolean; planCredits?: number;
}) {
  const runs = o.entries.filter((e) => e.kind === "run"), system = o.entries.filter((e) => e.kind === "system");
  const used = -sum([...runs, ...system].map((e) => e.credits));
  const suggestions = o.agents.flatMap((a) => {
    if (!isMode(a.mode)) return [];
    const mine = runs.filter((r) => r.agent_id === a.id).map((r) => ({ charged: -r.credits, ok: r.ok !== false, requests: r.requests,
      tokens: { input: r.tokens_in, cacheRead: r.cache_read, cacheWrite: r.cache_write, output: r.tokens_out } }));
    const s = cheaperSuggestion({ ...a, mode: a.mode as ModeKey }, mine);
    return s ? [{ agent_id: a.id, agent: a.name, from: a.mode, ...s }] : [];
  });
  const byAgent = o.agents.map((a) => {
    const mine = runs.filter((r) => r.agent_id === a.id);
    return { id: a.id, name: a.name, mode: a.mode, mode_label: modeLabel(a.mode), credits: showCredits(-sum(mine.map((r) => r.credits))), runs: mine.length,
      budget: a.monthly_budget ?? null, budget_paused: a.budget_paused_period === o.period && o.month === o.period };
  }).sort((x, y) => y.credits - x.credits || x.name.localeCompare(y.name));
  return {
    period: o.month, current: o.month === o.period,
    balance: { plan: showCredits(Math.max(0, o.balance.plan)), topup: showCredits(Math.max(0, o.balance.topup)), total: showCredits(o.balance.total), available: showCredits(Math.max(0, o.balance.available)) },
    reset_on: o.reset_on, plan_credits: o.planCredits ?? PLAN_CREDITS[o.plan] ?? 0, used: showCredits(used),
    paused: o.balance.total <= 0, pending_plan: o.pending_plan ?? null, confirm_over: o.confirm_over ?? CONFIRM_OVER_DEFAULT,
    topup: { credits: TOPUP.credits, pence: TOPUP.pence, available: o.topup_available },
    by_agent: byAgent,
    by_mode: MODE_ORDER.map((k) => {
      const mine = runs.filter((r) => r.mode === k);
      return { mode: k, name: MODES[k].name, model: MODELS[MODES[k].model].label, runs: mine.length, credits: showCredits(-sum(mine.map((r) => r.credits))) };
    }),
    system: { calls: system.length, credits: showCredits(-sum(system.map((e) => e.credits))) },
    entries: [...o.entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200).map((e) => ({
      kind: e.kind, at: e.at, mode: e.mode ?? null, model: e.model ?? null, note: e.note ?? null, run_id: e.run_id ?? null,
      agent: o.agents.find((a) => a.id === e.agent_id)?.name ?? null,
      tokens_in: e.tokens_in, cache_read: e.cache_read, cache_write: e.cache_write, tokens_out: e.tokens_out,
      credits: e.kind === "run" ? -showCredits(-e.credits, { run: true }) : showCredits(e.credits), credits_exact: e.credits,
      mode_label: e.mode ? modeLabel(e.mode) : null,
    })),
    suggestions,
  };
}

/** A balance from entries, by the ledger's rules: this month's plan credits, and every top-up ever. */
export function balanceOf(entries: Pick<Entry, "period" | "from_plan" | "from_topup">[], period: string) {
  const plan = toLedger(sum(entries.filter((e) => e.period === period).map((e) => e.from_plan)));
  const topup = toLedger(sum(entries.map((e) => e.from_topup)));
  return { plan, topup, total: Math.max(0, plan) + Math.max(0, topup) };
}
