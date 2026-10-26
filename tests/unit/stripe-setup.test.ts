// The Stripe setup script can't import the TypeScript config, so it states the prices itself. This keeps the two in
// step: a price changed in one place and not the other fails here before anything is created in Stripe.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLANS } from "../../packages/core/templates";
import { TOPUP } from "../../config/model-pricing";

const src = readFileSync(fileURLToPath(new URL("../../scripts/stripe-setup.mjs", import.meta.url)), "utf8");

describe("scripts/stripe-setup.mjs", () => {
  it("creates each plan at the price and credits the website shows", () => {
    for (const k of ["starter", "growth", "scale"]) {
      const m = src.match(new RegExp(`plan: "${k}", name: "([^"]+)", pence: (\\d+), credits: (\\d+)`));
      expect(m, k).toBeTruthy();
      expect({ name: m![1], pence: Number(m![2]), credits: Number(m![3]) }).toEqual({ name: PLANS[k].name, pence: PLANS[k].price! * 100, credits: PLANS[k].credits });
    }
  });
  it("creates the top-up at £35 for 1,000 credits, and refuses a live key unless asked", () => {
    expect(src).toMatch(new RegExp(`TOPUP = \\{ name: "[^"]+", pence: ${TOPUP.pence}, credits: ${TOPUP.credits},`));
    expect(src).toMatch(/sk_live_.*ALLOW_LIVE !== "1"/);
    expect(src).toMatch(/tax_behavior: "exclusive"/);
  });
});
