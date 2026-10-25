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

/* ---------- S4: only the address's owner can unsubscribe it; suppression covers outreach only ---------- */
import { unsubToken } from "../../apps/api/src/lib/crypto";
import worker from "../../apps/api/src/index";
const call = (env: any, path: string, init: RequestInit) => worker.fetch(new Request("https://ah.test" + path, init), env, { waitUntil() {}, passThroughOnException() {} } as any);
const post = (env: any, path: string, body: unknown, ip = "1.2.3.4") => call(env, path, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
const CHANNEL_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

describe("S4 unsubscribe", () => {
  it("refuses to suppress an address without a valid token, and emails a confirmation link instead", async () => {
    const { raw, env } = testEnv({ CHANNEL_KEY });
    const r = await post(env, "/api/public/unsubscribe", { email: "victim@biz.test" });
    expect(r.status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM suppression").get()).toEqual({ n: 0 });
    const mail = raw.prepare("SELECT to_addr, body FROM dev_outbox").get() as any;
    expect(mail.to_addr).toBe("victim@biz.test");
    expect(mail.body).toContain("t=" + (await unsubToken(env, "victim@biz.test")));
    expect((await post(env, "/api/public/unsubscribe", { email: "victim@biz.test", token: "forged-token-value" })).status).toBe(400);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM suppression").get()).toEqual({ n: 0 });
  });

  it("suppresses with the token from the link", async () => {
    const { raw, env } = testEnv({ CHANNEL_KEY });
    const r = await post(env, "/api/public/unsubscribe", { email: "Lead@Co.test", token: await unsubToken(env, "lead@co.test") });
    expect(r.status).toBe(200);
    expect(raw.prepare("SELECT email FROM suppression").all()).toEqual([{ email: "lead@co.test" }]);
  });

  it("outreach footers carry a signed link; invoice reminders still reach a suppressed debtor", async () => {
    const { raw, env } = testEnv({ CHANNEL_KEY });
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { autonomy: "approve_all" });
    raw.prepare("INSERT INTO lead (id, org_id, company, email, created_at) VALUES ('lead_1', ?, 'Co', 'hi@co.test', ?)").run(org.id, iso(864e5));
    raw.prepare("INSERT INTO invoice (id, org_id, ref, customer, email, amount_pence, due_date, created_at) VALUES ('inv_1', ?, 'INV-1', 'Acme', 'ap@acme.test', 1000, '2026-01-01', ?)").run(org.id, iso());
    raw.prepare("INSERT INTO suppression (email, reason, at) VALUES ('ap@acme.test', 'unsubscribe', ?)").run(iso());
    const a = await proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "hi@co.test", subject: "Hello", body: "Hi", lead_id: "lead_1" });
    await executeAction(env, org.id, a.action_id, "owner");
    const b = await proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "ap@acme.test", subject: "Invoice INV-1", body: "A reminder", invoice_id: "inv_1" });
    expect((await executeAction(env, org.id, b.action_id, "owner")).status).toBe("sent");
    const sent = raw.prepare("SELECT to_addr, body FROM dev_outbox ORDER BY at").all() as any[];
    expect(sent.map((m) => m.to_addr)).toEqual(["hi@co.test", "ap@acme.test"]);
    expect(sent[0].body).toContain(`t=${await unsubToken(env, "hi@co.test")}`);
    await expect(proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "ap@acme.test", subject: "Offer", body: "Buy", lead_id: "lead_1" })).rejects.toThrow(/asked not to be contacted/);
  });
});

/* ---------- S11: STOP and lead status only act on mail whose sender is authenticated ---------- */
import { onEmail, senderVerified } from "../../apps/api/src/lib/inbound";
function email(from: string, to: string, body: string, auth?: string) {
  const raw = `From: ${from}\r\nTo: ${to}\r\nSubject: Re: hello\r\n${auth ? `Authentication-Results: mx.cloudflare.net; ${auth}\r\n` : ""}\r\n${body}\r\n`;
  const h = new Headers(); if (auth) h.set("authentication-results", `mx.cloudflare.net; ${auth}`);
  return { from, to, raw: new Response(raw).body, rawSize: raw.length, headers: h, setReject() {} } as any;
}
describe("S11 inbound sender authentication", () => {
  it("recognises SPF, DKIM or DMARC passes for the sender's domain only", () => {
    const h = (v: string) => new Headers({ "authentication-results": v });
    expect(senderVerified(h("mx; dmarc=pass header.from=co.test"), "a@co.test")).toBe(true);
    expect(senderVerified(h("mx; spf=pass smtp.mailfrom=a@co.test"), "a@co.test")).toBe(true);
    expect(senderVerified(h("mx; dkim=pass header.d=co.test"), "a@co.test")).toBe(true);
    expect(senderVerified(h("mx; spf=pass smtp.mailfrom=x@evil.test; dkim=pass header.d=evil.test"), "a@co.test")).toBe(false);
    expect(senderVerified(h("mx; spf=fail smtp.mailfrom=a@co.test"), "a@co.test")).toBe(false);
    expect(senderVerified(new Headers(), "a@co.test")).toBe(false);
  });

  it("a forged STOP doesn't suppress the address; an authenticated one does", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO lead (id, org_id, company, email, status, created_at) VALUES ('lead_1', ?, 'Co', 'boss@co.test', 'contacted', ?)").run(org.id, iso());
    await onEmail(email("boss@co.test", `${org.id}-in@in.test`, "STOP"), env);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM suppression").get()).toEqual({ n: 0 });
    expect((raw.prepare("SELECT status FROM lead").get() as any).status).toBe("contacted");
    await onEmail(email("boss@co.test", `${org.id}-in@in.test`, "STOP", "spf=pass smtp.mailfrom=boss@co.test"), env);
    expect(raw.prepare("SELECT email FROM suppression").all()).toEqual([{ email: "boss@co.test" }]);
  });
});
