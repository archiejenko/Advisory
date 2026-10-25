// Hardening batch 3. Each test failed before its fix (see docs/architecture-review.md).
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv, seedOrg } from "./d1";
import worker from "../../apps/api/src/index";

afterEach(() => vi.restoreAllMocks());
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const call = (env: any, path: string, init: RequestInit = {}) => worker.fetch(new Request("https://ah.test" + path, init), env, { waitUntil() {}, passThroughOnException() {} } as any);

/* ---------- D5: a deal can't point at another business's contact ---------- */
import { saveDeal } from "../../apps/api/src/lib/crm";
describe("D5 deal references", () => {
  it("refuses a contact id from another business", async () => {
    const { raw, env } = testEnv();
    seedOrg(raw, { id: "org_a" }); seedOrg(raw, { id: "org_b" });
    raw.prepare("INSERT INTO contact (id, org_id, name, created_at) VALUES ('c_b', 'org_b', 'Theirs', ?)").run(iso());
    await expect(saveDeal(env, "org_a", { title: "Deal", contact_id: "c_b" }, { actor: "x" })).rejects.toMatchObject({ status: 404 });
    raw.prepare("INSERT INTO contact (id, org_id, name, created_at) VALUES ('c_a', 'org_a', 'Ours', ?)").run(iso());
    const ok = await saveDeal(env, "org_a", { title: "Deal", contact_id: "c_a" }, { actor: "x" });
    expect(ok).toBeTruthy();
  });
});

/* ---------- I1: MCP clients always get JSON-RPC back ---------- */
import { sha256Hex } from "../../packages/core/util";
describe("I1 MCP errors", () => {
  it("an unexpected failure inside tools/call is a JSON-RPC error, not a bare 500", async () => {
    const { raw, env } = testEnv({ SIGNING_JWK: "not-a-key", SIGNING_KID: "k" });
    raw.prepare("INSERT INTO api_key (id, key_hash, kind, created_at) VALUES ('k1', ?, 'credits', ?)").run(await sha256Hex("ah_live_m"), iso());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html><title>t</title></html>", { headers: { "content-type": "text/html" } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call(env, "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer ah_live_m" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "read-page", arguments: { url: "https://example.com" } } }) });
    const j: any = await r.json();
    expect(j).toMatchObject({ jsonrpc: "2.0", id: 7, error: { code: -32603 } });
  });
});

/* ---------- A2: prospect preview validates its query ---------- */
describe("A2 prospect preview input", () => {
  it("a bad age or district is a 400, not a server error", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO session (id_hash, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)").run(await sha256Hex("sid_p"), org.user, org.id, iso(-864e5));
    const get = (q: string) => call(env, "/api/ws/prospects/preview?" + q, { headers: { Cookie: "ah_session=sid_p" } });
    expect((await get("age=abc")).status).toBe(400);
    expect((await get("districts=M1,%27%3B%20DROP")).status).toBe(400);
    expect((await get("districts=M1,M2&sic=69&age=3")).status).toBe(200);
  });
});

/* ---------- D4: everything personal has a retention period ---------- */
import { retention } from "../../apps/api/src/lib/jobs";
describe("D4 retention periods", () => {
  it("deletes old bookings, local outbox mail and seen webhook ids", async () => {
    const { raw, env } = testEnv();
    const old = iso(400 * 864e5);
    raw.prepare("INSERT INTO booking (id, slot, name, email, company, created_at) VALUES ('b1', '2025-01-01T09:30', 'n', 'e@x.test', 'c', ?)").run(old);
    raw.prepare("INSERT INTO booking (id, slot, name, email, company, created_at) VALUES ('b2', '2026-12-01T09:30', 'n', 'e@x.test', 'c', ?)").run(iso());
    raw.prepare("INSERT INTO dev_outbox (id, to_addr, subject, body, at) VALUES ('d1', 'a@b.test', 's', 'b', ?)").run(old);
    raw.prepare("INSERT INTO webhook_seen (source, event_id, at) VALUES ('stripe', 'evt_old', ?)").run(old);
    await retention(env);
    expect((raw.prepare("SELECT id FROM booking").all() as any[]).map((r) => r.id)).toEqual(["b2"]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM dev_outbox").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM webhook_seen").get()).toEqual({ n: 0 });
  });
});
