// Keys bound from Cloudflare Secrets Store reach the code as plain strings, like Worker secrets.
import { describe, it, expect, beforeEach } from "vitest";
import { withStoreSecrets, resetStoreSecrets } from "../../apps/api/src/lib/storesecrets";

const store = (v: string | Error) => { let n = 0; return { calls: () => n, get: async () => { n++; if (v instanceof Error) throw v; return v; } }; };

describe("Secrets Store keys", () => {
  beforeEach(resetStoreSecrets);
  it("leaves env alone when nothing is bound", async () => {
    const env = { ANTHROPIC_API_KEY: "sk-plain" } as any;
    expect(await withStoreSecrets(env)).toBe(env);
  });
  it("swaps bindings for their values, keeps other bindings, and reads once", async () => {
    const a = store("sk-ant-1"), kv = { get: async () => "kv value" };
    const env = { ANTHROPIC_API_KEY: a, SEARCH_API_KEY: "plain", CACHE: kv } as any;
    const e1 = await withStoreSecrets(env), e2 = await withStoreSecrets(env);
    expect(e1.ANTHROPIC_API_KEY).toBe("sk-ant-1");
    expect(e1.SEARCH_API_KEY).toBe("plain");
    expect(e1.CACHE).toBe(kv);
    expect(e2.ANTHROPIC_API_KEY).toBe("sk-ant-1");
    expect(a.calls()).toBe(1);
  });
  it("retries a failed read on the next call", async () => {
    const bad = store(new Error("scope")), env = { MAIL_HTTP_KEY: bad } as any;
    expect((await withStoreSecrets(env)).MAIL_HTTP_KEY).toBeUndefined();
    await withStoreSecrets(env);
    expect(bad.calls()).toBe(2);
  });
});
