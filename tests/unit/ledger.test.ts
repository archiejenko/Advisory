// The credit ledger against the real SQL: grants, the monthly reset, top-ups, both kinds of pause, plan changes
// and asking before an expensive run.
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import { balance, ensurePeriod, chargeRun, grantTopup, grantUpgrade, monthLeft, periodOf, available, clearBudgetPause } from "../../apps/api/src/lib/credits";
import { applyStripeEvent, upgradeRef } from "../../apps/api/src/lib/billing";
import { startRun } from "../../apps/api/src/lib/agents";
import { resetCredits } from "../../apps/api/src/lib/jobs";
import { createOrg } from "../../apps/api/src/lib/orgs";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const at = (iso: string) => new Date(iso);
const none = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
const use = (env: any, orgId: string, credits: number, o: { agentId?: string; runId?: string; now?: Date } = {}) =>
  chargeRun(env, { orgId, runId: o.runId || "run_" + Math.random().toString(36).slice(2), agentId: o.agentId, model: "claude-sonnet-5-5", mode: "standard", cost: credits, tokens: none, requests: 1 }, o.now);
const entries = (raw: any, orgId: string, kind: string) => raw.prepare("SELECT credits, from_plan, from_topup, period, ref FROM credit_entry WHERE org_id = ? AND kind = ? ORDER BY at").all(orgId, kind);
const outbox = (raw: any) => (raw.prepare("SELECT subject FROM dev_outbox ORDER BY at").all() as any[]).map((r) => r.subject);
/** Fake only the clock, so the database and timers behave as normal. */
const clock = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };

describe("the trial", () => {
  it("a new business gets 150 credits once, on the ledger from the moment it's created", async () => {
    const { raw, env } = testEnv();
    const { org_id: orgId } = await createOrg(env, { name: "Corriemoor Interiors", owner_email: "owner@corriemoor.test", plan: "trial", by: "test", welcome: false });
    await ensurePeriod(env, orgId);
    await ensurePeriod(env, orgId);
    expect(entries(raw, orgId, "trial_grant")).toEqual([expect.objectContaining({ credits: 150, from_plan: 0, from_topup: 150, ref: "trial" })]);
    expect(await balance(env, orgId)).toMatchObject({ plan: 0, topup: 150, total: 150 });
  });

  it("trial credits don't lapse on the 1st, and every mode can use them", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw, { plan: "trial", created_at: "2026-10-25T09:00:00Z" });
    await ensurePeriod(env, org.id, at("2026-10-25T10:00:00Z"));
    await use(env, org.id, 40, { now: at("2026-10-30T10:00:00Z") });
    expect((await balance(env, org.id, at("2026-11-02T10:00:00Z"))).total).toBe(110);
    clock("2026-10-26T10:00:00Z");
    const agent = seedAgent(raw, org.id, { template: "research" });
    for (const mode of ["quick", "standard", "deep", "strategy"]) await expect(startRun(env, org.id, agent, "manual", "Who is Acme?", { mode })).resolves.toMatch(/^run_/);
  });
});

describe("the monthly reset", () => {
  it("plan credits lapse on the 1st and the new month's are granted, once, however often it's checked", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "growth" });
    const oct = at("2026-10-15T12:00:00Z"), nov = at("2026-11-01T00:30:00Z");
    expect(await balance(env, org.id, oct)).toMatchObject({ plan: 5000, topup: 0, period: "2026-10", reset_on: "2026-11-01" });
    await use(env, org.id, 1200.5, { now: oct });
    expect((await balance(env, org.id, oct)).plan).toBe(3799.5);
    await ensurePeriod(env, org.id, nov);
    await ensurePeriod(env, org.id, nov);
    expect(entries(raw, org.id, "plan_expiry")).toEqual([expect.objectContaining({ credits: -3799.5, from_plan: -3799.5, period: "2026-10", ref: "2026-10" })]);
    expect(entries(raw, org.id, "plan_grant").map((e: any) => e.period)).toEqual(["2026-10", "2026-11"]);
    expect(await balance(env, org.id, nov)).toMatchObject({ plan: 5000, total: 5000, period: "2026-11" });
  });

  it("the 1st is in UK time: 23:30 UTC on 31 October is still October, 00:30 BST on 1 October is October", () => {
    expect(periodOf(at("2026-10-31T23:30:00Z"))).toBe("2026-10");
    expect(periodOf(at("2026-09-30T23:30:00Z"))).toBe("2026-10");
    expect(periodOf(at("2026-09-30T22:30:00Z"))).toBe("2026-09");
  });

  it("the cron brings every paying business into the new month, and skips ones already there", async () => {
    const { raw, env } = testEnv();
    const a = seedOrg(raw, { id: "org_a", plan: "starter" }), b = seedOrg(raw, { id: "org_b", plan: "scale" }), c = seedOrg(raw, { id: "org_c", plan: "trial" });
    expect(await resetCredits(env, at("2026-11-01T00:15:00Z"))).toBe(2);
    expect(await resetCredits(env, at("2026-11-01T00:30:00Z"))).toBe(0);
    expect(entries(raw, a.id, "plan_grant")).toEqual([expect.objectContaining({ credits: 1500 })]);
    expect(entries(raw, b.id, "plan_grant")).toEqual([expect.objectContaining({ credits: 12000 })]);
    expect(entries(raw, c.id, "plan_grant")).toEqual([]);
  });

  it("the last step's overshoot comes off the month's plan credits and is forgiven at the reset", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "starter" });
    const oct = at("2026-10-20T12:00:00Z");
    await use(env, org.id, 1500, { now: oct });
    await use(env, org.id, 12.4, { now: oct }); // the step that started with credits left
    expect(await balance(env, org.id, oct)).toMatchObject({ plan: -12.4, topup: 0, total: 0 });
    expect(await balance(env, org.id, at("2026-11-01T09:00:00Z"))).toMatchObject({ plan: 1500, topup: 0, total: 1500 });
    expect(entries(raw, org.id, "plan_expiry")).toEqual([expect.objectContaining({ credits: 12.4, period: "2026-10" })]);
  });
});

describe("top-ups", () => {
  it("roll over the reset, while plan credits don't, and are used after plan credits", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "starter" });
    const oct = at("2026-10-10T12:00:00Z");
    await grantTopup(env, org.id, "cs_1", 1000, oct);
    await use(env, org.id, 1700, { now: oct });
    expect(entries(raw, org.id, "run")).toEqual([expect.objectContaining({ credits: -1700, from_plan: -1500, from_topup: -200 })]);
    expect(await balance(env, org.id, oct)).toMatchObject({ plan: 0, topup: 800, total: 800 });
    expect(await balance(env, org.id, at("2026-11-03T12:00:00Z"))).toMatchObject({ plan: 1500, topup: 800, total: 2300 });
  });

  it("arrive from Stripe only when paid, once, however often the webhook is sent", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "growth" });
    const ev = (status: string, type = "checkout.session.completed") => ({ type, data: { object: { id: "cs_topup_1", mode: "payment", payment_status: status, metadata: { kind: "topup", org_id: org.id } } } });
    await applyStripeEvent(env, ev("unpaid"));
    expect(entries(raw, org.id, "topup")).toEqual([]);
    await applyStripeEvent(env, ev("paid", "checkout.session.async_payment_succeeded"));
    await applyStripeEvent(env, ev("paid"));
    expect(entries(raw, org.id, "topup")).toEqual([expect.objectContaining({ credits: 1000, from_topup: 1000, ref: "cs_topup_1" })]);
  });
});

describe("when credits run out, the AI Team pauses", () => {
  it("plan-wide: no new runs, the owner is told once, and a top-up starts it again", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw, { plan: "trial" });
    const agent = seedAgent(raw, org.id, { template: "research" });
    await use(env, org.id, 100);
    expect(outbox(raw)).toEqual([]);
    await use(env, org.id, 50);
    await use(env, org.id, 3); // a run already going when it ran out
    expect(outbox(raw)).toEqual(["Your AI Team has paused: credits used"]);
    await expect(startRun(env, org.id, agent, "manual", "Who is Acme?")).rejects.toMatchObject({ status: 402, code: "credits_used" });
    // Nothing is charged on its own: only a paid top-up brings it back.
    expect(entries(raw, org.id, "topup")).toEqual([]);
    await grantTopup(env, org.id, "cs_2");
    expect(await available(env, org.id)).toBe(1000); // the 3 past zero were the last step's overshoot, forgiven
    await expect(startRun(env, org.id, agent, "manual", "Who is Acme?")).resolves.toMatch(/^run_/);
  });

  it("plan-wide: without a top-up it starts again on the 1st", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw, { plan: "starter" });
    const agent = seedAgent(raw, org.id, { template: "research" });
    clock("2026-10-20T12:00:00Z");
    await use(env, org.id, 1500);
    await expect(startRun(env, org.id, agent, "manual", "Who is Acme?")).rejects.toMatchObject({ code: "credits_used" });
    clock("2026-11-01T08:00:00Z");
    await expect(startRun(env, org.id, agent, "manual", "Who is Acme?")).resolves.toMatch(/^run_/);
  });

  it("per agent: an agent at its own budget pauses alone, the owner is told, and raising the budget lets it carry on", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw, { plan: "growth" });
    const capped = seedAgent(raw, org.id, { id: "agt_capped", template: "research" }), other = seedAgent(raw, org.id, { id: "agt_other", template: "research" });
    raw.prepare("UPDATE agent SET monthly_budget = 50, name = 'Research desk' WHERE id = ?").run(capped);
    await use(env, org.id, 30, { agentId: capped });
    await use(env, org.id, 25, { agentId: capped });
    expect((raw.prepare("SELECT budget_paused_period FROM agent WHERE id = ?").get(capped) as any).budget_paused_period).toBe(periodOf());
    expect(outbox(raw)).toEqual(["Research desk paused: monthly budget reached"]);
    await expect(startRun(env, org.id, capped, "manual", "Who is Acme?")).rejects.toMatchObject({ status: 402, code: "agent_budget_used" });
    await expect(startRun(env, org.id, other, "manual", "Who is Acme?")).resolves.toMatch(/^run_/);
    raw.prepare("UPDATE agent SET monthly_budget = 200 WHERE id = ?").run(capped);
    await clearBudgetPause(env, capped);
    await expect(startRun(env, org.id, capped, "manual", "Who is Acme?")).resolves.toMatch(/^run_/);
  });

  it("per agent: a run stops before the step that would start past the agent's budget", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0" });
    const org = seedOrg(raw, { plan: "growth" });
    const agent = seedAgent(raw, org.id, { template: "research" });
    raw.prepare("UPDATE agent SET monthly_budget = 30 WHERE id = ?").run(agent);
    const { runAgent } = await import("../../apps/api/src/lib/agents");
    raw.prepare("INSERT INTO agent_run (id, org_id, agent_id, trigger, input, status, created_at, mode, model) VALUES ('run_c', ?, ?, 'manual', 'Who is Acme?', 'queued', ?, 'standard', 'claude-sonnet-5-5')").run(org.id, agent, new Date().toISOString());
    let calls = 0; // about 23 credits a step
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { calls++; return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "t" + calls, name: "business-profile", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 100000, output_tokens: 10000 } }), { status: 200 }); });
    expect(await runAgent(env, "run_c")).toBe("failed");
    expect(calls).toBe(2);
    expect((raw.prepare("SELECT error FROM agent_run WHERE id = 'run_c'").get() as any).error).toMatch(/monthly credit budget/);
  });
});

describe("plan changes", () => {
  it("an upgrade adds the extra credits for the rest of the month, once, whether the route or Stripe records it first", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "starter" });
    raw.prepare("UPDATE subscription SET stripe_subscription = 'sub_1' WHERE org_id = ?").run(org.id);
    const mid = at("2026-11-16T12:00:00Z"); // 15 of November's 30 days left
    expect(monthLeft(mid)).toBe(0.5);
    expect(await grantUpgrade(env, org.id, "starter", "growth", "sub_1:growth:2026-11", mid)).toBe(1750);
    await grantUpgrade(env, org.id, "starter", "growth", "sub_1:growth:2026-11", mid);
    expect(entries(raw, org.id, "upgrade_grant")).toEqual([expect.objectContaining({ credits: 1750, from_plan: 1750 })]);
    expect(upgradeRef("sub_1", "growth")).toBe(`sub_1:growth:${periodOf()}`);
  });

  it("an upgrade made in Stripe gets its credits from the webhook", async () => {
    const { raw, env } = testEnv({ STRIPE_PRICE_STARTER: "price_s", STRIPE_PRICE_GROWTH: "price_g", STRIPE_PRICE_SCALE: "price_b" });
    const org = seedOrg(raw, { plan: "starter" });
    raw.prepare("UPDATE subscription SET stripe_subscription = 'sub_2' WHERE org_id = ?").run(org.id);
    const ev = { type: "customer.subscription.updated", data: { object: { id: "sub_2", status: "active", items: { data: [{ price: { id: "price_b" } }] } } } };
    await applyStripeEvent(env, ev);
    await applyStripeEvent(env, ev);
    expect((raw.prepare("SELECT plan FROM org WHERE id = ?").get(org.id) as any).plan).toBe("scale");
    expect(entries(raw, org.id, "upgrade_grant")).toHaveLength(1);
    expect(entries(raw, org.id, "upgrade_grant")[0].credits).toBe(Math.round(10500 * monthLeft()));
  });

  it("a downgrade waits for the 1st, and that month's credits are the smaller plan's", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "scale" });
    const oct = at("2026-10-20T12:00:00Z");
    await ensurePeriod(env, org.id, oct);
    raw.prepare("UPDATE org SET pending_plan = 'starter' WHERE id = ?").run(org.id);
    await ensurePeriod(env, org.id, oct);
    expect((await balance(env, org.id, oct)).plan).toBe(12000);
    expect(await balance(env, org.id, at("2026-11-01T06:00:00Z"))).toMatchObject({ plan: 1500 });
    expect(raw.prepare("SELECT plan, pending_plan FROM org WHERE id = ?").get(org.id)).toEqual({ plan: "starter", pending_plan: null });
  });

  it("a plan started mid-month gets that month's credits prorated, like its first invoice", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "trial" });
    clock("2026-11-16T12:00:00Z");
    await applyStripeEvent(env, { type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: org.id, customer: "cus_1", subscription: "sub_3", metadata: { plan: "growth" } } } });
    expect(entries(raw, org.id, "plan_grant")).toEqual([expect.objectContaining({ credits: 2500, period: "2026-11" })]);
    clock("2026-12-01T09:00:00Z");
    expect((await balance(env, org.id)).plan).toBe(5000);
  });
});

describe("asking before an expensive run", () => {
  it("a run likely to cost more than the threshold needs the person who started it to confirm", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw, { plan: "growth" });
    const agent = seedAgent(raw, org.id, { template: "research" });
    const go = (o: any) => startRun(env, org.id, agent, "manual", "Who is Acme?", o);
    // Strategy is likely to use 80–340 credits, over the default 100.
    await expect(go({ mode: "strategy", confirm: false })).rejects.toMatchObject({ status: 409, code: "needs_confirmation", extra: { estimate: { low: 80, high: 340, mode: "strategy" }, threshold: 100 } });
    await expect(go({ mode: "strategy", confirm: true })).resolves.toMatch(/^run_/);
    await expect(go({ mode: "deep", confirm: false })).resolves.toMatch(/^run_/);
    // Owners can change the threshold.
    raw.prepare("UPDATE org SET confirm_over = 400 WHERE id = ?").run(org.id);
    await expect(go({ mode: "strategy", confirm: false })).resolves.toMatch(/^run_/);
    raw.prepare("UPDATE org SET confirm_over = 5 WHERE id = ?").run(org.id);
    await expect(go({ mode: "deep", confirm: false })).rejects.toMatchObject({ code: "needs_confirmation" });
    // Runs that start on their own use the estimate approved when the agent's mode was set.
    await expect(startRun(env, org.id, agent, "schedule", "Who is Acme?", { mode: "strategy" })).resolves.toMatch(/^run_/);
    expect((raw.prepare("SELECT mode, model FROM agent_run ORDER BY created_at DESC LIMIT 1").get() as any)).toEqual({ mode: "strategy", model: "claude-fable-5-1" });
  });
});

describe("default modes", () => {
  it("an agent hired without a mode gets the one its job suits; custom roles start on Standard", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw, { plan: "growth" });
    const { hireAgent } = await import("../../apps/api/src/lib/agents");
    const mode = async (template: string) => (raw.prepare("SELECT mode FROM agent WHERE id = ?").get(await hireAgent(env, org.id, org.user, { template })) as any).mode;
    expect(await mode("inbox")).toBe("quick");
    expect(await mode("outreach")).toBe("standard");
    expect(await mode("research")).toBe("deep");
    expect((raw.prepare("SELECT mode FROM agent WHERE id = ?").get(await hireAgent(env, org.id, org.user, { template: "outreach", mode: "strategy" })) as any).mode).toBe("strategy");
  });
});
