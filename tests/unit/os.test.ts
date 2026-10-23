// The business OS: the catalogue, module records, channels, @mentions that ask an agent, and its reply.
import { describe, it, expect, vi, afterEach } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import worker from "../../apps/api/src/index";
import { sha256Hex } from "../../packages/core/util";
import { AREAS, FACETS, KINDS, ROLES, facet, modulesFor, roleInstructions } from "../../packages/core/os";
import { PLANS } from "../../packages/core/templates";
import { runAgent } from "../../apps/api/src/lib/agents";
import { getTool, runTool } from "../../apps/api/src/lib/tools";
import { specFor } from "../../apps/api/src/lib/swarm";
import { ORG_TABLES } from "../../apps/api/src/lib/jobs";
import { findMentions } from "../../apps/api/src/lib/os";

afterEach(() => vi.restoreAllMocks());

async function signedIn(role = "owner", vars: Record<string, string> = {}) {
  const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0", ...vars });
  const org = seedOrg(raw);
  raw.prepare("UPDATE membership SET role = ?").run(role);
  raw.prepare("UPDATE user SET name = 'Dana Price'").run();
  raw.prepare("INSERT INTO session (id_hash, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)").run(await sha256Hex("sid_1"), org.user, org.id, new Date(Date.now() + 864e5).toISOString());
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request("https://ah.test/api/ws" + path, { ...init, headers: { Cookie: "ah_session=sid_1", "Content-Type": "application/json", ...(init.headers || {}) } }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  const post = (path: string, b: unknown) => call(path, { method: "POST", body: JSON.stringify(b) });
  return { raw, env, org, call, post };
}
const claudeSays = (text: string) => vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 50, output_tokens: 20 } }), { status: 200 }));

describe("the catalogue", () => {
  it("covers every facet of the matrix: 17 areas, 118 modules, each with a kind, a depth and a home", () => {
    expect(AREAS).toHaveLength(17);
    expect(FACETS).toHaveLength(118);
    expect(new Set(FACETS.map((f) => f.key)).size).toBe(118);
    for (const a of AREAS) expect(FACETS.some((f) => f.area === a.key)).toBe(true);
    for (const f of FACETS) {
      expect(KINDS[f.kind], f.key).toBeTruthy();
      expect(["full", "partial", "basic"]).toContain(f.depth);
      if (f.link) expect(f.link.startsWith("/"), f.key).toBe(true);
    }
    expect(FACETS.filter((f) => f.depth === "full")).toHaveLength(6);
    expect(FACETS.filter((f) => f.depth === "partial")).toHaveLength(34);
  });
  it("every module but whistleblowing has an agent role, and every role's standing orders name its modules", () => {
    expect(facet("whistleblowing")!.agent).toBeNull();
    expect(FACETS.filter((f) => !f.agent).map((f) => f.key)).toEqual(["whistleblowing"]);
    for (const r of ROLES) {
      const text = roleInstructions(r);
      for (const m of modulesFor(r)) expect(text).toContain(`module "${m.key}"`);
    }
    expect(modulesFor("Payables agent").map((f) => f.key).sort()).toEqual(["bills-and-payables", "supplier-payments"]);
  });
  it("is priced per business: every plan has the whole OS and room for 100 agents", () => {
    for (const k of ["starter", "growth", "scale", "trial"]) expect(PLANS[k].agents).toBe(100);
    expect([PLANS.starter.name, PLANS.growth.name, PLANS.scale.name]).toEqual(["Solo", "Team", "Business"]);
  });
  it("the workspace catalogue counts each module's records", async () => {
    const { post, call } = await signedIn();
    await post("/os/m/bills-and-payables/records", { title: "Office rent", fields: { party: "Landlord", amount: "1,250.00", due_date: "2026-11-01" } });
    const j: any = await (await call("/os/catalogue")).json();
    expect(j.modules).toHaveLength(118);
    expect(j.modules.find((m: any) => m.key === "bills-and-payables")).toMatchObject({ records: 1, open: 1, agent: "Payables agent", agent_id: null });
    expect(j.totals).toMatchObject({ modules: 118, records: 1 });
  });
});

describe("module records", () => {
  it("are created, read, updated and listed with the kind's own fields", async () => {
    const { post, call } = await signedIn();
    const res = await post("/os/m/bills-and-payables/records", { title: "Office rent", fields: { party: "Landlord", amount: "£1,250.50", due_date: "2026-11-01", notes: "Quarterly", nonsense: "dropped" } });
    expect(res.status).toBe(201);
    const { record }: any = await res.json();
    expect(record).toMatchObject({ module: "bills-and-payables", status: "draft", amount_pence: 125050, party: "Landlord", due_date: "2026-11-01" });
    expect(record.fields).toMatchObject({ notes: "Quarterly", amount: 1250.5 });
    expect(record.fields.nonsense).toBeUndefined();
    const up: any = await (await call(`/os/records/${record.id}`, { method: "PATCH", body: JSON.stringify({ status: "paid" }) })).json();
    expect(up.record).toMatchObject({ status: "paid", party: "Landlord", amount_pence: 125050 });
    expect(((await (await call("/os/m/bills-and-payables/records?status=paid")).json()) as any).records).toHaveLength(1);
    expect(((await (await call("/os/m/bills-and-payables/records?q=land")).json()) as any).records).toHaveLength(1);
    expect(((await (await call("/os/m/bills-and-payables/records?status=draft")).json()) as any).records).toHaveLength(0);
  });
  it("refuse a status, date or amount the module doesn't allow, and an unknown module", async () => {
    const { post } = await signedIn();
    expect((await post("/os/m/bills-and-payables/records", { title: "x", status: "won" })).status).toBe(400);
    expect((await post("/os/m/bills-and-payables/records", { title: "x", fields: { due_date: "next week" } })).status).toBe(400);
    expect((await post("/os/m/bills-and-payables/records", { title: "x", fields: { amount: "lots" } })).status).toBe(400);
    expect((await post("/os/m/no-such-module/records", { title: "x" })).status).toBe(404);
    expect((await post("/os/m/contracts-and-e-signature/records", { title: "MSA", fields: { link: "javascript:alert(1)" } })).status).toBe(400);
  });
  it("every one of the 118 modules takes a record of its own kind", async () => {
    const { post } = await signedIn();
    for (const f of FACETS) {
      const res = await post(`/os/m/${f.key}/records`, { title: `First ${f.app} record` });
      expect(res.status, f.key).toBe(201);
      expect(((await res.json()) as any).record.status).toBe(KINDS[f.kind].statuses[0]);
    }
  });
  it("a viewer can read and talk, but not change records", async () => {
    const { post, call } = await signedIn("viewer");
    expect((await post("/os/m/bills-and-payables/records", { title: "x" })).status).toBe(403);
    expect((await call("/os/m/bills-and-payables/records")).status).toBe(200);
    const ch: any = await (await call("/os/channels")).json();
    expect((await post(`/os/channels/${ch.channels[0].id}/messages`, { body: "Morning all" })).status).toBe(201);
  });
  it("deleting a record removes its thread too", async () => {
    const { raw, post, call } = await signedIn();
    const { record }: any = await (await post("/os/m/complaints/records", { title: "Late delivery" })).json();
    await post(`/os/records/${record.id}/messages`, { body: "Called them back" });
    expect((await call(`/os/records/${record.id}`, { method: "DELETE" })).status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM os_message").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM os_channel WHERE kind = 'record'").get()).toEqual({ n: 0 });
  });
});

describe("channels: people and agents in one conversation", () => {
  it("a workspace starts with team channels, and a manager can add one", async () => {
    const { call, post } = await signedIn();
    const j: any = await (await call("/os/channels")).json();
    expect(j.channels.map((c: any) => c.name)).toEqual(["general", "finance", "operations", "people", "sales"]);
    expect((await post("/os/channels", { name: "#Site Team" })).status).toBe(201);
    expect((await post("/os/channels", { name: "site-team" })).status).toBe(409);
  });

  it("an @mention hires the role's agent, asks it with the message, and its answer comes back to the channel", async () => {
    const { raw, env, org, call, post } = await signedIn();
    const general = ((await (await call("/os/channels")).json()) as any).channels[0];
    const res = await post(`/os/channels/${general.id}/messages`, { body: "@Payables agent what do we owe this week?" });
    expect(res.status).toBe(201);
    const j: any = await res.json();
    expect(j.message.mentions).toEqual(["Payables agent"]);
    expect(j.asked).toHaveLength(1);
    const agent = raw.prepare("SELECT * FROM agent WHERE id = ?").get(j.asked[0].agent_id) as any;
    expect(agent).toMatchObject({ template: "os", name: "Payables agent", rhythm: "on_demand", next_run_at: null });
    const spec = specFor(agent)!;
    expect(spec.tools).toEqual(expect.arrayContaining(["os-records", "os-save", "create-task"]));
    expect(spec.instructions).toContain('module "bills-and-payables"');
    const runRow = raw.prepare("SELECT * FROM agent_run WHERE id = ?").get(j.asked[0].run_id) as any;
    expect(runRow).toMatchObject({ reply_channel: general.id, status: "queued" });
    expect(runRow.input).toContain("Dana Price asked you in #general");

    claudeSays("You owe £1,250 to the landlord on Friday. Nothing else is due.");
    expect(await runAgent(env, runRow.id)).toBe("done");
    const msgs: any = await (await call(`/os/channels/${general.id}/messages`)).json();
    expect(msgs.messages.map((m: any) => [m.author_kind, m.author_name])).toEqual([["person", "Dana Price"], ["agent", "Payables agent"]]);
    expect(msgs.messages[1].body).toContain("£1,250");
    // Asking again uses the same agent.
    await post(`/os/channels/${general.id}/messages`, { body: "thanks @payables agent, and next week?" });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM agent WHERE org_id = ? AND template = 'os'").get(org.id)).toEqual({ n: 1 });
    // Paging forward from the last message the client has.
    const after: any = await (await call(`/os/channels/${general.id}/messages?after=${encodeURIComponent(msgs.messages[1].at)}`)).json();
    expect(after.messages.map((m: any) => m.body)).toEqual(["thanks @payables agent, and next week?"]);
  });

  it("asking on a record's thread gives the agent the record", async () => {
    const { raw, post } = await signedIn();
    const { record }: any = await (await post("/os/m/complaints/records", { title: "Scratched worktop", fields: { party: "Mrs Okafor" } })).json();
    const j: any = await (await post(`/os/records/${record.id}/messages`, { body: "@Complaints triage draft a reply plan" })).json();
    const r = raw.prepare("SELECT input, reply_channel FROM agent_run WHERE id = ?").get(j.asked[0].run_id) as any;
    expect(r.input).toContain("on a record's thread");
    expect(r.input).toContain("Mrs Okafor");
    expect(r.reply_channel).toBeTruthy();
  });

  it("a failed run says so in the channel, and a paused agent isn't asked", async () => {
    const { raw, env, call, post } = await signedIn();
    const ch = ((await (await call("/os/channels")).json()) as any).channels[0];
    const j: any = await (await post(`/os/channels/${ch.id}/messages`, { body: "@Bookkeeper reconcile last week" })).json();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("down", { status: 500 }));
    expect(await runAgent(env, j.asked[0].run_id)).toBe("failed");
    raw.prepare("UPDATE agent SET status = 'paused' WHERE id = ?").run(j.asked[0].agent_id);
    const k: any = await (await post(`/os/channels/${ch.id}/messages`, { body: "@Bookkeeper try again" })).json();
    expect(k.asked[0].error).toMatch(/paused/);
    const msgs: any = await (await call(`/os/channels/${ch.id}/messages`)).json();
    expect(msgs.messages.map((m: any) => m.author_kind)).toEqual(["person", "agent", "person", "system"]);
    expect(msgs.messages[1].body).toMatch(/^I couldn't finish that/);
  });

  it("mentions match the longest name, a business's own agents first, at most three a message", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    seedAgent(raw, org.id); // "Outreach", a catalogue agent the business already has
    const m = await findMentions(env, org.id, "@Outreach and @Credit control and @Bookkeeper and @Payroll preparer");
    expect(m.map((x) => x.name)).toEqual(["Payroll preparer", "Credit control", "Bookkeeper"]);
    expect((await findMentions(env, org.id, "@Outreach please"))[0]).toMatchObject({ name: "Outreach", agent_id: "agt_1" });
    expect(await findMentions(env, org.id, "email me at dana@brightwork.example")).toEqual([]);
  });

  it("an OS agent can't be hired past the plan's agents", async () => {
    const { raw, org, call, post } = await signedIn();
    for (let i = 0; i < 100; i++) seedAgent(raw, org.id, { id: "agt_f" + i, template: "research" });
    const ch = ((await (await call("/os/channels")).json()) as any).channels[0];
    const j: any = await (await post(`/os/channels/${ch.id}/messages`, { body: "@Bookkeeper hello" })).json();
    expect(j.asked[0].error).toMatch(/100 agents/);
  });

  it("the directory lists people and every agent, hired or not", async () => {
    const { call } = await signedIn();
    const d: any = await (await call("/os/directory")).json();
    expect(d.people).toEqual([expect.objectContaining({ name: "Dana Price", role: "owner" })]);
    expect(d.agents.length).toBe(ROLES.length);
  });
});

describe("OS agents' tools", () => {
  it("an agent saves records only in its own modules, and reads any", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    raw.prepare("INSERT INTO agent (id, org_id, template, name, brief, settings, rhythm, created_at) VALUES ('agt_os', ?, 'os', 'Payables agent', 'b', ?, 'on_demand', ?)").run(org.id, JSON.stringify({ role: "Payables agent" }), new Date().toISOString());
    const ctx = { env, orgId: org.id, agentId: "agt_os", runId: "run_t" };
    const save = (await getTool(env, "os-save", { business: true }))!;
    const list = (await getTool(env, "os-records", { business: true }))!;
    const ok: any = await runTool(ctx, save, { module: "supplier-payments", title: "Pay Acme", fields: { party: "Acme", amount: 300 } });
    expect(ok.result ?? ok).toMatchObject({ saved: true });
    const no: any = await runTool(ctx, save, { module: "payroll", title: "Pay everyone double" }).catch((e) => e);
    expect(JSON.stringify(no)).toMatch(/not_your_module|ask the agent/);
    const read: any = await runTool(ctx, list, { module: "supplier-payments" });
    expect(JSON.stringify(read)).toContain("Pay Acme");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM os_record WHERE module = 'payroll'").get()).toEqual({ n: 0 });
  });
});

describe("one task list for people and agents", () => {
  it("a task can be given to a person in the workspace, and they can see theirs", async () => {
    const { org, post, call } = await signedIn();
    expect((await post("/tasks", { title: "Sign the lease", assignee_user_id: "usr_nobody" })).status).toBe(400);
    const { id }: any = await (await post("/tasks", { title: "Sign the lease", assignee_user_id: org.user })).json();
    await post("/tasks", { title: "Unassigned thing" });
    const mine: any = await (await call("/tasks?mine=1")).json();
    expect(mine.tasks.map((t: any) => [t.title, t.assignee_name])).toEqual([["Sign the lease", "Dana Price"]]);
    expect((await call(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ assignee_user_id: null }) })).status).toBe(200);
    expect((await call(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) })).status).toBe(200);
    const all: any = await (await call("/tasks")).json();
    expect(all.tasks.find((t: any) => t.id === id)).toMatchObject({ status: "done", assignee_user_id: null });
  });
  it("a cancelled business's OS data is purged with the rest", () => {
    expect(ORG_TABLES).toEqual(expect.arrayContaining(["os_record", "os_channel", "os_message"]));
  });
});
