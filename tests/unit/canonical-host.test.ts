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
