// The agent runtime: hire an agent, run it turn by turn on the job queue, and schedule the next run.
import { newId, nowIso } from "../../../../packages/core/util";
import { template, TEMPLATES, PLANS, type Template } from "../../../../packages/core/templates";
import { type Env, one, all, run, audit } from "./db";
import { HttpError } from "./http";
import { claude, modelCost, type Msg, type Block } from "./llm";
import { getTool, runTool, toolDefs, type Tool, type ToolCtx } from "./tools";
import { notifyChannel } from "./delivery";

export const MAX_STEPS = 8;
const SCHEDULED = new Set(["weekdays", "daily", "weekly", "monthly"]);

/* ---------- Scheduling (in UK time) ---------- */
function londonOffsetMin(d: Date) {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = s.match(/GMT([+-]\d+)?(?::(\d+))?/);
  return m && m[1] ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] || 0) : 0;
}
/** The next time an agent should run, after `from`. Null for agents that only run on demand or on events. */
export function nextRunAt(rhythm: string, hour: number, from = new Date()): string | null {
  if (!SCHEDULED.has(rhythm)) return null;
  for (let d = 0; d < 40; d++) {
    const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + d, hour, 0));
    const t = new Date(day.getTime() - londonOffsetMin(day) * 60000);
    if (t <= from) continue;
    const wd = day.getUTCDay();
    if ((rhythm === "weekdays") && (wd === 0 || wd === 6)) continue;
    if (rhythm === "weekly" && wd !== 1) continue;
    if (rhythm === "monthly") {
      let first = 1;
      while ([0, 6].includes(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), first)).getUTCDay())) first++;
      if (day.getUTCDate() !== first) continue;
    }
    return t.toISOString();
  }
  return null;
}

/* ---------- Plan limits ---------- */
export const TRIAL_DAYS = 14;
export const trialOver = (org: { plan?: string; created_at: string }) => org.plan === "trial" && Date.now() - new Date(org.created_at).getTime() > TRIAL_DAYS * 864e5;
const TRIAL_ENDED = "Your free trial has ended. Choose a plan in Usage and plan to keep your agents working.";
/** Actions used this month across the whole business, against the plan's allowance. */
export async function orgActionsLeft(env: Env, org: { id: string; plan?: string }) {
  const used = ((await one<any>(env, "SELECT COUNT(*) AS n FROM usage_event WHERE org_id = ? AND kind = 'agent_action' AND at >= ?", org.id, nowIso().slice(0, 7) + "-01")) as any).n as number;
  return (PLANS[org.plan || "trial"] || PLANS.trial).actions - used;
}

/* ---------- Hiring ---------- */
export type HireInput = { template: string; name?: string; brief?: string; rhythm?: string; run_hour?: number; autonomy?: string; channel_id?: string | null; settings?: Record<string, unknown> };

export async function hireAgent(env: Env, orgId: string, userId: string, h: HireInput) {
  const t = template(h.template);
  if (!t) throw new HttpError(404, "not_found", "No agent by that name in the catalogue.");
  if (t.status !== "live") throw new HttpError(409, "not_yet", `${t.name} isn't available yet: it needs ${t.needs}.`);
  if (t.engine !== "llm" && (await one(env, "SELECT id FROM agent WHERE org_id = ? AND template = ?", orgId, t.key))) throw new HttpError(409, "already_hired", `${t.name} is already working for you.`);
  const org = await one<any>(env, "SELECT name, profile, plan, created_at FROM org WHERE id = ?", orgId);
  if (trialOver(org)) throw new HttpError(402, "trial_ended", TRIAL_ENDED);
  const plan = PLANS[org.plan] || PLANS.trial;
  const count = (await one<any>(env, "SELECT COUNT(*) AS n FROM agent WHERE org_id = ?", orgId)).n as number;
  if (count >= plan.agents) throw new HttpError(409, "plan_limit", `Your ${plan.name} plan includes ${plan.agents} ${plan.agents === 1 ? "agent" : "agents"}. Move to a bigger plan to hire more.`);
  const rhythm = h.rhythm && ["weekdays", "daily", "weekly", "monthly", "on_demand", "on_event"].includes(h.rhythm) ? h.rhythm : t.rhythm;
  const hour = Number.isInteger(h.run_hour) && h.run_hour! >= 0 && h.run_hour! <= 23 ? h.run_hour! : 8;
  const id = newId("agt");
  await run(env, `INSERT INTO agent (id, org_id, template, name, brief, settings, rhythm, run_hour, autonomy, channel_id, next_run_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, orgId, t.key, (h.name || t.name).slice(0, 80), (h.brief || t.brief({ name: org.name, ...JSON.parse(org.profile || "{}") })).slice(0, 4000),
    JSON.stringify(h.settings || {}), rhythm, hour, ["approve_all", "approve_first", "auto"].includes(h.autonomy || "") ? h.autonomy : "approve_all",
    h.channel_id || null, t.engine === "llm" ? nextRunAt(rhythm, hour) : null, userId, nowIso());
  // The register agents keep their own engines: switching one on here switches it on there.
  const engineKey = { watch: "watch", check: "check", prospect: "prospect" }[t.engine as string];
  if (engineKey) await run(env, "UPDATE agent_config SET on_ = 1, channel_id = COALESCE(?, channel_id) WHERE org_id = ? AND agent = ?", h.channel_id || null, orgId, engineKey);
  await audit(env, orgId, userId, "agent_hired", id, { template: t.key });
  return id;
}

export async function setAgentStatus(env: Env, orgId: string, agentId: string, status: "running" | "paused") {
  const a = await one<any>(env, "SELECT * FROM agent WHERE id = ? AND org_id = ?", agentId, orgId);
  if (!a) throw new HttpError(404, "not_found", "Agent not found.");
  const t = template(a.template)!;
  await run(env, "UPDATE agent SET status = ?, next_run_at = ? WHERE id = ?", status, status === "running" && t.engine === "llm" ? nextRunAt(a.rhythm, a.run_hour) : null, agentId);
  const engineKey = { watch: "watch", check: "check", prospect: "prospect" }[t.engine as string];
  if (engineKey) await run(env, "UPDATE agent_config SET on_ = ? WHERE org_id = ? AND agent = ?", status === "running" ? 1 : 0, orgId, engineKey);
}

/* ---------- Running ---------- */
export async function startRun(env: Env, orgId: string, agentId: string, trigger: "schedule" | "manual" | "event", input?: string) {
  const a = await one<any>(env, "SELECT * FROM agent WHERE id = ? AND org_id = ?", agentId, orgId);
  if (!a) throw new HttpError(404, "not_found", "Agent not found.");
  const t = template(a.template);
  if (!t || t.engine !== "llm") throw new HttpError(409, "not_runnable", "This agent runs on its own schedule from the registers.");
  if (t.key === "research" && !input?.trim()) throw new HttpError(400, "invalid_request", "Ask the research agent a question.");
  const org = await one<any>(env, "SELECT id, plan, created_at FROM org WHERE id = ?", orgId);
  if (trialOver(org)) throw new HttpError(402, "trial_ended", TRIAL_ENDED);
  if ((await orgActionsLeft(env, org)) <= 0) throw new HttpError(402, "allowance_used", "Your agents have used this month's actions. They start again on the 1st, or move to a bigger plan in Usage and plan.");
  const id = newId("run");
  await run(env, "INSERT INTO agent_run (id, org_id, agent_id, trigger, input, status, created_at) VALUES (?,?,?,?,?,?,?)", id, orgId, agentId, trigger, input?.slice(0, 4000) ?? null, "queued", nowIso());
  await env.JOBS.send({ type: "agent_run", run_id: id });
  return id;
}

type LoopOut = { messages: Msg[]; steps: number; toolCalls: { tool: string; input: any; ok: boolean; result?: any }[]; text: string; tokensIn: number; tokensOut: number };

/** The loop: Claude chooses tools, we run them, up to MAX_STEPS turns. */
export async function agentLoop(env: Env, o: { system: string; user: string; tools: Tool[]; ctx: ToolCtx; maxSteps?: number; budget?: () => Promise<boolean> }): Promise<LoopOut> {
  const messages: Msg[] = [{ role: "user", content: o.user }];
  const defs = toolDefs(o.tools);
  const byName = new Map(o.tools.map((t) => [t.slug, t]));
  const out: LoopOut = { messages, steps: 0, toolCalls: [], text: "", tokensIn: 0, tokensOut: 0 };
  for (let step = 0; step < (o.maxSteps || MAX_STEPS); step++) {
    const r = await claude(env, { system: o.system, messages, tools: defs });
    out.steps++; out.tokensIn += r.usage?.input_tokens || 0; out.tokensOut += r.usage?.output_tokens || 0;
    messages.push({ role: "assistant", content: r.content });
    const uses = r.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    out.text = r.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim() || out.text;
    if (!uses.length) break;
    const results: Block[] = [];
    for (const u of uses) {
      const tool = byName.get(u.name);
      if (o.budget && !(await o.budget())) { results.push({ type: "tool_result", tool_use_id: u.id, content: "Monthly action limit reached for this agent. Stop and summarise.", is_error: true }); continue; }
      try {
        if (!tool) throw new HttpError(400, "unknown_tool", `No tool called ${u.name}.`);
        const res = await runTool(o.ctx, tool, u.input);
        out.toolCalls.push({ tool: u.name, input: u.input, ok: true, result: res });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(res).slice(0, 14000) });
      } catch (e: any) {
        out.toolCalls.push({ tool: u.name, input: u.input, ok: false, result: e.message });
        results.push({ type: "tool_result", tool_use_id: u.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
    if (r.stop_reason !== "tool_use") break;
  }
  return out;
}

function systemFor(t: Template, agent: any, org: any) {
  const profile = { name: org.name, ...JSON.parse(org.profile || "{}") };
  const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "full" }).format(new Date());
  return [
    `You are "${agent.name}", an agent working for ${org.name}, a small UK business, inside Agent House.`,
    `TEMPLATE: ${t.key}`,
    `Today is ${today}.`,
    "", "Standing orders:", t.instructions || "",
    "", "The owner's brief (follow it where it is more specific):", agent.brief,
    "", "Business profile:", JSON.stringify(profile),
    "", "Rules: use only the tools given. Never invent facts, figures, names or email addresses. Anything sent to another person goes through propose-email; the owner may need to approve it. You have at most 8 steps. End with a short plain-English summary of what you did and what needs the owner.",
  ].join("\n");
}

/** Run one queued agent run. Safe to retry: a run that isn't queued is left alone. */
export async function runAgent(env: Env, runId: string) {
  const claim = await run(env, "UPDATE agent_run SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'", nowIso(), runId);
  if (!claim.meta.changes) return "skipped";
  const r = await one<any>(env, "SELECT * FROM agent_run WHERE id = ?", runId);
  const agent = await one<any>(env, "SELECT * FROM agent WHERE id = ?", r.agent_id);
  const org = await one<any>(env, "SELECT * FROM org WHERE id = ?", r.org_id);
  const t = agent && template(agent.template);
  try {
    if (!agent || !t) throw new Error("Agent no longer exists");
    if (trialOver(org)) throw new Error(TRIAL_ENDED);
    let orgLeft = await orgActionsLeft(env, org);
    if (orgLeft <= 0) throw new Error("This month's actions are used up. Agents start again on the 1st, or move to a bigger plan.");
    const tools = (await Promise.all(t.tools.map((s) => getTool(env, s, { business: true })))).filter(Boolean) as Tool[];
    const monthStart = nowIso().slice(0, 7) + "-01";
    let used = (await one<any>(env, "SELECT COALESCE(SUM(tool_calls),0) AS n FROM agent_run WHERE agent_id = ? AND created_at >= ?", agent.id, monthStart)).n as number;
    const out = await agentLoop(env, {
      system: systemFor(t, agent, org), user: [t.kickoff || "Do your work.", r.input || ""].filter(Boolean).join("\n\n"), tools,
      ctx: { env, orgId: org.id, agentId: agent.id, runId },
      budget: async () => used++ < agent.monthly_cap && orgLeft-- > 0,
    });
    const key = `runs/${org.id}/${runId}.json`;
    await env.FILES.put(key, JSON.stringify({ system: "(standing orders)", messages: out.messages, tool_calls: out.toolCalls }), { httpMetadata: { contentType: "application/json" } });
    const cost = modelCost(env, out.tokensIn, out.tokensOut);
    const waiting = (await one<any>(env, "SELECT COUNT(*) AS n FROM agent_action WHERE run_id = ? AND status = 'proposed'", runId)).n as number;
    await run(env, `UPDATE agent_run SET status = ?, steps = ?, tool_calls = ?, summary = ?, transcript_key = ?, tokens_in = ?, tokens_out = ?, cost_pence = ?, finished_at = ? WHERE id = ?`,
      waiting ? "waiting" : "done", out.steps, out.toolCalls.length, out.text.slice(0, 4000), key, out.tokensIn, out.tokensOut, cost, nowIso(), runId);
    await run(env, "UPDATE agent SET last_run_at = ? WHERE id = ?", nowIso(), agent.id);
    const stmts = out.toolCalls.map(() => env.DB.prepare("INSERT INTO usage_event (id, org_id, kind, units, cost_pence, payment, at) VALUES (?,?,?,1,0,'plan',?)").bind(newId("use"), org.id, "agent_action", nowIso()));
    stmts.push(env.DB.prepare("INSERT INTO usage_event (id, org_id, kind, units, cost_pence, payment, payment_ref, at) VALUES (?,?,?,1,?,'plan',?,?)").bind(newId("use"), org.id, "agent_run", cost, runId, nowIso()));
    await env.DB.batch(stmts);
    if (waiting) await notifyChannel(env, org.id, agent.channel_id, `${agent.name}: ${waiting} ${waiting === 1 ? "email" : "emails"} waiting for you`, `${out.text.slice(0, 600)}\n\nApprove or edit them here: ${env.APP_URL}#/workspace/approvals`);
    return waiting ? "waiting" : "done";
  } catch (e: any) {
    await run(env, "UPDATE agent_run SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", String(e.message || e).slice(0, 500), nowIso(), runId);
    console.error("agent run failed", runId, e);
    return "failed";
  }
}

/** Every 15 minutes: queue the agents that are due, and move their next run on. */
export async function dueAgents(env: Env, now = new Date()) {
  const due = await all<any>(env, "SELECT * FROM agent WHERE status = 'running' AND next_run_at IS NOT NULL AND next_run_at <= ?", now.toISOString());
  for (const a of due) {
    await run(env, "UPDATE agent SET next_run_at = ? WHERE id = ?", nextRunAt(a.rhythm, a.run_hour, now), a.id);
    try { await startRun(env, a.org_id, a.id, "schedule"); } catch (e) { console.error("could not start", a.id, e); }
  }
  return due.length;
}

/** An event for agents that run when something arrives (the inbox agent). */
export async function wakeOnEvent(env: Env, orgId: string, templateKey: string, input: string) {
  const agents = await all<any>(env, "SELECT id FROM agent WHERE org_id = ? AND template = ? AND status = 'running' AND rhythm = 'on_event'", orgId, templateKey);
  for (const a of agents) { try { await startRun(env, orgId, a.id, "event", input); } catch (e) { console.error("could not wake", a.id, e); } }
  return agents.length;
}

export { TEMPLATES };
