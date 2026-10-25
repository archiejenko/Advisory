// The org chart behind the Org tab: the team as a tree with its badges and tasks, and saving changes to it.
// The rules live in packages/core/badges.ts (shared with the website); this file reads and writes the rows.
import { newId, nowIso } from "../../../../packages/core/util";
import { PLANS, template } from "../../../../packages/core/templates";
import { applyOrgChanges, defaultBadges, role as roleOf, toolsFor, type OrgAgent, type OrgChange } from "../../../../packages/core/badges";
import type { Blueprint } from "../../../../packages/core/swarms";
import { type Env, one, all, run, audit } from "./db";
import { HttpError } from "./http";
import { emit, loadSwarm, specFor, syncSwarm } from "./swarm";
import { hireAgent, setAgentStatus, nextRunAt, startRun, spreadMinute, estimateRun, modeFor } from "./agents";
import { MODES } from "../../../../config/model-pricing";
import { badgesOf } from "./orgbase";

export type OrgView = OrgAgent & { key: string; template: string; engine: string; tools: number; last_run_at: string | null; next_run_at: string | null; status: string };

export async function orgState(env: Env, orgId: string, swarmId: string) {
  const s = await loadSwarm(env, orgId, swarmId);
  const rows = await all<any>(env, "SELECT * FROM agent WHERE swarm_id = ? AND org_id = ? ORDER BY created_at", swarmId, orgId);
  const root = rows.find((a) => a.template === "orchestrator");
  const agents: OrgView[] = rows.map((a) => {
    const spec = specFor(a);
    const b = badgesOf(a);
    return {
      id: a.id, key: a.swarm_key, name: a.name, template: a.template, engine: spec?.engine || "llm",
      role: b.role, skills: b.skills, autonomy: a.autonomy, rhythm: a.rhythm,
      reports_to: a.id === root?.id ? null : a.reports_to || root?.id || null,
      locked: spec?.engine !== "llm", stages: s.blueprint.stages.filter((x) => x.agent === a.swarm_key).map((x) => x.name),
      status: a.status, tools: spec?.tools.length || 0, last_run_at: a.last_run_at, next_run_at: a.next_run_at,
    };
  });
  const names = Object.fromEntries(rows.map((a) => [a.id, a.name]));
  const tasks = (await all<any>(env, `SELECT id, agent_id, assigned_by, title, detail, status, result, item_id, updated_at, created_at FROM agent_task
    WHERE swarm_id = ? AND org_id = ? AND (status IN ('todo','doing','blocked') OR updated_at >= ?) ORDER BY created_at DESC LIMIT 200`, swarmId, orgId, new Date(Date.now() - 7 * 864e5).toISOString()))
    .map((t) => ({ ...t, from: t.assigned_by === "owner" ? "You" : names[t.assigned_by] || "An agent" }));
  const org = await one<any>(env, "SELECT plan FROM org WHERE id = ?", orgId);
  const plan = PLANS[org?.plan || "trial"] || PLANS.trial;
  const used = Number((await one<any>(env, "SELECT COUNT(*) AS n FROM agent WHERE org_id = ? AND template != 'orchestrator'", orgId))?.n || 0);
  return {
    swarm: { id: s.id, name: s.name, goals: s.blueprint.goals, skin: s.blueprint.skin },
    root: root?.id ?? null, agents, tasks,
    limits: { agents_used: used, agents_allowed: plan.agents, plan: plan.name },
  };
}

const sameBadges = (a: { role: string; skills: string[] }, b: { role: string; skills: string[] }) => a.role === b.role && [...a.skills].sort().join() === [...b.skills].sort().join();

/** Save a list of changes from the Org tab, all checked first by the shared rules. Returns the new state and what changed. */
export async function applyOrg(env: Env, orgId: string, swarmId: string, user: { id: string; email: string }, changes: OrgChange[]) {
  const before = await orgState(env, orgId, swarmId);
  const res = applyOrgChanges(before.agents, changes, before.limits);
  if (!res.ok) throw new HttpError(409, "org_change_refused", res.error, { index: res.index });
  const s = await loadSwarm(env, orgId, swarmId);
  const bp: Blueprint = JSON.parse(JSON.stringify(s.blueprint));
  const rows = Object.fromEntries((await all<any>(env, "SELECT * FROM agent WHERE swarm_id = ? AND org_id = ?", swarmId, orgId)).map((a) => [a.id, a]));
  const prev = Object.fromEntries(before.agents.map((a) => [a.id, a]));
  const after = res.agents;
  const idMap: Record<string, string> = {};
  const rootId = () => after.find((a) => a.role === "orchestrator")?.id;
  const realId = (id: string | null | undefined) => (id ? idMap[id] || id : null);

  // Removed agents first: they free places for hires in the same save.
  for (const old of before.agents) {
    if (after.some((a) => a.id === old.id)) continue;
    const row = rows[old.id];
    await setAgentStatus(env, orgId, old.id, "paused");
    await run(env, "UPDATE agent_action SET status = 'rejected', decided_by = 'removed' WHERE org_id = ? AND agent_id = ? AND status = 'proposed'", orgId, old.id);
    await run(env, "UPDATE agent_task SET status = 'dropped', result = 'The agent was removed.', updated_at = ? WHERE agent_id = ? AND org_id = ? AND status IN ('todo','doing','blocked')", nowIso(), old.id, orgId);
    if (row && row.created_at < s.created_at) await run(env, "UPDATE agent SET swarm_id = NULL, swarm_key = NULL, role = NULL, reports_to = NULL WHERE id = ? AND org_id = ?", old.id, orgId);
    else await run(env, "DELETE FROM agent WHERE id = ? AND org_id = ?", old.id, orgId);
    bp.agents = bp.agents.filter((x) => x.key !== old.key);
    bp.handoffs = bp.handoffs.filter((h) => h.from !== old.key && h.to !== old.key);
  }

  // Hires, in the order made, so a later hire can report to an earlier one.
  const keys = new Set(bp.agents.map((a) => a.key));
  for (const a of after) {
    if (prev[a.id]) continue;
    const r = roleOf(a.role)!;
    let key = r.key === "orchestrator" ? "orchestrator" : r.key, n = 2;
    while (keys.has(key)) key = `${r.key}-${n++}`;
    keys.add(key);
    const isOrch = r.key === "orchestrator";
    const tools = toolsFor(r.key, a.skills);
    const boss = realId(a.reports_to);
    const id = await hireAgent(env, orgId, user.id, isOrch
      ? { template: "orchestrator", name: a.name, rhythm: "weekdays", run_hour: 8, swarm_id: swarmId, swarm_key: key, role: r.about }
      : { template: "custom", name: a.name, rhythm: a.rhythm, autonomy: a.autonomy, swarm_id: swarmId, swarm_key: key, role: r.about, instructions: r.orders, tools, badges: { role: r.key, skills: a.skills }, reports_to: boss && boss !== rootId() ? boss : null });
    idMap[a.id] = id;
    bp.agents.push(isOrch ? { key, name: a.name, role: r.about, template: "orchestrator", rhythm: "weekdays", run_hour: 8 } : { key, name: a.name, role: r.about, template: "custom", instructions: r.orders, tools, rhythm: a.rhythm as any });
    if (isOrch) await run(env, "UPDATE agent SET reports_to = NULL WHERE swarm_id = ? AND org_id = ? AND reports_to IS NULL", swarmId, orgId);
  }

  // Changes to agents that were already there.
  for (const a of after) {
    const old = prev[a.id];
    if (!old) continue;
    const row = rows[a.id];
    const bpa = bp.agents.find((x) => x.key === row.swarm_key);
    if (!sameBadges(old, a)) {
      const r = roleOf(a.role)!;
      const roleChanged = old.role !== a.role;
      const native = template(row.template) && row.template !== "custom" ? defaultBadges({ template: row.template }) : null;
      if (row.template === "orchestrator") {
        await run(env, "UPDATE agent SET badges = ? WHERE id = ? AND org_id = ?", JSON.stringify({ role: a.role, skills: a.skills }), a.id, orgId);
      } else if (native && sameBadges(native, a)) {
        await run(env, "UPDATE agent SET badges = NULL WHERE id = ? AND org_id = ?", a.id, orgId);
      } else {
        // Any other change makes it a custom role that keeps its name: new standing orders only when the role changed.
        const instructions = roleChanged ? r.orders : row.instructions || template(row.template)?.instructions || r.orders;
        const tools = toolsFor(a.role, a.skills);
        await run(env, "UPDATE agent SET template = 'custom', instructions = ?, tools = ?, badges = ?, role = ? WHERE id = ? AND org_id = ?", instructions, JSON.stringify(tools), JSON.stringify({ role: a.role, skills: a.skills }), roleChanged ? r.about : row.role, a.id, orgId);
        if (bpa) Object.assign(bpa, { template: "custom", instructions, tools, role: roleChanged ? r.about : bpa.role });
      }
    }
    if (old.autonomy !== a.autonomy) await run(env, "UPDATE agent SET autonomy = ? WHERE id = ? AND org_id = ?", a.autonomy, a.id, orgId);
    if (old.rhythm !== a.rhythm) {
      await run(env, "UPDATE agent SET rhythm = ?, next_run_at = ? WHERE id = ? AND org_id = ?", a.rhythm, row.status === "running" ? nextRunAt(a.rhythm as any, row.run_hour, new Date(), spreadMinute(a.id)) : null, a.id, orgId);
      if (bpa) bpa.rhythm = a.rhythm as any;
    }
    if (old.reports_to !== a.reports_to) {
      const boss = realId(a.reports_to);
      await run(env, "UPDATE agent SET reports_to = ? WHERE id = ? AND org_id = ?", boss && boss !== rootId() ? boss : null, a.id, orgId);
      if (bpa) { const b = after.find((x) => x.id === a.reports_to); bpa.reports_to = b && b.role !== "orchestrator" ? rows[b.id]?.swarm_key : undefined; }
    }
  }

  await run(env, "UPDATE swarm SET blueprint = ? WHERE id = ? AND org_id = ?", JSON.stringify(bp), swarmId, orgId);
  await emit(env, { orgId, swarmId, kind: "org", summary: res.summaries.length === 1 ? res.summaries[0] : `You changed the team: ${res.summaries.length} changes`, detail: { changes: res.summaries } });
  await audit(env, orgId, user.id, "swarm_org_changed", swarmId, { changes: res.summaries });
  try { await syncSwarm(env, orgId, swarmId, { force: true, quiet: true }); } catch (e) { console.error("sync after org change failed", e); }
  return { ...(await orgState(env, orgId, swarmId)), applied: res.summaries };
}

/** A task you give an agent yourself, from the Org tab. It starts straight away if the agent is running. */
export async function ownerTask(env: Env, orgId: string, swarmId: string, user: { id: string }, agentId: string, title: string, detail?: string, opts: { mode?: string | null; confirm?: boolean } = {}) {
  await loadSwarm(env, orgId, swarmId);
  const a = await one<any>(env, "SELECT * FROM agent WHERE id = ? AND swarm_id = ? AND org_id = ?", agentId, swarmId, orgId);
  if (!a) throw new HttpError(404, "not_found", "Agent not found.");
  if (specFor(a)?.engine !== "llm") throw new HttpError(409, "not_runnable", `${a.name} runs from the registers on its own and can't take tasks.`);
  // A task likely to cost more than the business's threshold asks first, before anything is recorded.
  const mode = modeFor(a, opts.mode);
  if (a.status === "running" && !opts.confirm) {
    const est = await estimateRun(env, orgId, a, mode, `${title} ${detail || ""}`);
    const org = await one<any>(env, "SELECT confirm_over FROM org WHERE id = ?", orgId);
    if (est.high > Number(org?.confirm_over ?? 100)) throw new HttpError(409, "needs_confirmation", `This task is likely to use ${est.low}–${est.high} credits in ${MODES[mode].name} mode. Confirm to go ahead.`,
      { estimate: { low: est.low, high: est.high, mode, from: est.from }, threshold: Number(org?.confirm_over ?? 100) });
  }
  const id = newId("tsk"), now = nowIso();
  await run(env, "INSERT INTO agent_task (id, org_id, swarm_id, agent_id, assigned_by, title, detail, status, created_at, updated_at, mode) VALUES (?,?,?,?,?,?,?,?,?,?,?)", id, orgId, swarmId, a.id, "owner", title, detail || null, "todo", now, now, mode);
  let runId: string | null = null;
  if (a.status === "running") {
    runId = await startRun(env, orgId, a.id, "manual", `Task from the owner (task id ${id}): ${title}${detail ? `\nDetail: ${detail}` : ""}\nWhen you're done, finish-task with the task id and a one-line result.`, { mode, confirm: true });
    await run(env, "UPDATE agent_task SET status = 'doing', run_id = ?, attempts = 1, updated_at = ? WHERE id = ?", runId, nowIso(), id);
  }
  await emit(env, { orgId, swarmId, agentId: a.id, kind: "task", summary: `You gave ${a.name}: ${title}`, detail: { task_id: id } });
  await audit(env, orgId, user.id, "task_assigned", id, { agent: a.id });
  return { task_id: id, run_id: runId };
}
