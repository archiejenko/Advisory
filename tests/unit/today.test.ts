// Today (the home screen), batch approval, and house rules, against the real SQL and routes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import worker from "../../apps/api/src/index";
import { sha256Hex } from "../../packages/core/util";
import { todayState, learnFromEdit, meaningfulEdit, addRule, activeRules } from "../../apps/api/src/lib/today";
import { runAgent } from "../../apps/api/src/lib/agents";

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
afterEach(() => vi.restoreAllMocks());

async function signedIn() {
  const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
  const org = seedOrg(raw);
  raw.prepare("INSERT INTO session (id_hash, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)").run(await sha256Hex("sid_1"), org.user, org.id, new Date(Date.now() + 864e5).toISOString());
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request("https://ah.test" + path, { ...init, headers: { Cookie: "ah_session=sid_1", "Content-Type": "application/json", ...(init.headers || {}) } }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { raw, env, org, call };
}
function draft(raw: any, orgId: string, agentId: string, id: string, payload: any) {
  raw.prepare("INSERT INTO agent_action (id, org_id, agent_id, run_id, kind, title, payload, reason, status, created_at) VALUES (?, ?, ?, 'run_1', 'email', ?, ?, 'Follow-up', 'proposed', ?)")
    .run(id, orgId, agentId, "Email to " + payload.to, JSON.stringify(payload), iso());
}

describe("Today", () => {
  it("leads with what needs the owner, then what came in, what's at risk and how the week went", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id);
    draft(raw, org.id, agent, "act_1", { to: "a@b.example", subject: "Hello", body: "Hi" });
    raw.prepare("INSERT INTO task (id, org_id, title, status, created_at) VALUES ('task_1', ?, 'Call Sam back', 'open', ?)").run(org.id, iso());
    raw.prepare("INSERT INTO invoice (id, org_id, ref, customer, amount_pence, due_date, status, created_at) VALUES ('inv_1', ?, 'INV-1', 'Quayside', 64000, ?, 'unpaid', ?)").run(org.id, day(-10), iso());
    raw.prepare("INSERT INTO invoice (id, org_id, ref, customer, amount_pence, due_date, status, created_at) VALUES ('inv_2', ?, 'INV-2', 'Tarnbrook', 12000, ?, 'unpaid', ?)").run(org.id, day(3), iso());
    raw.prepare("INSERT INTO inbox_message (id, org_id, from_addr, subject, body, received_at) VALUES ('msg_1', ?, 'sam@c.example', 'Quote please', 'x', ?)").run(org.id, iso());
    const t = await todayState(env, org.id);
    expect(t.headline).toBe("2 things need you.");
    expect(t.needs_you.approvals.map((a) => a.id)).toEqual(["act_1"]);
    expect(t.needs_you.tasks).toHaveLength(1);
    expect(t.came_in.inbox_new).toBe(1);
    expect(t.at_risk).toMatchObject({ overdue_count: 1, overdue_pence: 64000, oldest_unpaid_days: 10 });
    expect(t.money.due_this_week_pence).toBe(12000);
  });
  it("says so when nothing needs the owner", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    expect((await todayState(env, org.id)).headline).toBe("Nothing needs you right now.");
  });
});

describe("batch approval", () => {
  it("approves many drafts in one go; one already decided doesn't stop the rest", async () => {
    const { raw, org, call } = await signedIn();
    const agent = seedAgent(raw, org.id, { autonomy: "approve_all" });
    raw.prepare("INSERT INTO lead (id, org_id, company, email, status, created_at) VALUES ('lead_1', ?, 'Acme', 'a@acme.example', 'new', ?)").run(org.id, iso());
    raw.prepare("INSERT INTO lead (id, org_id, company, email, status, created_at) VALUES ('lead_2', ?, 'Beta', 'b@beta.example', 'new', ?)").run(org.id, iso());
    draft(raw, org.id, agent, "act_1", { to: "a@acme.example", subject: "Hello", body: "Hi there", lead_id: "lead_1" });
    draft(raw, org.id, agent, "act_2", { to: "b@beta.example", subject: "Hello", body: "Hi there", lead_id: "lead_2" });
    raw.prepare("UPDATE agent_action SET status = 'rejected' WHERE id = 'act_2'").run();
    const res = await call("/api/ws/actions/batch", { method: "POST", body: JSON.stringify({ ids: ["act_1", "act_2"], decision: "approve" }) });
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j).toMatchObject({ done: 1, failed: 1 });
    expect((raw.prepare("SELECT status FROM agent_action WHERE id = 'act_1'").get() as any).status).toBe("sent");
  });
  it("a viewer can't approve", async () => {
    const { raw, org, call } = await signedIn();
    raw.prepare("UPDATE membership SET role = 'viewer'").run();
    const res = await call("/api/ws/actions/batch", { method: "POST", body: JSON.stringify({ ids: ["act_1"], decision: "approve" }) });
    expect(res.status).toBe(403);
  });
});

describe("house rules", () => {
  it("only a real change counts as an edit worth learning from", () => {
    expect(meaningfulEdit("Hi Sam, thanks.", "Hi Sam,  thanks.")).toBe(false);
    expect(meaningfulEdit("Kind regards, Dana", "Cheers, Dana")).toBe(true);
  });

  it("an edit becomes a proposed rule the owner confirms; agents follow only active rules", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"rule":"Sign off emails with \\"Cheers, Dana\\""}' }], stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 20 } }), { status: 200 }));
    const id = await learnFromEdit(env, org.id, "act_1", { subject: "Hello", body: "Thanks for your time.\nKind regards, Dana" }, { body: "Thanks for your time.\nCheers, Dana" }, "dana@x.example");
    expect(id).toBeTruthy();
    expect(raw.prepare("SELECT status, source FROM house_rule WHERE id = ?").get(id)).toEqual({ status: "proposed", source: "edit" });
    expect(await activeRules(env, org.id)).toEqual([]);
    raw.prepare("UPDATE house_rule SET status = 'active'").run();
    expect(await activeRules(env, org.id)).toEqual(['Sign off emails with "Cheers, Dana"']);
  });

  it("an edit specific to one email teaches nothing", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k" });
    const org = seedOrg(raw);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"rule":null}' }], stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 5 } }), { status: 200 }));
    expect(await learnFromEdit(env, org.id, "act_1", { body: "See you on Tuesday at 10" }, { body: "See you on Thursday at 2" }, "d")).toBeNull();
    expect((raw.prepare("SELECT COUNT(*) AS n FROM house_rule").get() as any).n).toBe(0);
  });

  it("the owner's own rules are active at once, and the same rule isn't saved twice", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    expect((await addRule(env, org.id, "Never email anyone on a Sunday", "d")).duplicate).toBe(false);
    expect((await addRule(env, org.id, "never email anyone on a sunday", "d")).duplicate).toBe(true);
    expect(await activeRules(env, org.id)).toEqual(["Never email anyone on a Sunday"]);
  });

  it("every agent's standing orders carry the active rules", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0" });
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { template: "research" });
    await addRule(env, org.id, "Never offer a discount by email", "d");
    raw.prepare("INSERT INTO agent_run (id, org_id, agent_id, trigger, input, status, created_at) VALUES ('run_r', ?, ?, 'manual', 'Who?', 'queued', ?)").run(org.id, agent, iso());
    let system = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u: any, init: any) => {
      system = JSON.parse(init.body).system[0].text;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 });
    });
    await runAgent(env, "run_r");
    expect(system).toMatch(/House rules[\s\S]*- Never offer a discount by email/);
  });

  it("rules can be added, confirmed and dismissed through the workspace API", async () => {
    const { raw, org, call } = await signedIn();
    raw.prepare("INSERT INTO house_rule (id, org_id, text, source, status, created_at) VALUES ('hr_p', ?, 'Keep emails under 120 words', 'edit', 'proposed', ?)").run(org.id, iso());
    expect((await call("/api/ws/rules", { method: "POST", body: JSON.stringify({ text: "Always mention the free first clean" }) })).status).toBe(200);
    expect((await call("/api/ws/rules/hr_p", { method: "PATCH", body: JSON.stringify({ status: "active" }) })).status).toBe(200);
    const j: any = await (await call("/api/ws/rules")).json();
    expect(j.rules.map((r: any) => [r.text, r.status]).sort()).toEqual([["Always mention the free first clean", "active"], ["Keep emails under 120 words", "active"]]);
    expect((await call("/api/ws/today")).status).toBe(200);
  });
});
