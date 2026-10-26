// The Swarm engine: a business description becomes a checked blueprint, a blueprint becomes a running swarm,
// and the command bar (typed or spoken) is routed to the right agent.
import { newId, nowIso } from "../../../../packages/core/util";
import { addRule } from "./today";
import { TEMPLATES, PLANS } from "../../../../packages/core/templates";
import { PRESETS, KPIS, CUSTOM_TOOLS, SWARM_TOOLS, estimateCredits, nearestPreset, withOrchestrator, type Blueprint } from "../../../../packages/core/swarms";
import { type Env, one, all, run, audit } from "./db";
import { HttpError } from "./http";
import { claude, type Msg } from "./llm";
import { creditsProblem, requireCredits, chargeSystem } from "./credits";
import { tokensOf, addTokens, noTokens } from "../../../../packages/core/credits";
import { MODES, SYSTEM_MODE } from "../../../../config/model-pricing";
import { hireAgent, startRun, setAgentStatus } from "./agents";
import { orgAccess, accessError } from "./billing";
import { checkBlueprint, emit, syncSwarm, specFor, loadSwarm, kpi } from "./swarm";
import { builtin } from "./tools";
import { hit } from "./limits";
import { defaultBadges, PLANNING_TOOLS } from "../../../../packages/core/badges";

/* ---------- Creating a swarm ---------- */

/** Which existing agents a blueprint would reuse instead of hiring again (same template, not in another swarm). */
async function adoptions(env: Env, orgId: string, bp: Blueprint) {
  const free = await all<any>(env, "SELECT id, template, name FROM agent WHERE org_id = ? AND swarm_id IS NULL", orgId);
  const taken = new Set<string>(), out: Record<string, any> = {};
  for (const a of bp.agents) {
    if (a.template === "custom") continue;
    const hit = free.find((f) => f.template === a.template && !taken.has(f.id));
    if (hit) { out[a.key] = hit; taken.add(hit.id); }
  }
  return out;
}

/** What a blueprint will cost and whether it fits the plan, for the preview. */
export async function previewFor(env: Env, orgId: string, raw: Blueprint) {
  const bp = withOrchestrator(raw);
  const org = await one<any>(env, "SELECT plan FROM org WHERE id = ?", orgId);
  const plan = PLANS[org?.plan || "trial"] || PLANS.trial;
  const existing = Number((await one<any>(env, "SELECT COUNT(*) AS n FROM agent WHERE org_id = ? AND template != 'orchestrator'", orgId))?.n || 0);
  const adopt = await adoptions(env, orgId, bp);
  const counted = bp.agents.filter((a) => a.template !== "orchestrator");
  const hires = counted.length - Object.keys(adopt).length;
  const credits = estimateCredits(bp);
  return {
    agents: counted.length, orchestrator: true, reuses: Object.entries(adopt).map(([key, a]) => ({ key, agent: a.name })), new_agents: hires,
    plan: plan.name, plan_agents: plan.agents, agents_after: existing + hires, fits: existing + hires <= plan.agents,
    credits_a_month: credits, plan_credits: plan.credits, within_plan: credits <= plan.credits,
    needs: bp.needs,
  };
}

export async function createSwarm(env: Env, orgId: string, userId: string, raw: unknown, opts: { preset?: string | null; description?: string | null } = {}) {
  const checked = checkBlueprint(raw);
  if (!checked.ok) throw new HttpError(400, "invalid_blueprint", "This swarm's blueprint has problems: " + checked.errors.join("; "), { errors: checked.errors });
  const bp = withOrchestrator(checked.blueprint);
  if (bp.needs.length) throw new HttpError(409, "needs_connection", `This swarm needs ${bp.needs.join(" and ")} before it can start.`);
  const { problem } = await orgAccess(env, orgId);
  if (problem) throw accessError(problem);
  const pv = await previewFor(env, orgId, bp);
  if (!pv.fits) throw new HttpError(409, "plan_limit", `This swarm needs ${pv.new_agents} new ${pv.new_agents === 1 ? "agent" : "agents"}, which would take you to ${pv.agents_after}. Your ${pv.plan} plan includes ${pv.plan_agents}. Drop an agent from the swarm or move to a bigger plan.`);
  const adopt = await adoptions(env, orgId, bp);
  const id = newId("swm");
  await run(env, "INSERT INTO swarm (id, org_id, name, sector, description, preset, blueprint, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    id, orgId, bp.name, bp.sector, opts.description?.slice(0, 2000) ?? null, opts.preset ?? null, JSON.stringify(bp), userId, nowIso());
  const hired: string[] = [], adopted: string[] = [];
  try {
    for (const a of bp.agents) {
      const existing = adopt[a.key];
      if (existing) {
        await run(env, "UPDATE agent SET swarm_id = ?, swarm_key = ?, role = ?, name = ? WHERE id = ? AND org_id = ?", id, a.key, a.role, a.name, existing.id, orgId);
        adopted.push(existing.id);
      } else {
        hired.push(await hireAgent(env, orgId, userId, { template: a.template, name: a.name, rhythm: a.rhythm, run_hour: a.run_hour, swarm_id: id, swarm_key: a.key, role: a.role, instructions: a.instructions, tools: a.tools }));
      }
    }
    // Reporting lines: by key in the blueprint; everyone else reports to the orchestrator (stored as null).
    const ids = Object.fromEntries((await all<any>(env, "SELECT id, swarm_key FROM agent WHERE swarm_id = ? AND org_id = ?", id, orgId)).map((x) => [x.swarm_key, x.id]));
    for (const a of bp.agents) {
      const boss = a.reports_to && bp.agents.find((x) => x.key === a.reports_to);
      // Only a custom role can become a Lead here (it needs the planning tools); others stay under the orchestrator.
      if (boss && boss.template === "custom" && ids[a.key] && ids[boss.key]) {
        await run(env, "UPDATE agent SET reports_to = ? WHERE id = ? AND org_id = ?", ids[boss.key], ids[a.key], orgId);
        const b = defaultBadges({ template: "custom", tools: boss.tools || [], engine: "llm" });
        await run(env, "UPDATE agent SET badges = ?, tools = ? WHERE id = ? AND org_id = ?", JSON.stringify({ role: "lead", skills: [...new Set([...b.skills, "planning"])] }), JSON.stringify([...new Set([...(boss.tools || []), ...PLANNING_TOOLS])]), ids[boss.key], orgId);
      }
    }
  } catch (e) {
    // Undo what was done, so a failure leaves no half-built swarm.
    for (const h of hired) await run(env, "DELETE FROM agent WHERE id = ? AND org_id = ?", h, orgId);
    for (const a of adopted) await run(env, "UPDATE agent SET swarm_id = NULL, swarm_key = NULL, role = NULL WHERE id = ? AND org_id = ?", a, orgId);
    await run(env, "DELETE FROM swarm WHERE id = ?", id);
    throw e;
  }
  await emit(env, { orgId, swarmId: id, kind: "created", summary: `${bp.name} spun up with ${bp.agents.length} agents` });
  await syncSwarm(env, orgId, id, { force: true, quiet: true });
  await audit(env, orgId, userId, "swarm_created", id, { preset: opts.preset ?? null, agents: bp.agents.length, reused: adopted.length });
  // The orchestrator comes with every swarm; it isn't counted against the plan.
  const counted = (await all<any>(env, "SELECT template FROM agent WHERE id IN (" + (hired.map(() => "?").join(",") || "''") + ")", ...hired)).filter((x) => x.template !== "orchestrator").length;
  return { id, hired: counted, reused: adopted.length, orchestrator: true };
}

/** Remove a swarm. Its agents are paused and removed; agents it reused go back to working on their own. */
export async function removeSwarm(env: Env, orgId: string, swarmId: string, userId: string) {
  await loadSwarm(env, orgId, swarmId);
  const agents = await all<any>(env, "SELECT id, created_at FROM agent WHERE swarm_id = ? AND org_id = ?", swarmId, orgId);
  const s = await one<any>(env, "SELECT created_at FROM swarm WHERE id = ?", swarmId);
  for (const a of agents) {
    if (a.created_at >= s.created_at) {
      await setAgentStatus(env, orgId, a.id, "paused");
      await run(env, "UPDATE agent_action SET status = 'rejected', decided_by = 'removed' WHERE org_id = ? AND agent_id = ? AND status = 'proposed'", orgId, a.id);
      await run(env, "DELETE FROM agent WHERE id = ? AND org_id = ?", a.id, orgId);
    } else await run(env, "UPDATE agent SET swarm_id = NULL, swarm_key = NULL, role = NULL WHERE id = ? AND org_id = ?", a.id, orgId);
  }
  await env.DB.batch(["work_item", "swarm_event", "agent_task"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE swarm_id = ? AND org_id = ?`).bind(swarmId, orgId)));
  await run(env, "DELETE FROM swarm WHERE id = ? AND org_id = ?", swarmId, orgId);
  await audit(env, orgId, userId, "swarm_removed", swarmId);
}

/* ---------- Generating a blueprint ---------- */

export { nearestPreset };

function plannerSystem(plan: { name: string; agents: number }, existing: number) {
  const tpl = TEMPLATES.filter((t) => t.status === "live").map((t) => `- ${t.key} (${t.engine === "llm" ? "AI agent" : "register engine"}, ${t.rhythm}): ${t.short}`).join("\n");
  const tools = [...CUSTOM_TOOLS, ...SWARM_TOOLS].map((s) => `- ${s}: ${builtin(s)?.description || ""}`).join("\n");
  const kpis = Object.entries(KPIS).map(([k, v]) => `- ${k}: ${v.label}`).join("\n");
  const examples = PRESETS.filter((p) => !p.locked).map((p) => JSON.stringify(p.blueprint)).join("\n\n");
  return `SWARM BLUEPRINT
You design a swarm of AI agents that runs part of a small UK business inside Agent House. Reply with ONE JSON object and nothing else.

The JSON has: name, sector, goals (up to 5 short strings), agents, stages, handoffs, kpis, skin ("floor", "calm" or "terminal"), needs.
- agents: 2 to ${Math.max(2, Math.min(6, plan.agents - existing))} agents. Every swarm gets an orchestrator at the top automatically: don't add one. Optional reports_to: another agent's key, to put a Lead over a small team (at most two levels). Each: key (lowercase-hyphen), name (2 words max), role (one line), template, rhythm (weekdays, daily, weekly, monthly, on_demand, on_event), optional run_hour.
  template is one of these catalogue agents, used as-is:
${tpl}
  or "custom" for a role the catalogue doesn't have: then also give instructions (numbered standing orders, at least 3 steps, under 1200 characters) and tools (only from the list below).
- stages: 3 to 8 stages work moves through, in order. Each: key, name, agent (the key of the agent who owns it), optional group (to split lanes, e.g. "Cash" and "Inbox"), optional done:true for finished stages, and optional rule so records fill the stage by themselves:
  {"source":"lead","status":["new"|"contacted"|"replied"|"won"|"lost"],"has_email":true|false}
  {"source":"invoice","state":["due"|"overdue"|"reminded"|"paid"|"disputed"]}
  {"source":"message","status":["new"|"triaged"|"replied"|"ignored"]}
- handoffs: who passes work to whom, and when (one line).
- kpis: 3 or 4 keys from:
${kpis}
- needs: list any connection the swarm can't work without that Agent House doesn't have (calendar, accounting software, market data, a booking system). Empty if none.

Tools a custom role may use:
${tools}

Rules: never give an agent financial, legal or medical advice to send on its own, and never let one place trades or move money: make those draft-for-approval roles. Every outbound email is approved by the owner unless they change it. Use catalogue agents where they fit; use custom roles for the rest. The plan is ${plan.name}, with ${plan.agents} agents in total and ${existing} already hired.

Examples of good blueprints:
${examples}`;
}

function parseJson(text: string): unknown {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

/** Description in, a checked blueprint and its preview out. Falls back to the nearest preset rather than failing. */
export async function planBlueprint(env: Env, orgId: string, description: string) {
  if (!(await hit(env, "swarmplan", orgId, 12))) throw new HttpError(429, "slow_down", "That's a lot of swarm drafts this hour. Try again later, or start from a preset.");
  const desc = description.trim().slice(0, 2000);
  const org = await one<any>(env, "SELECT name, profile, plan FROM org WHERE id = ?", orgId);
  const plan = PLANS[org?.plan || "trial"] || PLANS.trial;
  const existing = Number((await one<any>(env, "SELECT COUNT(*) AS n FROM agent WHERE org_id = ? AND swarm_id IS NULL", orgId))?.n || 0);
  let bp: Blueprint | null = null, note: string | null = null, tokens = noTokens(), requests = 0;
  const sys = MODES[SYSTEM_MODE];
  // With this month's credits used, the nearest preset stands in for a drafted blueprint.
  if (env.ANTHROPIC_API_KEY && !(await creditsProblem(env, orgId))) {
    const system = plannerSystem(plan, existing);
    const messages: Msg[] = [{ role: "user", content: `Business: ${org?.name}\nProfile: ${org?.profile || "{}"}\n\nWhat they told us:\n${desc}` }];
    for (let attempt = 0; attempt < 2 && !bp; attempt++) {
      try {
        const r = await claude(env, { system, messages, tools: [], model: sys.model, effort: sys.effort, max_tokens: 8000 });
        tokens = addTokens(tokens, tokensOf(r.usage)); requests++;
        const text = r.content.filter((x) => x.type === "text").map((x: any) => x.text).join("\n");
        const checked = checkBlueprint(parseJson(text));
        if (checked.ok) bp = checked.blueprint;
        else { messages.push({ role: "assistant", content: text }, { role: "user", content: "Fix these problems and reply with the whole corrected JSON only:\n- " + checked.errors.join("\n- ") }); }
      } catch (e: any) { console.error("blueprint generation failed", e?.message || e); break; }
    }
    if (requests) await chargeSystem(env, orgId, sys.model, tokens, requests, "Swarm draft");
  }
  let source: "generated" | "preset" = "generated", presetKey: string | null = null;
  if (!bp) {
    const p = nearestPreset(desc);
    bp = p.blueprint; source = "preset"; presetKey = p.key;
    note = env.ANTHROPIC_API_KEY ? `We couldn't design a swarm from that, so here's the closest preset: ${p.title}.` : `Here's the closest preset: ${p.title}.`;
  }
  return { blueprint: bp, preview: await previewFor(env, orgId, bp), source, preset: presetKey, note };
}

/* ---------- The command bar ---------- */
export type AskResult = { type: "instruct" | "answer" | "change" | "brief"; say: string; run_id?: string; agent?: { id: string; name: string }; change?: { action: "pause" | "resume"; agent_id: string; agent: string } };

const find = (agents: any[], name: string) => {
  const n = name.toLowerCase().replace(/^@/, "").trim();
  return agents.find((a) => a.swarm_key === n || a.name.toLowerCase() === n) || agents.find((a) => a.name.toLowerCase().startsWith(n) || n.startsWith(a.name.toLowerCase()));
};

/** Route an instruction from the command bar (typed or transcribed). Changes come back for confirmation, never done here. */
export async function ask(env: Env, orgId: string, swarmId: string, text: string, by: { userId: string; email: string; voice?: boolean }): Promise<AskResult> {
  const s = await loadSwarm(env, orgId, swarmId);
  const q = text.trim().slice(0, 1000);
  if (!q) throw new HttpError(400, "invalid_request", "Say or type what you need.");
  if (!(await hit(env, "ask", orgId, 120))) throw new HttpError(429, "slow_down", "That's a lot of instructions this hour. Try again shortly.");
  const agents = await all<any>(env, "SELECT id, name, swarm_key, template, tools, instructions, swarm_id, status, role FROM agent WHERE swarm_id = ? AND org_id = ?", swarmId, orgId);
  await emit(env, { orgId, swarmId, kind: "ask", summary: `${by.voice ? "You said" : "You asked"}: ${q.slice(0, 200)}` });

  let m: RegExpMatchArray | null;
  const instruct = async (a: any, input: string): Promise<AskResult> => {
    const spec = specFor(a);
    if (!spec || spec.engine !== "llm") return { type: "answer", say: `${a.name} works from the registers on its own schedule, so it can't take instructions.` };
    if (a.status !== "running") return { type: "answer", say: `${a.name} is paused. Resume it first.` };
    const runId = await startRun(env, orgId, a.id, "manual", input);
    return { type: "instruct", say: `${a.name} is on it.`, run_id: runId, agent: { id: a.id, name: a.name } };
  };

  // Fast paths that need no model call.
  if (/^(brief me|briefing|what('?s| has) (happened|changed)|catch me up)\b/i.test(q)) return { type: "brief", say: await briefText(env, orgId, swarmId) };
  if ((m = q.match(/^\/?(?:new\s+)?goal\s*[:\-]?\s+(.{3,})$/is))) return setGoal(env, orgId, swarmId, m[1], by);
  if ((m = q.match(/^\/?(?:house\s+)?rule\s*[:\-]?\s+(.{4,})$/is))) {
    const r = await addRule(env, orgId, m[1], by.email, "owner");
    return { type: "answer", say: r.duplicate ? "You already have that rule." : "Rule saved. Every agent follows it from now on; change it in How we work." };
  }
  if ((m = q.match(/^\/?(pause|resume)\s+(.+)$/i))) {
    const a = find(agents, m[2]);
    if (!a) return { type: "answer", say: `There's no agent called ${m[2]} in this swarm.` };
    const action = m[1].toLowerCase() as "pause" | "resume";
    return { type: "change", say: `${action === "pause" ? "Pause" : "Resume"} ${a.name}? Confirm on screen.`, change: { action, agent_id: a.id, agent: a.name } };
  }
  if ((m = q.match(/^@([\w-]+)[:,]?\s+(.+)$/s))) {
    const a = find(agents, m[1]);
    if (a) return instruct(a, m[2]);
  }
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "router_off", "Address an agent directly, like \"@outreach find 10 dental practices in Leeds\".");

  // The router: one model call decides what this is.
  const facts: string[] = [];
  for (const k of s.blueprint.kpis) facts.push(`${KPIS[k]?.label || k}: ${await kpi(env, orgId, k)}`);
  const waiting = Number((await one<any>(env, `SELECT COUNT(*) AS n FROM agent_action WHERE org_id = ? AND status = 'proposed'`, orgId))?.n || 0);
  const recent = await all<any>(env, "SELECT summary FROM swarm_event WHERE swarm_id = ? ORDER BY id DESC LIMIT 12", swarmId);
  const system = `COMMAND ROUTER
You route the owner's instruction to their swarm. Reply with ONE JSON object only:
{"type":"instruct","agent":"<agent key>","input":"<the task, rewritten clearly for that agent>"} to give an agent work,
{"type":"answer","answer":"<two or three plain sentences>"} for a question you can answer from the facts below,
{"type":"change","action":"pause"|"resume","agent":"<agent key>"} to pause or resume an agent.
Never approve, send or delete anything: say the owner must do that on screen.
Agents: ${agents.map((a) => `${a.swarm_key} (${a.name}${a.status !== "running" ? ", paused" : ""}): ${a.role || ""}`).join("; ")}.
Facts: ${facts.join("; ")}; emails waiting for approval: ${waiting}.
Recent: ${recent.map((r) => r.summary).join(" | ")}`;
  await requireCredits(env, orgId);
  const sys = MODES[SYSTEM_MODE];
  const r = await claude(env, { system, messages: [{ role: "user", content: q }], tools: [], model: sys.model, effort: "low", max_tokens: 2000 });
  await chargeSystem(env, orgId, sys.model, tokensOf(r.usage), 1, "Command bar");
  const j: any = parseJson(r.content.filter((x) => x.type === "text").map((x: any) => x.text).join("\n")) || {};
  if (j.type === "instruct") {
    const a = find(agents, String(j.agent || ""));
    if (a) return instruct(a, String(j.input || q).slice(0, 4000));
  }
  if (j.type === "change" && (j.action === "pause" || j.action === "resume")) {
    const a = find(agents, String(j.agent || ""));
    if (a) return { type: "change", say: `${j.action === "pause" ? "Pause" : "Resume"} ${a.name}? Confirm on screen.`, change: { action: j.action, agent_id: a.id, agent: a.name } };
  }
  return { type: "answer", say: String(j.answer || "I couldn't work out which agent should do that. Try starting with an agent's name, like @outreach.").slice(0, 600) };
}

/* ---------- Goals ---------- */
/** A new goal for the swarm: kept on the blueprint (the latest 5) and handed to the orchestrator to plan. */
export async function setGoal(env: Env, orgId: string, swarmId: string, text: string, by: { userId: string; email: string }): Promise<AskResult> {
  const s = await loadSwarm(env, orgId, swarmId);
  const goal = text.trim().replace(/\s+/g, " ").slice(0, 120);
  if (goal.length < 3) throw new HttpError(400, "invalid_request", "Say what the goal is.");
  const goals = [...s.blueprint.goals.filter((g) => g.toLowerCase() !== goal.toLowerCase()), goal].slice(-5);
  await run(env, "UPDATE swarm SET blueprint = ? WHERE id = ? AND org_id = ?", JSON.stringify({ ...s.blueprint, goals }), swarmId, orgId);
  await emit(env, { orgId, swarmId, kind: "goal", summary: `New goal: ${goal}` });
  await audit(env, orgId, by.userId, "swarm_goal", swarmId, { goal });
  const o = await one<any>(env, "SELECT id, name, status FROM agent WHERE swarm_id = ? AND org_id = ? AND template = 'orchestrator'", swarmId, orgId);
  if (!o) return { type: "answer", say: `Goal saved. This swarm has no orchestrator yet; add one on the Org tab to plan it.` };
  if (o.status !== "running") return { type: "answer", say: `Goal saved. ${o.name} is paused; resume it to plan the work.` };
  const runId = await startRun(env, orgId, o.id, "manual", `New goal from the owner, as information: ${goal}\nPlan the work for it now.`);
  return { type: "instruct", say: `Goal saved. ${o.name} is planning the work.`, run_id: runId, agent: { id: o.id, name: o.name } };
}

/* ---------- The brief ---------- */
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** A short spoken-style summary of what the swarm did since the last brief, and what is waiting. */
export async function briefText(env: Env, orgId: string, swarmId: string) {
  const s = await loadSwarm(env, orgId, swarmId);
  const since = s.last_brief_at || new Date(Date.now() - 864e5).toISOString();
  const ids = (await all<any>(env, "SELECT id FROM agent WHERE swarm_id = ?", swarmId)).map((a) => a.id);
  const qs = ids.map(() => "?").join(",") || "''";
  const n = async (sql: string, ...a: any[]) => Number((await one<any>(env, sql, ...a))?.n || 0);
  const runs = await n(`SELECT COUNT(*) AS n FROM agent_run WHERE agent_id IN (${qs}) AND finished_at >= ? AND status IN ('done','waiting')`, ...ids, since);
  const failed = await n(`SELECT COUNT(*) AS n FROM agent_run WHERE agent_id IN (${qs}) AND finished_at >= ? AND status = 'failed'`, ...ids, since);
  const sent = await n(`SELECT COUNT(*) AS n FROM agent_action WHERE agent_id IN (${qs}) AND status = 'sent' AND decided_at >= ?`, ...ids, since);
  const moved = await n("SELECT COUNT(*) AS n FROM swarm_event WHERE swarm_id = ? AND kind IN ('moved','handoff') AND at >= ?", swarmId, since);
  const leads = await n("SELECT COUNT(*) AS n FROM lead WHERE org_id = ? AND created_at >= ?", orgId, since);
  const waiting = await n(`SELECT COUNT(*) AS n FROM agent_action WHERE agent_id IN (${qs}) AND status = 'proposed'`, ...ids);
  const tasks = await n("SELECT COUNT(*) AS n FROM task WHERE org_id = ? AND status = 'open'", orgId);
  const replies = await n("SELECT COUNT(*) AS n FROM activity WHERE org_id = ? AND kind = 'reply' AND at >= ?", orgId, since);
  const won = await n("SELECT COUNT(*) AS n FROM activity WHERE org_id = ? AND kind = 'won' AND at >= ?", orgId, since);
  // Outcomes first: what came back and what it's worth. How busy the agents were comes last.
  const outcomes = [replies && plural(replies, "reply", "replies"), won && plural(won, "new customer"), leads && plural(leads, "new lead"), sent && plural(sent, "email") + " sent"].filter(Boolean) as string[];
  const parts = [
    outcomes.length ? `Since your last brief: ${outcomes.length > 1 ? outcomes.slice(0, -1).join(", ") + " and " + outcomes.at(-1) : outcomes[0]}.` : "",
  ];
  for (const k of s.blueprint.kpis.slice(0, 2)) {
    const v = await kpi(env, orgId, k), unit = KPIS[k]?.unit;
    parts.push(`${KPIS[k]?.label}: ${unit === "pence" ? "£" + Math.round(v / 100).toLocaleString("en-GB") : unit === "days" ? plural(v, "day") : v}.`);
  }
  parts.push(
    waiting ? `${plural(waiting, "email is", "emails are")} waiting for your approval.` : "Nothing is waiting for your approval.",
    tasks ? `You have ${plural(tasks, "open task")}.` : "",
    runs || failed ? `Your agents finished ${plural(runs, "run")}${failed ? ` and ${plural(failed, "run")} stopped with a problem` : ""}${moved ? `, and moved ${plural(moved, "card")} on` : ""}.` : "Your agents have been quiet since your last brief.",
  );
  await run(env, "UPDATE swarm SET last_brief_at = ? WHERE id = ?", nowIso(), swarmId);
  await emit(env, { orgId, swarmId, kind: "brief", summary: "Brief read out" });
  return parts.filter(Boolean).join(" ");
}

export { PRESETS };
