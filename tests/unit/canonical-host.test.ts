// The apex is attached to the Worker too and must land on www with path and query intact; nothing else moves.
import { describe, it, expect } from "vitest";
import worker from "../../apps/api/src/index";

const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
const env = { CANONICAL_HOST: "www.ejtech.co.uk", ASSETS: { fetch: async () => new Response("<html>site</html>") } } as any;
const go = (url: string, e = env) => worker.fetch(new Request(url), e, ctx);

describe("canonical host", () => {
  it("sends the apex to www with a 301, keeping path and query", async () => {
    const r = await go("http://ejtech.co.uk/pricing?plan=team");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://www.ejtech.co.uk/pricing?plan=team");
  });
  it("redirects API paths on the apex too", async () => {
    const r = await go("https://ejtech.co.uk/api/health");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://www.ejtech.co.uk/api/health");
  });
  it("serves www and other hosts as normal", async () => {
    expect((await go("https://www.ejtech.co.uk/api/health")).status).toBe(200);
    expect((await go("https://agent-house.someone.workers.dev/")).status).toBe(200);
    expect((await go("https://ejtech.co.uk/api/health", { ...env, CANONICAL_HOST: "" })).status).toBe(200);
  });
});

import { testEnv } from "./d1";
describe("pay-per-call without a wallet", () => {
  const call = (env: any) => worker.fetch(new Request("https://www.ejtech.co.uk/v1/tools/read-page", { method: "POST", body: JSON.stringify({ url: "https://example.com" }) }), env, ctx);
  it("answers 402 x402_off with no payment header, and the catalogue hides x402", async () => {
    const { env } = testEnv({ X402_PAY_TO: "" });
    const r = await call(env);
    expect(r.status).toBe(402);
    expect(r.headers.get("payment-required")).toBeNull();
    expect((await r.json() as any).error.code).toBe("x402_off");
    const cat = await (await worker.fetch(new Request("https://www.ejtech.co.uk/v1/tools"), env, ctx)).json() as any;
    expect(cat.payment.x402).toBeNull();
  });
  it("asks for payment once a wallet is set", async () => {
    const { env } = testEnv({ X402_PAY_TO: "0x000000000000000000000000000000000000dEaD" });
    const r = await call(env);
    expect(r.status).toBe(402);
    expect(r.headers.get("payment-required")).toBeTruthy();
  });
});
