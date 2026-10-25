// Credits from tokens. 1 credit = 1p of model cost, priced from config/model-pricing.ts and nowhere else:
// credits = (uncached_in × in + cache_read × in × read_x + cache_write × in × write_x + out × out_rate) / 1e6 × usd_to_gbp × 100
import { MODELS, MODES, CACHE_DEFAULTS, USD_TO_GBP, MIN_CREDITS_PER_RUN, type ModeKey, type ModelRate } from "../../config/model-pricing";

export type Tokens = { input: number; cacheRead: number; cacheWrite: number; output: number };
export const noTokens = (): Tokens => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });

export function rateFor(model: string): ModelRate {
  const r = MODELS[model];
  if (!r) throw new Error(`No rate for model ${model}: add it to config/model-pricing.ts`);
  return r;
}

/** Tokens from a Messages API `usage` object. */
export const tokensOf = (u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): Tokens =>
  ({ input: u?.input_tokens || 0, cacheRead: u?.cache_read_input_tokens || 0, cacheWrite: u?.cache_creation_input_tokens || 0, output: u?.output_tokens || 0 });

export const addTokens = (a: Tokens, b: Tokens): Tokens => ({ input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output });

/**
 * Unrounded credits for tokens on a model. Price each request on its own when a model has prompt-length tiers;
 * for totals over several requests pass `requests`, and the tier is chosen from the average prompt per request.
 */
export function creditsFor(model: string, t: Tokens, requests = 1): number {
  const r = rateFor(model);
  const prompt = (t.input + t.cacheRead + t.cacheWrite) / Math.max(1, requests);
  const tier = (r.tiers || []).filter((x) => prompt > x.promptOver).sort((a, b) => b.promptOver - a.promptOver)[0];
  const inRate = tier?.in ?? r.in, outRate = tier?.out ?? r.out;
  const readX = r.cache?.read ?? CACHE_DEFAULTS.read, writeX = r.cache?.write ?? CACHE_DEFAULTS.write;
  const usd = (t.input * inRate + t.cacheRead * inRate * readX + t.cacheWrite * inRate * writeX + t.output * outRate) / 1e6;
  return usd * USD_TO_GBP * 100;
}

export const creditsForMode = (mode: ModeKey, t: Tokens, requests = 1) => creditsFor(MODES[mode].model, t, requests);

/** What the ledger stores: 2dp. */
export const toLedger = (x: number) => Math.round(x * 100) / 100;
/** What a run is charged: its cost at 2dp, and never less than the per-run minimum. */
export const runCharge = (x: number) => toLedger(Math.max(MIN_CREDITS_PER_RUN, x));
/** What people see: whole credits. A single run never shows less than the minimum. */
export const showCredits = (x: number, opts: { run?: boolean } = {}) => (opts.run ? Math.max(MIN_CREDITS_PER_RUN, Math.round(x)) : Math.round(x));

export const modeName = (k: string) => MODES[k as ModeKey]?.name ?? k;
/** "Deep · Opus". */
export const modeLabel = (k: string) => { const m = MODES[k as ModeKey]; return m ? `${m.name} · ${MODELS[m.model].label}` : k; };
export const isMode = (k: unknown): k is ModeKey => typeof k === "string" && k in MODES;
