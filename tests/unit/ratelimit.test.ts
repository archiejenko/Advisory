import { describe, it, expect } from "vitest";
import { searchCompanies, RateLimited } from "../../apps/api/src/lib/registers";

// Fake D1 whose counter is already at the limit for this five-minute window.
function envAt(count: number) {
  const DB = { prepare: () => ({ bind: () => ({ first: async () => ({ count }) }) }) };
  return { DB, CH_RATE_LIMIT: "600", CH_API_BASE: "http://unused", CH_API_KEY: "k" } as any;
}

describe("Companies House rate limiter", () => {
  it("stops before the limit, keeping 5% headroom for live checks", async () => {
    await expect(searchCompanies(envAt(571), "x")).rejects.toBeInstanceOf(RateLimited);
  });
  it("tells the job runner when the window resets", async () => {
    try { await searchCompanies(envAt(600), "x"); } catch (e: any) { expect(e.retryAfterSec).toBeGreaterThan(0); expect(e.retryAfterSec).toBeLessThanOrEqual(300); }
  });
});
