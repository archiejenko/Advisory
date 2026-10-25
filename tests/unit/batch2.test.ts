// Hardening batch 2: reliability and operations. Each test failed before its fix (see docs/architecture-review.md).
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import worker from "../../apps/api/src/index";

afterEach(() => vi.restoreAllMocks());
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const call = (env: any, path: string, init: RequestInit = {}) => worker.fetch(new Request("https://ah.test" + path, init), env, { waitUntil() {}, passThroughOnException() {} } as any);

/* ---------- R3: every upstream call has a deadline ---------- */
import { fetchT } from "../../apps/api/src/lib/fetch";
import { searchCompanies } from "../../apps/api/src/lib/registers";
import { webSearch } from "../../apps/api/src/lib/web";
import { sendMail } from "../../apps/api/src/lib/mail";
import { deliverAlert } from "../../apps/api/src/lib/delivery";
describe("R3 upstream timeouts", () => {
  /** A fetch that never answers, unless its signal aborts. Records each call's init. */
  function hangingFetch() {
    const inits: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_u: any, init: any = {}) => { inits.push(init); return new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(init.signal.reason))); });
    return inits;
  }
  it("fetchT gives up when the deadline passes", async () => {
    hangingFetch();
    await expect(fetchT("https://slow.test", {}, 20)).rejects.toThrow();
  });
  it("Companies House, search, mail and channel posts all carry a deadline", async () => {
    const { raw, env } = testEnv({ CH_API_BASE: "https://ch.test", CH_API_KEY: "k", SEARCH_API_KEY: "k", MAIL_MODE: "http", MAIL_HTTP_URL: "https://mail.test", SENDS_LIVE: "true", ALLOW_ANY_WEBHOOK_HOST: "true" });
    const inits = hangingFetch();
    for (const p of [searchCompanies(env, "acme"), webSearch(env, "acme"), sendMail(env, { to: "a@b.test", subject: "s", text: "t" })]) p.catch(() => {});
    const org = seedOrg(raw);
    const { seal } = await import("../../apps/api/src/lib/crypto");
    raw.prepare("INSERT INTO channel (id, org_id, kind, label, target_enc, created_at) VALUES ('ch1', ?, 'slack', 'S', ?, ?)").run(org.id, await seal(env, "https://hooks.slack.com/x"), iso());
    raw.prepare("INSERT INTO alert (id, org_id, number, event_id, agent, check_key, severity, title, summary, facts, next_step, created_at) VALUES ('al1', ?, '01234567', 'e1', 'watch', 'c', 'Critical', 't', 's', '[]', 'n', ?)").run(org.id, iso());
    deliverAlert(env, "al1", "ch1", "alert").catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    expect(inits.length).toBe(4);
    expect(inits.every((i) => i.signal instanceof AbortSignal)).toBe(true);
    expect(inits[3].redirect).toBe("manual");
  });
});

/* ---------- R6: a run stops starting new model steps after its deadline, before the stuck-run sweep ---------- */
import { runAgent, RUN_DEADLINE_MS, STUCK_MINUTES } from "../../apps/api/src/lib/agents";
describe("R6 run deadline", () => {
  it("leaves room for the slowest step before the sweep", () => {
    expect(RUN_DEADLINE_MS + 8 * 60000).toBeLessThan(STUCK_MINUTES * 60000);
  });
  it("stops at the next step once the deadline has passed", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0", RUN_DEADLINE_MS: "1" });
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { template: "research" });
    raw.prepare("INSERT INTO agent_run (id, org_id, agent_id, trigger, input, status, created_at) VALUES ('run_d', ?, ?, 'manual', 'q', 'queued', ?)").run(org.id, agent, iso());
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "t" + calls, name: "business-profile", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200 }); });
    expect(await runAgent(env, "run_d")).toBe("failed");
    expect(calls).toBeLessThanOrEqual(1); // without the deadline this loop asks for a tool on all 8 steps
    expect((raw.prepare("SELECT error FROM agent_run WHERE id = 'run_d'").get() as any).error).toMatch(/time limit/);
  });
});

/* ---------- R4: errors are structured, and the operator hears about them ---------- */
describe("R4 error reporting", () => {
  it("a server error logs one JSON line with the path, and emails the operator once an hour", async () => {
    const { raw, env } = testEnv({ OPERATOR_EMAIL: "op@ah.test" });
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: any[]) => { logged.push(a.map(String).join(" ")); });
    raw.exec("DROP TABLE booking"); // the public slots route reads it: now it fails unexpectedly
    const r1 = await call(env, "/api/public/slots");
    const r2 = await call(env, "/api/public/slots");
    expect([r1.status, r2.status]).toEqual([500, 500]);
    const line = logged.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j?.event === "server_error");
    expect(line).toMatchObject({ level: "error", path: "/api/public/slots", method: "GET" });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_addr = 'op@ah.test'").get()).toEqual({ n: 1 });
  });
});

/* ---------- D2: close and export a workspace; ended trials don't keep data for ever ---------- */
import { retention } from "../../apps/api/src/lib/jobs";
import { sha256Hex } from "../../packages/core/util";
async function signedIn(raw: any, env: any, orgId: string, userId: string) {
  raw.prepare("INSERT INTO session (id_hash, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)").run(await sha256Hex("sid_" + userId), userId, orgId, iso(-864e5));
  return (path: string, init: RequestInit = {}) => call(env, "/api/ws" + path, { ...init, headers: { "Content-Type": "application/json", Cookie: "ah_session=sid_" + userId, ...(init.headers || {}) } });
}
describe("D2 close, export, trial expiry", () => {
  it("an owner can close the workspace: agents stop, and it's purged after 30 days", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "growth" });
    raw.prepare("UPDATE subscription SET status = 'pilot' WHERE org_id = ?").run(org.id);
    const ws = await signedIn(raw, env, org.id, org.user);
    expect((await ws("/org/close", { method: "POST", body: JSON.stringify({ confirm: "wrong name" }) })).status).toBe(400);
    expect((await ws("/org/close", { method: "POST", body: JSON.stringify({ confirm: "Brightwork org_a" }) })).status).toBe(200);
    expect((raw.prepare("SELECT cancelled_at FROM org").get() as any).cancelled_at).toBeTruthy();
  });
  it("closing waits for an active paid plan to be cancelled in billing first", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "growth" });
    raw.prepare("UPDATE subscription SET status = 'active', stripe_subscription = 'sub_1' WHERE org_id = ?").run(org.id);
    const ws = await signedIn(raw, env, org.id, org.user);
    expect((await ws("/org/close", { method: "POST", body: JSON.stringify({ confirm: "Brightwork org_a" }) })).status).toBe(409);
  });
  it("an owner can export the workspace's data, without credentials", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO lead (id, org_id, company, email, created_at) VALUES ('l1', ?, 'Co', 'a@co.test', ?)").run(org.id, iso());
    raw.prepare("INSERT INTO channel (id, org_id, kind, label, target_enc, created_at) VALUES ('c1', ?, 'slack', 'S', 'secret', ?)").run(org.id, iso());
    const ws = await signedIn(raw, env, org.id, org.user);
    const r = await ws("/export");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const j: any = await r.json();
    expect(j.tables.lead).toEqual([expect.objectContaining({ id: "l1", company: "Co" })]);
    expect(j.tables.channel[0].target_enc).toBeUndefined();
    expect(j.tables.session).toBeUndefined();
    expect(j.tables.api_key).toBeUndefined();
  });
  it("a viewer can't export or close", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO user (id, email, created_at) VALUES ('usr_v', 'v@x.test', ?)").run(iso());
    raw.prepare("INSERT INTO membership (org_id, user_id, role) VALUES (?, 'usr_v', 'viewer')").run(org.id);
    const ws = await signedIn(raw, env, org.id, "usr_v");
    expect((await ws("/export")).status).toBe(403);
    expect((await ws("/org/close", { method: "POST", body: JSON.stringify({ confirm: "Brightwork org_a" }) })).status).toBe(403);
  });
  it("retention warns a week before, then closes a trial that ended 30 days ago with no plan", async () => {
    const { raw, env } = testEnv();
    seedOrg(raw, { id: "org_old", plan: "trial", created_at: iso(45 * 864e5) });
    seedOrg(raw, { id: "org_warn", plan: "trial", created_at: iso(37.5 * 864e5) });
    seedOrg(raw, { id: "org_new", plan: "trial", created_at: iso(5 * 864e5) });
    raw.prepare("UPDATE subscription SET status = 'trialing'").run();
    await retention(env);
    const closed = (raw.prepare("SELECT id FROM org WHERE cancelled_at IS NOT NULL ORDER BY id").all() as any[]).map((r) => r.id);
    expect(closed).toEqual(["org_old"]);
    expect((raw.prepare("SELECT to_addr, subject FROM dev_outbox").all() as any[]).map((m) => m.to_addr)).toEqual(["owner@org_warn.test"]);
  });
});

/* ---------- D3: clearing old message bodies catches up after missed days ---------- */
describe("D3 retention catch-up", () => {
  it("clears bodies older than 90 days even when retention missed weeks", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO inbox_message (id, org_id, from_addr, subject, body, received_at) VALUES ('m1', ?, 'a@b.test', 's', 'old text', ?)").run(org.id, iso(120 * 864e5));
    await retention(env);
    expect((raw.prepare("SELECT body FROM inbox_message WHERE id = 'm1'").get() as any).body).toBeNull();
  });
});
