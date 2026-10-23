// The Companies House budget, split into lanes, against the real SQL.
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv } from "./d1";
import { searchCompanies, RateLimited, withLane, LANE_SHARE } from "../../apps/api/src/lib/registers";

const slot = () => "ch:" + Math.floor(Date.now() / 300000);
function envAt(count: number) {
  const { raw, env } = testEnv({ CH_RATE_LIMIT: "600", CH_API_BASE: "https://ch.test", CH_API_KEY: "k" });
  if (count) raw.prepare("INSERT INTO rate_window (bucket, count) VALUES (?, ?)").run(slot(), count);
  const used = () => (raw.prepare("SELECT count FROM rate_window WHERE bucket = ?").get(slot()) as any)?.count ?? 0;
  return { env, used };
}
afterEach(() => vi.restoreAllMocks());
const ok = () => vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));

describe("Companies House budget", () => {
  it("gives bulk work 60% of a window, alerts 85% and live checks the rest", () => {
    expect(LANE_SHARE).toEqual({ bulk: 0.6, alert: 0.85, live: 0.97 });
  });
  it("stops bulk work at its share, while alerts and live checks still go through", async () => {
    ok();
    const { env, used } = envAt(360);
    await expect(searchCompanies(withLane(env, "bulk"), "x")).rejects.toBeInstanceOf(RateLimited);
    expect(used()).toBe(360); // a refused call doesn't use up the window
    await searchCompanies(withLane(env, "alert"), "x");
    await searchCompanies(env, "x"); // live is the default lane
    expect(used()).toBe(362);
  });
  it("keeps the last 3% of the window spare, even for live checks", async () => {
    ok();
    const { env } = envAt(582);
    await expect(searchCompanies(env, "x")).rejects.toBeInstanceOf(RateLimited);
  });
  it("tells the job runner when the window resets", async () => {
    const { env } = envAt(600);
    const e: any = await searchCompanies(withLane(env, "bulk"), "x").catch((x) => x);
    expect(e).toBeInstanceOf(RateLimited);
    expect(e.retryAfterSec).toBeGreaterThan(0);
    expect(e.retryAfterSec).toBeLessThanOrEqual(300);
  });
});
