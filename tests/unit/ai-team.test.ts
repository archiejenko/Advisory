// The AI Team: the persona catalogue, one agent_log row per event, the 30-day backfill, and the log endpoint.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { testEnv, seedOrg, seedAgent } from "./d1";
import worker from "../../apps/api/src/index";
import { sha256Hex } from "../../packages/core/util";
import { PERSONAS, DEPARTMENTS, persona, personaForTemplate, personaView } from "../../packages/core/personas";
import { TEMPLATES, ORCHESTRATOR, template } from "../../packages/core/templates";
import { MODE_ORDER } from "../../config/model-pricing";
import { runAgent, sweepRuns, hireAgent } from "../../apps/api/src/lib/agents";
import { queueRun } from "../../apps/api/src/lib/swarm";
import { proposeEmail, executeAction, rejectAction } from "../../apps/api/src/lib/actions";
import { chargeRun } from "../../apps/api/src/lib/credits";
import { addRule, decideRule } from "../../apps/api/src/lib/today";
import { createSwarm } from "../../apps/api/src/lib/engine";
import { orgState } from "../../apps/api/src/lib/org";
import { preset } from "../../packages/core/swarms";
import { runTool, getTool } from "../../apps/api/src/lib/tools";
import { logEvent } from "../../apps/api/src/lib/agentlog";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const MIGRATION = readFileSync(new URL("../../migrations/0011_ai_team.sql", import.meta.url), "utf8");
const BACKFILL = readFileSync(new URL("../../scripts/backfill-agent-log.sql", import.meta.url), "utf8");
const logRows = (raw: any, where = "1 = 1", ...args: any[]) => raw.prepare(`SELECT * FROM agent_log WHERE ${where} ORDER BY id`).all(...args) as any[];
const none = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

describe("the persona catalogue", () => {
  it("has 25 personas, each complete and in range", () => {
    expect(PERSONAS).toHaveLength(25);
    expect(new Set(PERSONAS.map((p) => p.key)).size).toBe(25);
    expect(new Set(PERSONAS.map((p) => p.name)).size).toBe(25);
    for (const p of PERSONAS) {
      expect(DEPARTMENTS, p.key).toContain(p.department);
      expect(p.role && p.mission, p.key).toBeTruthy();
      for (const v of [p.personality.formal, p.personality.detail, p.personality.proactive]) expect(v >= 0 && v <= 100, p.key).toBe(true);
      expect(p.personality.traits, p.key).toHaveLength(2);
      expect(Number.isInteger(p.hue) && p.hue >= 1 && p.hue <= 8, p.key).toBe(true);
      expect(p.kpis.length >= 2 && p.kpis.length <= 3, p.key).toBe(true);
      expect(Number.isInteger(p.startLevel) && p.startLevel >= 0 && p.startLevel <= 4, p.key).toBe(true);
      expect(MODE_ORDER, p.key).toContain(p.defaultMode);
      if (p.engine) expect(template(p.engine), p.key).toBeTruthy();
      for (const a of p.abilities || []) expect(template(a), p.key).toBeTruthy();
    }
    for (const d of DEPARTMENTS) expect(PERSONAS.some((p) => p.department === d), d).toBe(true);
  });

  it("is live only where its engine is a live template", () => {
    for (const p of PERSONAS) expect(p.status, p.key).toBe(p.engine && template(p.engine)!.status === "live" ? "live" : "next");
    expect(PERSONAS.filter((p) => p.status === "live").map((p) => p.key).sort()).toEqual(["ava", "clara", "felix", "grace", "iris", "isla", "leo", "maya"]);
    expect(["kai", "ruby", "ollie", "finn", "theo", "zara", "sam"].every((k) => persona(k)!.status === "next")).toBe(true);
  });

  it("matches the brief's engines and modes", () => {
    const want: Record<string, [string | null, string, number]> = {
      ava: ["orchestrator", "standard", 2], theo: [null, "strategy", 1], iris: ["research", "deep", 2], leo: ["lead-finder", "quick", 2], maya: ["outreach", "standard", 1],
      ravi: [null, "standard", 1], zara: [null, "standard", 1], kai: ["social", "standard", 1], luca: [null, "standard", 1], ella: [null, "standard", 1],
      sam: [null, "quick", 2], ruby: ["bookings", "quick", 2], ollie: ["reviews", "quick", 2], grace: ["customer-watch", "standard", 1], finn: ["bookkeeping", "quick", 2],
      clara: ["credit-control", "quick", 2], max: [null, "deep", 1], hugo: [null, "quick", 1], jade: [null, "standard", 2], eli: [null, "standard", 1],
      mia: [null, "quick", 2], owen: [null, "quick", 2], hannah: [null, "standard", 1], isla: ["inbox", "quick", 1], felix: ["customer-check", "deep", 0],
    };
    for (const p of PERSONAS) expect([p.engine, p.defaultMode, p.startLevel], p.key).toEqual(want[p.key]);
    expect(persona("ava")!.abilities).toEqual(["briefing"]);
  });

  it("every template maps to a persona, and the migration maps existing agents the same way", () => {
    const sqlMap = Object.fromEntries([...MIGRATION.matchAll(/WHEN '([a-z-]+)' THEN '([a-z]+)'/g)].map((m) => [m[1], m[2]]));
    for (const t of [...TEMPLATES, ORCHESTRATOR]) {
      expect(personaForTemplate(t.key)?.key, t.key).toBeTruthy();
      expect(sqlMap[t.key], t.key).toBe(personaForTemplate(t.key)!.key);
    }
    expect(personaForTemplate("briefing")!.key).toBe("ava");
    expect(personaForTemplate("custom")).toBeUndefined();
  });

  it("an owner's overrides change the face, never the engine", () => {
    const v = personaView({ persona: "maya", template: "outreach", persona_overrides: JSON.stringify({ name: "Maya B", hue: 6, engine: "inbox", status: "live" }) })!;
    expect(v).toMatchObject({ key: "maya", name: "Maya B", hue: 6, role: "Sales Executive" });
    expect(v).not.toHaveProperty("engine");
    expect(personaView({ persona: null, template: "custom" })).toBeNull();
  });
});

describe("hiring sets the persona", () => {
  it("a hired agent wears its template's persona", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const id = await hireAgent(env, org.id, org.user, { template: "credit-control" });
    expect((raw.prepare("SELECT persona FROM agent WHERE id = ?").get(id) as any).persona).toBe("clara");
  });
});

describe("the agent log: one row per event", () => {
  const steps = (contents: any[][]) => {
    let n = 0;
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const content = contents[Math.min(n++, contents.length - 1)];
      return new Response(JSON.stringify({ content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 });
    });
  };

  it("a run logs its start, a tool error, its cost and its finish, once each however often it's retried", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0" });
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { template: "research" });
    steps([[{ type: "tool_use", id: "t1", name: "read-page", input: { url: "not a url" } }], [{ type: "text", text: "Acme is a joinery.\nMore detail." }]]);
    const runId = await queueRun(env, org.id, agent, "manual", "Who is Acme?");
    expect(await runAgent(env, runId)).toBe("done");
    expect(await runAgent(env, runId)).toBe("skipped");
    const rows = logRows(raw, "run_id = ?", runId);
    expect(rows.map((r) => [r.type, r.ref])).toEqual([
      ["action", `run:${runId}:start`], ["error", `run:${runId}:tool:0`], ["action", `run:${runId}:end`], ["cost", `cost:run:${runId}`],
    ]);
    expect(rows[2].summary).toBe("Finished: Acme is a joinery.");
    expect(rows[3].credits).toBeGreaterThan(0);
    expect(JSON.parse(rows[0].linked)).toEqual({ run: runId });
  });

  it("a failed run logs an error, and the sweep doesn't add a second end", async () => {
    const { raw, env } = testEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_RETRIES: "0" });
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { template: "research" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("down", { status: 500 }));
    const runId = await queueRun(env, org.id, agent, "manual", "Who is Acme?");
    expect(await runAgent(env, runId)).toBe("failed");
    raw.prepare("UPDATE agent_run SET status = 'running', started_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(runId);
    await sweepRuns(env);
    expect(logRows(raw, "ref = ?", `run:${runId}:end`)).toEqual([expect.objectContaining({ type: "error" })]);
  });

  it("a draft logs its proposal and one decision, whether approved, rejected or tried twice", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { autonomy: "approve_all" });
    const a = await proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "hi@co.test", subject: "Hello", body: "Hi" });
    const b = await proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "yo@co.test", subject: "Hey", body: "Hi" });
    await executeAction(env, org.id, a.action_id, "owner@biz.test");
    await expect(executeAction(env, org.id, a.action_id, "owner@biz.test")).rejects.toMatchObject({ code: "already_decided" });
    await rejectAction(env, org.id, b.action_id, "owner@biz.test");
    await expect(rejectAction(env, org.id, b.action_id, "owner@biz.test")).rejects.toMatchObject({ code: "already_decided" });
    expect(logRows(raw, "action_id = ?", a.action_id).map((r) => [r.type, r.ref])).toEqual([["approval", `action:${a.action_id}:proposed`], ["decision", `action:${a.action_id}:decided`]]);
    expect(logRows(raw, "action_id = ?", b.action_id).map((r) => [r.type, r.summary])).toEqual([["approval", "Drafted an email to yo@co.test: Hey"], ["decision", `Rejected by owner@biz.test: Email yo@co.test: Hey`]]);
  });

  it("an auto-sent draft is logged as the agent's own action", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { autonomy: "auto" });
    raw.prepare("INSERT INTO invoice (id, org_id, ref, customer, email, amount_pence, due_date, created_at) VALUES ('inv_1', ?, 'INV-1', 'Acme', 'ap@acme.test', 1000, '2026-01-01', '2026-01-01')").run(org.id);
    const a = await proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "ap@acme.test", subject: "Invoice INV-1", body: "A reminder.", invoice_id: "inv_1" });
    expect(a.status).not.toBe("waiting_for_approval");
    expect(logRows(raw, "ref = ?", `action:${a.action_id}:decided`)).toEqual([expect.objectContaining({ type: "action", summary: expect.stringMatching(/^Sent on its own/) })]);
  });

  it("a task handed to a teammate is one handoff row", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const r = await createSwarm(env, org.id, org.user, preset("sales-floor")!.blueprint, { preset: "sales-floor" });
    const o = (await orgState(env, org.id, r.id)).root!;
    const t = await runTool({ env, orgId: org.id, agentId: o, runId: "run_o1" }, (await getTool(env, "assign-task", { business: true }))!, { to: "outreach", title: "Write to Peel Street" });
    expect(logRows(raw, "type = 'handoff'")).toEqual([expect.objectContaining({ agent_id: o, ref: `task:${t.task_id}`, summary: "Gave Outreach a task: Write to Peel Street" })]);
  });

  it("each credit charge is one cost row, and a re-charge of the same run adds nothing", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const charge = () => chargeRun(env, { orgId: org.id, runId: "run_x", agentId: "agt_1", model: "claude-sonnet-5-5", mode: "standard", cost: 3.2, tokens: none, requests: 1 });
    await charge(); await charge();
    expect(logRows(raw, "type = 'cost'")).toEqual([expect.objectContaining({ ref: "cost:run:run_x", agent_id: "agt_1", mode: "standard" })]);
  });

  it("a rule learned from an edit is logged against the agent that drafted it, and again when the owner adopts it", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id, { autonomy: "approve_all" });
    const a = await proposeEmail(env, { orgId: org.id, agentId: agent }, { to: "hi@co.test", subject: "Hello", body: "Hi" });
    const r = await addRule(env, org.id, "Sign off with first names only", "owner@biz.test", "edit", a.action_id);
    await decideRule(env, org.id, r.id, "owner@biz.test", { status: "active" });
    await decideRule(env, org.id, r.id, "owner@biz.test", { text: "Sign off with first names" });
    expect((raw.prepare("SELECT agent_id FROM house_rule WHERE id = ?").get(r.id) as any).agent_id).toBe(agent);
    expect(logRows(raw, "type = 'learning'").map((x) => [x.agent_id, x.ref])).toEqual([[agent, `rule:${r.id}:proposed`], [agent, `rule:${r.id}:active`]]);
  });

  it("logEvent never throws, and writes an event once", async () => {
    const { raw, env } = testEnv();
    await logEvent(env, { orgId: "org_a", type: "action", summary: "x", ref: "r1" });
    await logEvent(env, { orgId: "org_a", type: "action", summary: "x again", ref: "r1" });
    await expect(logEvent(env, { orgId: "org_a", type: "nonsense" as any, summary: "x", ref: "r2" })).resolves.toBeUndefined();
    expect(logRows(raw).map((r) => r.summary)).toEqual(["x"]);
  });
});

describe("the 30-day backfill", () => {
  it("copies runs, drafts, decisions, costs, rules and handoffs from the last 30 days, and a re-run adds nothing", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id);
    const recent = new Date(Date.now() - 3 * 864e5).toISOString(), old = new Date(Date.now() - 40 * 864e5).toISOString();
    const ins = (sql: string, ...a: any[]) => raw.prepare(sql).run(...a);
    for (const [id, at] of [["run_new", recent], ["run_old", old]]) {
      ins("INSERT INTO agent_run (id, org_id, agent_id, trigger, status, steps, summary, mode, credits, created_at, started_at, finished_at) VALUES (?,?,?,'schedule','done',2,'Chased 3 invoices\nDetail','quick',1.5,?,?,?)", id, org.id, agent, at, at, at);
      ins("INSERT INTO agent_action (id, org_id, agent_id, run_id, kind, title, payload, status, decided_by, decided_at, created_at) VALUES (?,?,?,?,'email','Email a@b.test: Hi','{}','sent','owner@x.test',?,?)", "act_" + id, org.id, agent, id, at, at);
      ins("INSERT INTO credit_entry (id, org_id, kind, credits, period, agent_id, run_id, mode, ref, at) VALUES (?,?,'run',-1.5,'2026-10',?,?,'quick',?,?)", "cr_" + id, org.id, agent, id, id, at);
    }
    ins("INSERT INTO agent_action (id, org_id, agent_id, kind, title, payload, status, created_at) VALUES ('act_wait',?,?,'email','Email c@d.test: Yo','{}','proposed',?)", org.id, agent, recent);
    ins("INSERT INTO house_rule (id, org_id, text, source, status, created_by, created_at) VALUES ('hr_1',?,'No emails on Sundays','owner','active','owner@x.test',?)", org.id, recent);
    ins("INSERT INTO swarm_event (org_id, swarm_id, agent_id, run_id, item_id, kind, summary, detail, at) VALUES (?,'sw_1',?,'run_new','itm_1','handoff','Outreach handed Acme to Inbox','{\"to_agent\":\"agt_2\",\"stage\":\"Contacted\"}',?)", org.id, agent, recent);
    ins("INSERT INTO swarm_event (org_id, swarm_id, agent_id, run_id, kind, summary, detail, at) VALUES (?,'sw_1',?,'run_new','task','Lead gave Outreach: Write','{\"task_id\":\"tsk_1\",\"to_agent\":\"agt_2\"}',?)", org.id, agent, recent);
    ins("INSERT INTO swarm_event (org_id, swarm_id, agent_id, run_id, kind, summary, detail, at) VALUES (?,'sw_1',?,'run_new','tool','read-page','{\"ok\":false}',?)", org.id, agent, recent);
    ins("INSERT INTO swarm_event (org_id, swarm_id, agent_id, run_id, kind, summary, at) VALUES (?,'sw_1',?,'run_new','run_done','Finished',?)", org.id, agent, recent);

    raw.exec(BACKFILL);
    const first = logRows(raw);
    expect(first.map((r) => r.ref).sort()).toEqual([
      "action:act_run_new:decided", "action:act_run_new:proposed", "action:act_wait:proposed", "cost:run:run_new",
      "rule:hr_1:added", "run:run_new:end", "run:run_new:start", "swarm_event:1", "swarm_event:3", "task:tsk_1",
    ]);
    expect(first.find((r) => r.ref === "run:run_new:end")).toMatchObject({ type: "action", summary: "Finished: Chased 3 invoices", credits: 1.5 });
    expect(first.find((r) => r.ref === "cost:run:run_new")).toMatchObject({ type: "cost", credits: 1.5, summary: "Used 1.5 credits (quick)" });
    expect(first.find((r) => r.ref === "action:act_run_new:decided")).toMatchObject({ type: "decision", summary: "Approved by owner@x.test: Email a@b.test: Hi" });
    raw.exec(BACKFILL);
    expect(logRows(raw)).toEqual(first);
  });

  it("doesn't copy a run that live logging already recorded", async () => {
    const { raw, env } = testEnv();
    const org = seedOrg(raw);
    const agent = seedAgent(raw, org.id);
    const at = new Date(Date.now() - 864e5).toISOString();
    raw.prepare("INSERT INTO agent_run (id, org_id, agent_id, trigger, status, created_at, started_at) VALUES ('run_1',?,?,'manual','running',?,?)").run(org.id, agent, at, at);
    await logEvent(env, { orgId: org.id, agentId: agent, type: "action", summary: "Started (asked)", runId: "run_1", ref: "run:run_1:start" });
    raw.exec(BACKFILL);
    expect(logRows(raw).map((r) => r.ref)).toEqual(["run:run_1:start"]);
  });
});

describe("GET /my-agents/:id/log", () => {
  async function twoBusinesses() {
    const { raw, env } = testEnv();
    const a = seedOrg(raw, { id: "org_a" }), b = seedOrg(raw, { id: "org_b" });
    seedAgent(raw, a.id, { id: "agt_a" });
    seedAgent(raw, b.id, { id: "agt_b" });
    for (const o of [a, b]) raw.prepare("INSERT INTO session (id_hash, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)").run(await sha256Hex("sid_" + o.id), o.user, o.id, new Date(Date.now() + 864e5).toISOString());
    const as = (o: { id: string }) => (path: string) => worker.fetch(new Request("https://ah.test/api/ws" + path, { headers: { Cookie: "ah_session=sid_" + o.id } }), env, { waitUntil() {}, passThroughOnException() {} } as any);
    const types = ["action", "approval", "decision", "cost", "error"] as const;
    for (let i = 0; i < 12; i++) {
      await logEvent(env, { orgId: a.id, agentId: "agt_a", type: types[i % types.length], summary: `A${i}`, runId: `run_${i % 3}`, linked: { run: `run_${i % 3}`, action: i === 4 ? "act_9" : undefined }, ref: `a${i}`, at: `2026-10-${String(10 + i).padStart(2, "0")}T12:00:00.000Z` });
    }
    await logEvent(env, { orgId: b.id, agentId: "agt_b", type: "action", summary: "B0", ref: "b0" });
    return { raw, env, a: as(a), b: as(b), anon: (path: string) => worker.fetch(new Request("https://ah.test/api/ws" + path), env, { waitUntil() {}, passThroughOnException() {} } as any) };
  }

  it("a business reads only its own agents' logs", async () => {
    const { a, b, anon } = await twoBusinesses();
    expect((await anon("/my-agents/agt_a/log")).status).toBe(401);
    expect((await b("/my-agents/agt_a/log")).status).toBe(404);
    expect((await a("/my-agents/agt_b/log")).status).toBe(404);
    const own: any = await (await b("/my-agents/agt_b/log")).json();
    expect(own.entries.map((e: any) => e.summary)).toEqual(["B0"]);
  });

  it("filters by type, date and link, and pages newest first", async () => {
    const { a } = await twoBusinesses();
    const j = async (q: string) => (await (await a("/my-agents/agt_a/log" + q)).json()) as any;
    const p1 = await j("?limit=5");
    expect(p1.entries.map((e: any) => e.summary)).toEqual(["A11", "A10", "A9", "A8", "A7"]);
    const p2 = await j(`?limit=5&cursor=${p1.next_cursor}`);
    const p3 = await j(`?limit=5&cursor=${p2.next_cursor}`);
    expect([...p2.entries, ...p3.entries].map((e: any) => e.summary)).toEqual(["A6", "A5", "A4", "A3", "A2", "A1", "A0"]);
    expect(p3.next_cursor).toBeNull();
    expect((await j("?type=cost,error")).entries.map((e: any) => e.summary)).toEqual(["A9", "A8", "A4", "A3"]);
    expect((await j("?from=2026-10-15&to=2026-10-16")).entries.map((e: any) => e.summary)).toEqual(["A6", "A5"]);
    expect((await j("?linked=run:run_1")).entries.map((e: any) => e.summary)).toEqual(["A10", "A7", "A4", "A1"]);
    expect((await j("?linked=action:act_9")).entries).toEqual([expect.objectContaining({ summary: "A4", linked: { run: "run_1", action: "act_9" } })]);
    expect((await a("/my-agents/agt_a/log?type=nope")).status).toBe(400);
    expect((await a("/my-agents/agt_a/log?linked=x")).status).toBe(400);
    expect((await a("/my-agents/agt_a/log?cursor=1;DROP")).status).toBe(400);
  });

  it("agent responses carry the persona", async () => {
    const { a } = await twoBusinesses();
    const list: any = await (await a("/my-agents")).json();
    expect(list.agents[0]).toMatchObject({ persona: null, persona_view: { key: "maya", name: "Maya", department: "Sales", status: "live" } });
    const one: any = await (await a("/my-agents/agt_a")).json();
    expect(one.agent.persona_view.kpis.length).toBeGreaterThanOrEqual(2);
  });
});
