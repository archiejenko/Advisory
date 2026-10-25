// Hardening batch 1: each test failed before its fix. See docs/architecture-review.md for the finding ids.
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import { sendMail } from "../../apps/api/src/lib/mail";
import { proposeEmail, executeAction, DRY_RUN_NOTE } from "../../apps/api/src/lib/actions";

afterEach(() => vi.restoreAllMocks());
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

/** An env that sends through the HTTP provider, with SENDS_LIVE off, and records what reached it. */
function httpEnv(vars: Record<string, string> = {}) {
  const t = testEnv({ MAIL_MODE: "http", MAIL_HTTP_URL: "https://mail.test/emails", MAIL_HTTP_KEY: "k", MAIL_FROM: "AH <hello@ah.test>", SENDS_LIVE: "false", ...vars });
  const posted: any[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => { posted.push({ url: String(url), body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); });
  return { ...t, posted };
}

/* ---------- C1: sign-in and other transactional mail isn't held by SENDS_LIVE ---------- */
describe("C1 transactional mail", () => {
  it("sends transactional mail while SENDS_LIVE is off, and holds outbound mail", async () => {
    const { env, posted } = httpEnv();
    expect(await sendMail(env, { to: "owner@biz.test", subject: "Sign in", text: "link", kind: "transactional" })).toBe("sent");
    expect(await sendMail(env, { to: "lead@other.test", subject: "Hello", text: "pitch" })).toBe("dry_run");
    expect(posted.map((p) => p.body.to[0])).toEqual(["owner@biz.test"]);
  });

  it("transactional mail ignores the outreach suppression list", async () => {
    const { raw, env, posted } = httpEnv({ SENDS_LIVE: "true" });
    raw.prepare("INSERT INTO suppression (email, reason, at) VALUES ('owner@biz.test', 'unsubscribe', ?)").run(iso());
    expect(await sendMail(env, { to: "owner@biz.test", subject: "Sign in", text: "link", kind: "transactional" })).toBe("sent");
    expect(await sendMail(env, { to: "owner@biz.test", subject: "Offer", text: "pitch" })).toBe("suppressed");
    expect(posted).toHaveLength(1);
  });

  it("the magic-link route sends the link while SENDS_LIVE is off", async () => {
    const { raw, env, posted } = httpEnv();
    seedOrg(raw, { email: "owner@biz.test" });
    const worker = (await import("../../apps/api/src/index")).default;
    const res = await worker.fetch(new Request("https://ah.test/api/auth/magic-link", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify({ email: "owner@biz.test" }) }), env, { waitUntil() {}, passThroughOnException() {} } as any);
    expect(res.status).toBe(200);
    expect(posted.map((p) => p.body.to[0])).toEqual(["owner@biz.test"]);
  });

  it("an approved email that was only a dry run is recorded as dry_run, not sent", async () => {
    const { raw, env } = httpEnv();
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { autonomy: "approve_all" });
    raw.prepare("INSERT INTO lead (id, org_id, company, email, created_at) VALUES ('lead_1', ?, 'Co', 'hi@co.test', ?)").run(org.id, iso(864e5));
    const p = await proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "hi@co.test", subject: "Hello", body: "Hi", lead_id: "lead_1" });
    const r = await executeAction(env, org.id, p.action_id, "owner@biz.test");
    expect(r.status).toBe("dry_run");
    expect(raw.prepare("SELECT status, result FROM agent_action WHERE id = ?").get(p.action_id)).toEqual({ status: "failed", result: DRY_RUN_NOTE });
    expect((raw.prepare("SELECT status FROM lead WHERE id = 'lead_1'").get() as any).status).toBe("new");
  });
});
