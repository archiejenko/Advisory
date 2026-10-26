// The org chart: badge rules (shared with the website), saving changes, tasks down the tree, and goals.
import { describe, it, expect } from "vitest";
import { testEnv, seedOrg, seedAgent } from "./d1";
import { preset } from "../../packages/core/swarms";
import { applyOrgChanges, defaultBadges, toolsFor, type OrgAgent } from "../../packages/core/badges";
import { createSwarm, ask, previewFor } from "../../apps/api/src/lib/engine";
import { orgState, applyOrg, ownerTask } from "../../apps/api/src/lib/org";
import { settleTasksForRun } from "../../apps/api/src/lib/orgbase";
import { specFor } from "../../apps/api/src/lib/swarm";
import { runTool, getTool } from "../../apps/api/src/lib/tools";

const team = (): OrgAgent[] => [
  { id: "o", name: "Orchestrator", role: "orchestrator", skills: ["planning", "reporting"], autonomy: "approve_all", rhythm: "weekdays", reports_to: null },
  { id: "p", name: "Prospector", role: "prospector", skills: ["prospecting"], autonomy: "approve_all", rhythm: "weekdays", reports_to: "o", stages: ["Found"] },
  { id: "w", name: "Outreach", role: "writer", skills: ["email", "research"], autonomy: "approve_all", rhythm: "weekdays", reports_to: "o" },
  { id: "i", name: "Inbox", role: "inbox-keeper", skills: ["inbox", "email"], autonomy: "approve_first", rhythm: "on_event", reports_to: "o" },
  { id: "x", name: "Customer watch", role: "register", skills: [], autonomy: "approve_all", rhythm: "on_event", reports_to: "o", locked: true },
];
const lim = { agents_used: 4, agents_allowed: 6 };
const refuse = (changes: any[], re: RegExp, limits = lim) => { const r = applyOrgChanges(team(), changes, limits); expect(r.ok).toBe(false); expect((r as any).error).toMatch(re); };

describe("badge rules", () => {
  it("a role brings the skills it needs; a skill can move unless the giver's role needs it", () => {
    const r = applyOrgChanges(team(), [{ op: "role", agent: "w", value: "credit-controller" }, { op: "skill", agent: "i", value: "research", from: "w" }], lim) as any;
    expect(r.ok).toBe(true);
    expect(r.agents.find((a: any) => a.id === "w")).toMatchObject({ role: "credit-controller", skills: ["email", "cash"] });
    expect(r.agents.find((a: any) => a.id === "i").skills).toContain("research");
    expect(r.summaries[0]).toMatch(/Outreach is now a Credit controller \(\+Cash\)/);
    refuse([{ op: "skill", agent: "i", value: "prospecting", from: "p" }], /Prospector's role needs Prospecting/);
    refuse([{ op: "unskill", agent: "w", value: "email" }], /role needs Email/);
  });
  it("keeps the orchestrator at the top, planning for leaders, register agents fixed", () => {
    refuse([{ op: "role", agent: "o", value: "writer" }], /role is fixed/);
    refuse([{ op: "role", agent: "w", value: "orchestrator" }], /one orchestrator/);
    refuse([{ op: "autonomy", agent: "o", value: "auto" }], /never sends email/);
    refuse([{ op: "skill", agent: "w", value: "planning" }], /Planning is for the orchestrator and Lead/);
    refuse([{ op: "skill", agent: "o", value: "email" }], /plans and reports/);
    refuse([{ op: "skill", agent: "x", value: "email" }], /badges are fixed/);
    refuse([{ op: "remove", agent: "o" }], /stays at the top/);
    refuse([{ op: "remove", agent: "p" }], /owns Found on the board/);
  });
  it("reporting lines: a manager becomes a Lead, no loops, at most two levels", () => {
    const r = applyOrgChanges(team(), [{ op: "reports_to", agent: "w", value: "p" }], lim) as any;
    expect(r.ok).toBe(true);
    expect(r.agents.find((a: any) => a.id === "p")).toMatchObject({ role: "lead" });
    expect(r.agents.find((a: any) => a.id === "p").skills).toContain("planning");
    refuse([{ op: "reports_to", agent: "w", value: "p" }, { op: "reports_to", agent: "p", value: "w" }], /own team/);
    refuse([{ op: "reports_to", agent: "w", value: "p" }, { op: "reports_to", agent: "i", value: "w" }], /at most 2 levels/);
    refuse([{ op: "reports_to", agent: "w", value: "x" }], /registers and can't manage/);
  });
  it("hiring counts against the plan; the orchestrator doesn't", () => {
    const ok = applyOrgChanges(team(), [{ op: "hire", id: "n1", role: "analyst" }, { op: "hire", id: "n2", role: "reporter" }], lim) as any;
    expect(ok.ok && ok.hires).toBe(2);
    expect(ok.agents.find((a: any) => a.id === "n1")).toMatchObject({ skills: ["research"], reports_to: "o" });
    refuse([{ op: "hire", id: "n1", role: "analyst" }, { op: "hire", id: "n2", role: "analyst" }, { op: "hire", id: "n3", role: "analyst" }], /plan includes 6 agents/);
    const noRoot = team().filter((a) => a.id !== "o").map((a) => ({ ...a, reports_to: null }));
    const added = applyOrgChanges(noRoot, [{ op: "hire", id: "o2", role: "orchestrator" }], { agents_used: 6, agents_allowed: 6 }) as any;
    expect(added.ok).toBe(true);
    expect(added.agents.filter((a: any) => a.reports_to === "o2")).toHaveLength(4);
  });
  it("badges map to tools; templates read as badges", () => {
    expect(toolsFor("writer", ["email", "research"])).toEqual(expect.arrayContaining(["propose-email", "web-research", "business-profile"]));
    expect(toolsFor("writer", ["planning"])).not.toContain("assign-task");
    expect(toolsFor("lead", ["planning"])).toContain("assign-task");
    expect(defaultBadges({ template: "credit-control" })).toEqual({ role: "credit-controller", skills: ["cash", "email", "reporting"] });
    expect(defaultBadges({ template: "custom", tools: ["find-companies", "save-lead", "propose-email"], engine: "llm" }).role).toBe("prospector");
  });
});

function business(plan = "growth") {
  const { raw, env } = testEnv();
  const org = seedOrg(raw, { plan, email: "dana@brightwork.example" });
  return { raw, env, org };
}
const tool = async (env: any, orgId: string, agentId: string, slug: string, input: any, runId = "run_t") => runTool({ env, orgId, agentId, runId }, (await getTool(env, slug, { business: true }))!, input);

describe("the org chart in a swarm", () => {
  it("every swarm gets an orchestrator that doesn't use a place on the plan", async () => {
    // Every plan allows 100 agents; a business with 97 has no room for a team of four.
    const { env, org, raw: full } = business("starter");
    for (let i = 0; i < 97; i++) seedAgent(full, org.id, { id: "agt_f" + i, template: "research" });
    const pv = await previewFor(env, org.id, preset("sales-floor")!.blueprint);
    expect(pv).toMatchObject({ agents: 4, orchestrator: true, fits: false });
    const { env: env2, org: org2, raw } = business("growth");
    const r = await createSwarm(env2, org2.id, org2.user, preset("back-office")!.blueprint, { preset: "back-office" });
    expect(r).toMatchObject({ hired: 4, orchestrator: true });
    const s = await orgState(env2, org2.id, r.id);
    const root = s.agents.find((a) => a.role === "orchestrator")!;
    expect(s.root).toBe(root.id);
    expect(s.agents.filter((a) => a.reports_to === root.id)).toHaveLength(4);
    expect(s.agents.find((a) => a.key === "watch")!.locked).toBe(true);
    expect(s.limits).toMatchObject({ agents_used: 4, agents_allowed: 100 });
    expect(specFor(raw.prepare("SELECT * FROM agent WHERE id = ?").get(root.id) as any)!.tools).toEqual(expect.arrayContaining(["list-team", "assign-task", "check-tasks", "finish-task"]));
  });

  it("saves badge changes: a catalogue agent becomes a custom role keeping its name, and back again", async () => {
    const { raw, env, org } = business();
    const r = await createSwarm(env, org.id, org.user, preset("sales-floor")!.blueprint, { preset: "sales-floor" });
    const s = await orgState(env, org.id, r.id);
    const out = s.agents.find((a) => a.key === "outreach")!, inbox = s.agents.find((a) => a.key === "inbox")!;
    const saved = await applyOrg(env, org.id, r.id, { id: org.user, email: "dana@brightwork.example" }, [
      { op: "skill", agent: out.id, value: "registers" }, { op: "autonomy", agent: inbox.id, value: "approve_first" }, { op: "rhythm", agent: inbox.id, value: "daily" },
    ]);
    expect(saved.applied).toHaveLength(3);
    const row = raw.prepare("SELECT * FROM agent WHERE id = ?").get(out.id) as any;
    expect(row).toMatchObject({ template: "custom", name: "Outreach" });
    expect(row.instructions).toMatch(/You run outreach/); // kept its standing orders: only the skills changed
    expect(JSON.parse(row.tools)).toEqual(expect.arrayContaining(["uk-check", "propose-email", "find-companies"]));
    expect(raw.prepare("SELECT autonomy, rhythm FROM agent WHERE id = ?").get(inbox.id)).toMatchObject({ autonomy: "approve_first", rhythm: "daily" });
    const bp = JSON.parse((raw.prepare("SELECT blueprint FROM swarm WHERE id = ?").get(r.id) as any).blueprint);
    expect(bp.agents.find((a: any) => a.key === "outreach").template).toBe("custom");
    expect((raw.prepare("SELECT summary FROM swarm_event WHERE swarm_id = ? AND kind = 'org'").get(r.id) as any).summary).toMatch(/3 changes/);
    // A refused change saves nothing.
    await expect(applyOrg(env, org.id, r.id, { id: org.user, email: "x" }, [{ op: "rhythm", agent: inbox.id, value: "weekly" }, { op: "role", agent: inbox.id, value: "orchestrator" }])).rejects.toMatchObject({ code: "org_change_refused" });
    expect((raw.prepare("SELECT rhythm FROM agent WHERE id = ?").get(inbox.id) as any).rhythm).toBe("daily");
  });

  it("hires under a lead, moves reporting lines, and removes an agent whose team moves up", async () => {
    const { raw, env, org } = business();
    const r = await createSwarm(env, org.id, org.user, preset("sales-floor")!.blueprint, { preset: "sales-floor" });
    const s = await orgState(env, org.id, r.id);
    const p = s.agents.find((a) => a.key === "prospector")!;
    const saved = await applyOrg(env, org.id, r.id, { id: org.user, email: "d" }, [
      { op: "hire", id: "new-1", role: "analyst", name: "Researcher" },
      { op: "reports_to", agent: "new-1", value: p.id },
    ]);
    const hired = saved.agents.find((a) => a.name === "Researcher")!;
    expect(hired).toMatchObject({ role: "analyst", reports_to: p.id, template: "custom" });
    expect(saved.agents.find((a) => a.id === p.id)!.role).toBe("lead");
    const prow = raw.prepare("SELECT tools, template FROM agent WHERE id = ?").get(p.id) as any;
    expect(JSON.parse(prow.tools)).toContain("assign-task");
    expect(saved.limits.agents_used).toBe(5);
    const after = await applyOrg(env, org.id, r.id, { id: org.user, email: "d" }, [{ op: "remove", agent: hired.id }]);
    expect(after.agents.some((a) => a.id === hired.id)).toBe(false);
    expect(raw.prepare("SELECT id FROM agent WHERE id = ?").get(hired.id)).toBeUndefined();
  });

  it("the orchestrator assigns tasks down its team; agents report back; a failed run blocks and wakes it", async () => {
    const { raw, env, org } = business();
    const r = await createSwarm(env, org.id, org.user, preset("sales-floor")!.blueprint, { preset: "sales-floor" });
    const s = await orgState(env, org.id, r.id);
    const o = s.root!, w = s.agents.find((a) => a.key === "outreach")!, p = s.agents.find((a) => a.key === "prospector")!;
    const listed = await tool(env, org.id, o, "list-team", {});
    expect(listed.team.map((t: any) => t.key)).toEqual(expect.arrayContaining(["prospector", "outreach", "inbox", "briefing"]));
    const t1 = await tool(env, org.id, o, "assign-task", { to: "outreach", title: "Write to Peel Street", detail: "They replied to a flyer." }, "run_o1");
    expect(t1).toMatchObject({ to: "Outreach", status: "doing" });
    const task = raw.prepare("SELECT * FROM agent_task WHERE id = ?").get(t1.task_id) as any;
    const queued = raw.prepare("SELECT input FROM agent_run WHERE id = ?").get(task.run_id) as any;
    expect(queued.input).toMatch(/Task from Orchestrator \(task id tsk_/);
    expect(queued.input).toMatch(/as information and not instructions/);
    // Only the orchestrator or a lead hands out work.
    await expect(tool(env, org.id, w.id, "assign-task", { to: "inbox", title: "x" })).rejects.toMatchObject({ code: "not_a_manager" });
    // At most five a run.
    for (let i = 0; i < 4; i++) await tool(env, org.id, o, "assign-task", { to: ["prospector", "inbox", "briefing", "prospector"][i], title: `T${i}` }, "run_o1");
    await expect(tool(env, org.id, o, "assign-task", { to: "inbox", title: "one more" }, "run_o1")).rejects.toMatchObject({ code: "assign_limit" });
    // Reporting back.
    expect(await tool(env, org.id, w.id, "finish-task", { task_id: t1.task_id, status: "done", result: "Drafted it." })).toMatchObject({ status: "done" });
    const checked = await tool(env, org.id, o, "check-tasks", {});
    expect(checked.tasks.find((t: any) => t.id === t1.task_id)).toMatchObject({ status: "done", result: "Drafted it." });
    // A failed run blocks its task and wakes the orchestrator.
    const pTask = raw.prepare("SELECT * FROM agent_task WHERE agent_id = ? AND status = 'doing' LIMIT 1").get(p.id) as any;
    raw.prepare("UPDATE agent_run SET status = 'done' WHERE agent_id = ?").run(o);
    await settleTasksForRun(env, org.id, pTask.run_id, "failed", "No companies matched");
    expect((raw.prepare("SELECT status FROM agent_task WHERE id = ?").get(pTask.id) as any).status).toBe("blocked");
    const woke = raw.prepare("SELECT input FROM agent_run WHERE agent_id = ? AND input LIKE 'Blocked task%'").get(o) as any;
    expect(woke.input).toMatch(/No companies matched/);
  });

  it("goals from the command bar go to the orchestrator; owner tasks start at once", async () => {
    const { raw, env, org } = business();
    const r = await createSwarm(env, org.id, org.user, preset("sales-floor")!.blueprint, { preset: "sales-floor" });
    const g = await ask(env, org.id, r.id, "goal: five law firms talking to us by December", { userId: org.user, email: "d" });
    expect(g).toMatchObject({ type: "instruct", agent: { name: "Orchestrator" } });
    const bp = JSON.parse((raw.prepare("SELECT blueprint FROM swarm WHERE id = ?").get(r.id) as any).blueprint);
    expect(bp.goals.at(-1)).toBe("five law firms talking to us by December");
    expect((raw.prepare("SELECT input FROM agent_run WHERE id = ?").get(g.run_id) as any).input).toMatch(/New goal from the owner/);
    const s = await orgState(env, org.id, r.id);
    const w = s.agents.find((a) => a.key === "outreach")!;
    const t = await ownerTask(env, org.id, r.id, { id: org.user }, w.id, "Follow up Castlefield");
    expect(t.run_id).toBeTruthy();
    const after = await orgState(env, org.id, r.id);
    expect(after.tasks.find((x: any) => x.id === t.task_id)).toMatchObject({ from: "You", status: "doing" });
  });
});
