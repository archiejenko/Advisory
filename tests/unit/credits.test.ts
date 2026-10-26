// The credit formula: 1 credit = 1p of model cost, priced from config/model-pricing.ts.
// credits = (uncached_in × in + cache_read × in × read_x + cache_write × in × write_x + out × out_rate) / 1e6 × usd_to_gbp × 100
import { describe, it, expect } from "vitest";
import { creditsFor, creditsForMode, runCharge, showCredits, toLedger, modeLabel, tokensOf } from "../../packages/core/credits";
import { MODES, MODELS, MODE_ORDER, USD_TO_GBP, CACHE_DEFAULTS, PLAN_CREDITS, TRIAL_CREDITS, TOPUP } from "../../config/model-pricing";
import { recommend, estimateRange, cheaperSuggestion, taskTypeOf } from "../../packages/core/modes";

const t = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });
/** The formula written out by hand, in USD per million, for checking each mode against. */
const byHand = (inRate: number, outRate: number, readX: number, tk: ReturnType<typeof t>) =>
  ((tk.input * inRate + tk.cacheRead * inRate * readX + tk.cacheWrite * inRate * 1.25 + tk.output * outRate) / 1e6) * (1 / 1.3) * 100;

describe("the credit formula, mode by mode", () => {
  const mixed = t(2000, 3000, 50_000, 10_000);

  it("Quick (Haiku 5.5): $0.10 in, $0.50 out, cache reads at 0.1x", () => {
    expect(creditsForMode("quick", t(10_000, 2000))).toBeCloseTo(0.1538, 4);
    expect(creditsForMode("quick", mixed)).toBeCloseTo(byHand(0.1, 0.5, 0.1, mixed), 10);
    expect(creditsForMode("quick", t(0, 0, 50_000))).toBeCloseTo(0.0385, 4); // 50k cache reads: $0.0005
    expect(creditsForMode("quick", t(0, 0, 0, 50_000))).toBeCloseTo(0.4808, 4); // 50k cache writes: $0.00625
  });

  it("Quick switches to the long-prompt rates when one request's prompt is over 100,000 tokens", () => {
    expect(creditsForMode("quick", t(120_000, 1000))).toBeCloseTo(((120_000 * 0.5 + 1000 * 2.5) / 1e6 / 1.3) * 100, 10);
    // Cache reads and writes count towards the prompt's length.
    expect(creditsForMode("quick", t(1000, 0, 99_500))).toBeCloseTo(((1000 * 0.5 + 99_500 * 0.5 * 0.1) / 1e6 / 1.3) * 100, 10);
    // Over several requests, the tier follows the average prompt per request: three 60k prompts aren't "long".
    expect(creditsForMode("quick", t(180_000, 0), 3)).toBeCloseTo(((180_000 * 0.1) / 1e6 / 1.3) * 100, 10);
  });

  it("Standard (Sonnet 5.5): $2 in, $10 out, cache reads at 0.05x, writes at 1.25x", () => {
    expect(creditsForMode("standard", mixed)).toBeCloseTo(4.9231, 4);
    expect(creditsForMode("standard", mixed)).toBeCloseTo(byHand(2, 10, 0.05, mixed), 10);
  });

  it("Deep (Opus 5.5): $4 in, $20 out, cache reads at 0.05x", () => {
    expect(creditsForMode("deep", mixed)).toBeCloseTo(9.8462, 4);
    expect(creditsForMode("deep", mixed)).toBeCloseTo(byHand(4, 20, 0.05, mixed), 10);
  });

  it("Strategy (Fable 5.1): $10 in, $50 out, cache reads at 0.025x", () => {
    expect(creditsForMode("strategy", mixed)).toBeCloseTo(23.6538, 4);
    expect(creditsForMode("strategy", mixed)).toBeCloseTo(byHand(10, 50, 0.025, mixed), 10);
  });

  it("a cache write costs 1.25x the input rate and a cache read its model's multiplier", () => {
    for (const k of MODE_ORDER) {
      const m = MODELS[MODES[k].model];
      const plain = creditsForMode(k, t(1_000_000, 0));
      expect(creditsForMode(k, t(0, 0, 0, 1_000_000)) / plain).toBeCloseTo(1.25, 10);
      expect(creditsForMode(k, t(0, 0, 1_000_000, 0)) / plain).toBeCloseTo(m.cache?.read ?? CACHE_DEFAULTS.read, 10);
    }
  });

  it("reads tokens from the Messages API's usage, with cache tokens kept apart from uncached input", () => {
    expect(tokensOf({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 })).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
    expect(tokensOf(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("refuses a model with no rate rather than charging nothing", () => {
    expect(() => creditsFor("some-unknown-model", t(1, 1))).toThrow(/model-pricing/);
  });
});

describe("rounding and the per-run minimum", () => {
  it("the ledger keeps 2dp; people see whole credits", () => {
    expect(toLedger(4.92307)).toBe(4.92);
    expect(toLedger(23.655)).toBe(23.66);
    expect(showCredits(4.92)).toBe(5);
    expect(showCredits(1234.4)).toBe(1234);
  });

  it("a run is charged and shown as at least 1 credit, however cheap", () => {
    const quick = creditsForMode("quick", t(10_000, 2000)); // about 0.15
    expect(quick).toBeLessThan(1);
    expect(runCharge(quick)).toBe(1);
    expect(showCredits(quick, { run: true })).toBe(1);
    expect(showCredits(0.4)).toBe(0); // a total isn't a run
    expect(runCharge(creditsForMode("deep", t(2000, 3000, 50_000, 10_000)))).toBe(9.85);
  });

  it("labels a mode with its model underneath", () => {
    expect(modeLabel("deep")).toBe("Deep · Opus");
    expect(modeLabel("quick")).toBe("Quick · Haiku");
  });
});

describe("the pricing config", () => {
  it("every mode runs on a model with positive rates, and the money is in pounds", () => {
    expect(USD_TO_GBP).toBeCloseTo(1 / 1.3, 12);
    for (const k of MODE_ORDER) {
      const m = MODELS[MODES[k].model];
      expect(m, k).toBeTruthy();
      expect(m.in).toBeGreaterThan(0);
      expect(m.out).toBeGreaterThan(m.in);
      expect(MODES[k].typical[0]).toBeLessThanOrEqual(MODES[k].typical[1]);
    }
    expect(MODE_ORDER.map((k) => MODES[k].model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]);
  });

  it("plans, the trial and top-ups", () => {
    expect(PLAN_CREDITS).toMatchObject({ starter: 1500, growth: 5000, scale: 12000 });
    expect(TRIAL_CREDITS).toBe(150);
    expect(TOPUP).toEqual({ credits: 1000, pence: 3500 });
  });
});

describe("recommending a mode", () => {
  it("suggests the cheapest mode that suits the job, with a reason and a likely range", () => {
    expect(recommend({ template: "inbox" })).toMatchObject({ mode: "quick", low: 1, high: 1, from: "defaults" });
    expect(recommend({ template: "outreach" }).mode).toBe("standard");
    expect(recommend({ template: "research" }).mode).toBe("deep");
    expect(recommend({ template: "custom", text: "Write our five-year growth strategy for the board" })).toMatchObject({ mode: "strategy", low: 80, high: 340 });
    expect(recommend({ template: "custom", text: "Tag and sort incoming supplier emails" }).mode).toBe("quick");
    expect(recommend({ template: "inbox" }).reason).toMatch(/\w/);
    expect(taskTypeOf({ template: "custom", text: "" })).toBe("drafting");
  });

  it("estimates from past runs once there are enough, repriced on the mode asked about", () => {
    const past = Array.from({ length: 10 }, (_, i) => ({ tokens: t(20_000 + i * 2000, 1500 + i * 100, 40_000, 5000), requests: 4 }));
    const deep = estimateRange("deep", past), quick = estimateRange("quick", past);
    expect(deep.from).toBe("history");
    expect(deep.low).toBeGreaterThanOrEqual(1);
    expect(deep.high).toBeGreaterThan(quick.high);
    expect(quick).toMatchObject({ low: 1, high: 1 });
    expect(estimateRange("deep", past.slice(0, 4))).toEqual({ low: 8, high: 33, from: "defaults" });
  });

  it("suggests a cheaper mode when an agent's job would likely be done well there", () => {
    const runs = Array.from({ length: 30 }, () => ({ tokens: t(60_000, 6000, 200_000, 20_000), requests: 6, charged: 0, ok: true }));
    for (const r of runs) r.charged = runCharge(creditsForMode("deep", r.tokens, r.requests));
    const s = cheaperSuggestion({ name: "Inbox agent", mode: "deep", template: "inbox" }, runs)!;
    expect(s.mode).toBe("quick");
    expect(s.saving).toBeGreaterThan(500);
    expect(s.text).toMatch(/^Inbox agent runs on Deep; Quick would likely do the job and save ~[\d,]+ credits/);
    // Not when it's already on the right mode, or when its runs are failing.
    expect(cheaperSuggestion({ name: "Inbox", mode: "quick", template: "inbox" }, runs)).toBeNull();
    expect(cheaperSuggestion({ name: "Inbox", mode: "deep", template: "inbox" }, runs.map((r, i) => ({ ...r, ok: i % 2 === 0 })))).toBeNull();
  });
});
