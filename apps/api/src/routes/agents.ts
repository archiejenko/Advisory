// Workspace routes for agents: the catalogue, hiring, runs, approvals, leads, tasks, invoices and inbox.
// Registered on the workspace router, so every route sits behind requireSession and the Scoped guard.
import type { Hono } from "hono";
import { z } from "zod";
import { newId, nowIso } from "../../../../packages/core/util";
import { parseCsv } from "../../../../packages/core/csv";
import { TEMPLATES, template, RHYTHM_LABEL } from "../../../../packages/core/templates";
import { type Env, audit } from "../lib/db";
import { body, bad, notFound, HttpError } from "../lib/http";
import { requireRole, type Vars } from "./auth";
import { hireAgent, setAgentStatus, startRun, nextRunAt, spreadMinute, estimateRun, modeFor } from "../lib/agents";
import { agentUsed, clearBudgetPause, pastRuns, periodOf } from "../lib/credits";
import { recommend, estimateRange, taskTypeOf } from "../../../../packages/core/modes";
import { modeLabel, showCredits } from "../../../../packages/core/credits";
import { MODES, MODELS, MODE_ORDER, type ModeKey } from "../../../../config/model-pricing";
import { RUNS_A_MONTH } from "../../../../packages/core/swarms";
import { executeAction, rejectAction } from "../lib/actions";
import { specFor, syncOrgSwarms } from "../lib/swarm";
import { logActivity } from "../lib/crm";
import { learnAfterApprove } from "./today";
import { logRemovedDrafts, LOG_TYPES } from "../lib/agentlog";
import { personaView } from "../../../../packages/core/personas";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const manager = requireRole("manager");
const Mode = z.enum(["quick", "standard", "deep", "strategy"]);
/** Runs that start without anyone there to confirm: on a schedule or when something arrives. */
const UNATTENDED = new Set(["weekdays", "daily", "weekly", "monthly", "on_event"]);

/** Every mode's likely credits for a job, cheapest first, with the one its job suits. */
async function modeChoices(env: Env, orgId: string, job: { template: string; text?: string | null }) {
  const rec = recommend(job);
  const past = await pastRuns(env, orgId, rec.task_type);
  const r = recommend(job, past);
  return {
    recommended: { mode: r.mode, reason: r.reason, low: r.low, high: r.high, from: r.from, task_type: r.task_type },
    modes: MODE_ORDER.map((k) => ({ mode: k, name: MODES[k].name, model: MODELS[MODES[k].model].label, label: modeLabel(k), for: MODES[k].for, ...estimateRange(k, past) })),
  };
}

/**
 * Setting an agent to run on its own in a mode likely to cost more than the business's threshold per run needs the
 * owner's say-so once, with what it means per month. Returns the per-run estimate they approved.
 */
async function confirmUnattended(c: any, a: { template: string; role?: string | null; instructions?: string | null }, mode: ModeKey, rhythm: string, confirm?: boolean) {
  const org = await c.get("db").one("SELECT confirm_over FROM org WHERE id = ?1");
  const est = await estimateRun(c.env, c.get("orgId"), a, mode);
  if (UNATTENDED.has(rhythm) && est.high > Number(org.confirm_over) && !confirm) {
    const runs = RUNS_A_MONTH[rhythm as keyof typeof RUNS_A_MONTH] || 0;
    throw new HttpError(409, "needs_confirmation", `In ${MODES[mode].name} mode this agent is likely to use ${est.low}–${est.high} credits a run, about ${(est.low * runs).toLocaleString("en-GB")}–${(est.high * runs).toLocaleString("en-GB")} a month on its schedule. Confirm to go ahead.`,
      { estimate: { low: est.low, high: est.high, mode, from: est.from, per_month: { low: est.low * runs, high: est.high * runs } }, threshold: Number(org.confirm_over) });
  }
  return est.high;
}
const tplOut = (t: (typeof TEMPLATES)[number], profile: any) => {
  const { brief, instructions, kickoff, ...rest } = t;
  return { ...rest, rhythm_label: RHYTHM_LABEL[t.rhythm], default_brief: brief(profile) };
};

export function registerAgentRoutes(ws: App) {
  /* ---------- Catalogue and overview ---------- */
  ws.get("/templates", async (c) => {
    const org = await c.get("db").one("SELECT name, profile FROM org WHERE id = ?1");
    const hired = await c.get("db").all("SELECT template, COUNT(*) AS n FROM agent WHERE org_id = ?1 GROUP BY template");
    const h = Object.fromEntries(hired.map((r: any) => [r.template, r.n]));
    return c.json({ templates: TEMPLATES.map((t) => ({ ...tplOut(t, { name: org.name, ...JSON.parse(org.profile || "{}") }), hired: h[t.key] || 0 })) });
  });

  ws.get("/overview", async (c) => {
    const db = c.get("db"), since = new Date(Date.now() - 7 * 864e5).toISOString(), today = nowIso().slice(0, 10);
    const n = async (sql: string, ...a: any[]) => ((await db.one(sql, ...a)) as any)?.n || 0;
    const activity = await db.all(`SELECT r.id, r.status, r.summary, r.created_at, r.trigger, g.name AS agent, g.template FROM agent_run r JOIN agent g ON g.id = r.agent_id WHERE r.org_id = ?1 ORDER BY r.created_at DESC LIMIT 8`);
    return c.json({
      agents_running: await n("SELECT COUNT(*) AS n FROM agent WHERE org_id = ?1 AND status = 'running'"),
      waiting: await n("SELECT COUNT(*) AS n FROM agent_action WHERE org_id = ?1 AND status = 'proposed'"),
      runs_week: await n("SELECT COUNT(*) AS n FROM agent_run WHERE org_id = ?1 AND created_at >= ?2", since),
      sent_week: await n("SELECT COUNT(*) AS n FROM agent_action WHERE org_id = ?1 AND status = 'sent' AND decided_at >= ?2", since),
      leads: await n("SELECT COUNT(*) AS n FROM lead WHERE org_id = ?1"),
      open_tasks: await n("SELECT COUNT(*) AS n FROM task WHERE org_id = ?1 AND status = 'open'"),
      overdue_invoices: await n("SELECT COUNT(*) AS n FROM invoice WHERE org_id = ?1 AND status = 'unpaid' AND due_date < ?2", today),
      open_alerts: await n("SELECT COUNT(*) AS n FROM alert WHERE org_id = ?1 AND state = 'open'"),
      inbox_new: await n("SELECT COUNT(*) AS n FROM inbox_message WHERE org_id = ?1 AND status = 'new'"),
      activity,
    });
  });

  /* ---------- My agents ---------- */
  const agentOut = (a: any) => {
    const t = template(a.template) || (a.template === "custom" ? { engine: "llm", category: "Run", glyph: "spark" } : undefined);
    return { id: a.id, template: a.template, swarm_id: a.swarm_id ?? null, role: a.role ?? null, name: a.name, brief: a.brief, settings: JSON.parse(a.settings || "{}"), status: a.status, rhythm: a.rhythm, rhythm_label: RHYTHM_LABEL[a.rhythm as keyof typeof RHYTHM_LABEL], run_hour: a.run_hour, autonomy: a.autonomy, channel_id: a.channel_id, mode: a.mode, mode_label: modeLabel(a.mode), monthly_budget: a.monthly_budget ?? null, budget_paused: a.budget_paused_period === periodOf(), next_run_at: a.next_run_at, last_run_at: a.last_run_at, created_at: a.created_at, engine: t?.engine, category: t?.category, glyph: t?.glyph, waiting: a.waiting ?? undefined, runs: a.runs ?? undefined, persona: a.persona ?? null, persona_view: personaView(a), probation_until: a.probation_until ?? null };
  };
  ws.get("/my-agents", async (c) => {
    const rows = await c.get("db").all(`SELECT a.*, (SELECT COUNT(*) FROM agent_action x WHERE x.agent_id = a.id AND x.status = 'proposed') AS waiting,
      (SELECT COUNT(*) FROM agent_run r WHERE r.agent_id = a.id) AS runs FROM agent a WHERE a.org_id = ?1 ORDER BY a.created_at`);
    return c.json({ agents: rows.map(agentOut) });
  });

  /** Which mode suits a job and what each mode would likely cost, for the hire and task forms. */
  ws.get("/recommend", async (c) => {
    const tpl = c.req.query("template") || "custom", text = (c.req.query("text") || "").slice(0, 2000);
    return c.json(await modeChoices(c.env, c.get("orgId"), { template: tpl, text: text || null }));
  });

  ws.post("/my-agents", manager, async (c) => {
    const b = await body(c, z.object({ template: z.string(), name: z.string().max(80).optional(), brief: z.string().max(4000).optional(), rhythm: z.string().optional(), run_hour: z.number().int().min(0).max(23).optional(), autonomy: z.enum(["approve_all", "approve_first", "auto"]).optional(), channel_id: z.string().nullable().optional(),
      mode: Mode.optional(), monthly_budget: z.number().min(1).max(1000000).nullable().optional(), confirm: z.boolean().optional() }));
    if (b.channel_id && !(await c.get("db").one("SELECT id FROM channel WHERE org_id = ?1 AND id = ?2", b.channel_id))) throw notFound("Channel");
    const t = template(b.template);
    const mode = b.mode || (t ? recommend({ template: t.key }).mode : "standard");
    const approved = t?.engine === "llm" ? await confirmUnattended(c, { template: b.template }, mode, b.rhythm || t.rhythm, b.confirm) : null;
    const id = await hireAgent(c.env, c.get("orgId"), c.get("user").id, { ...b, mode });
    if (approved != null) await c.get("db").run("UPDATE agent SET confirmed_estimate = ?3 WHERE org_id = ?1 AND id = ?2", id, approved);
    return c.json({ id, mode }, 201);
  });

  ws.get("/my-agents/:id", async (c) => {
    const db = c.get("db"), id = c.req.param("id");
    const a = await db.one("SELECT * FROM agent WHERE org_id = ?1 AND id = ?2", id);
    if (!a) throw notFound("Agent");
    const runs = (await db.all("SELECT id, trigger, status, steps, tool_calls, summary, error, mode, model, credits, created_at, finished_at FROM agent_run WHERE org_id = ?1 AND agent_id = ?2 ORDER BY created_at DESC LIMIT 20", id))
      .map((r: any) => ({ ...r, credits: r.steps ? showCredits(r.credits, { run: true }) : 0, mode_label: r.mode ? modeLabel(r.mode) : null }));
    const used = showCredits(await agentUsed(c.env, id));
    const org = await db.one("SELECT name, profile FROM org WHERE id = ?1");
    const t = template(a.template);
    const spec = specFor(a)!;
    const tpl = t ? tplOut(t, { name: org.name, ...JSON.parse(org.profile || "{}") })
      : { key: "custom", name: a.name, category: spec.category, glyph: spec.glyph, short: a.role || "A custom role in a swarm.", description: a.role || "", does: [], needs: "", status: "live", engine: "llm", rhythm: a.rhythm, rhythm_label: RHYTHM_LABEL[a.rhythm as keyof typeof RHYTHM_LABEL], tools: spec.tools, default_brief: a.brief };
    const choices = spec.engine === "llm" ? await modeChoices(c.env, c.get("orgId"), { template: a.template, text: a.template === "custom" ? `${a.role || ""} ${a.instructions || ""}` : null }) : null;
    return c.json({ agent: agentOut(a), runs, credits_this_month: used, choices, template: tpl });
  });

  /**
   * The agent's log, newest first. Filters: type (comma list), from and to (ISO dates), linked (key:value, e.g.
   * run:run_123 or action:act_456). Pages with cursor (the next_cursor of the page before).
   */
  ws.get("/my-agents/:id/log", async (c) => {
    const db = c.get("db"), id = c.req.param("id"), q = c.req.query();
    if (!(await db.one("SELECT id FROM agent WHERE org_id = ?1 AND id = ?2", id))) throw notFound("Agent");
    const where: string[] = [], args: any[] = [id];
    const arg = (v: unknown) => { args.push(v); return `?${args.length + 1}`; };
    const types = (q.type || "").split(",").map((t) => t.trim()).filter(Boolean);
    if (types.some((t) => !(LOG_TYPES as readonly string[]).includes(t))) throw bad(`type must be one or more of ${LOG_TYPES.join(", ")}.`);
    if (types.length) where.push(`type IN (${types.map(arg).join(",")})`);
    for (const [k, op] of [["from", ">="], ["to", "<="]] as const) {
      if (!q[k]) continue;
      const d = new Date(q[k]);
      if (isNaN(d.getTime())) throw bad(`${k} must be a date, like 2026-10-01.`);
      // A bare date for "to" means the whole of that day.
      where.push(`at ${op} ${arg(k === "to" && /^\d{4}-\d{2}-\d{2}$/.test(q[k]) ? `${q[k]}T23:59:59.999Z` : d.toISOString())}`);
    }
    if (q.linked) {
      const m = /^(run|action|task|item|lead|invoice|rule|agent):(.{1,80})$/.exec(q.linked);
      if (!m) throw bad("linked must look like run:<id>, action:<id>, task:<id>, item:<id>, lead:<id>, invoice:<id>, rule:<id> or agent:<id>.");
      where.push(`json_extract(linked, ${arg("$." + m[1])}) = ${arg(m[2])}`);
    }
    if (q.cursor) {
      if (!/^\d+$/.test(q.cursor)) throw bad("cursor must be the next_cursor of the page before.");
      where.push(`id < ${arg(Number(q.cursor))}`);
    }
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const rows = await db.all(`SELECT id, type, summary, detail, linked, run_id, action_id, mode, tokens_in, tokens_out, credits, autonomy_level, undo_token, at FROM agent_log WHERE org_id = ?1 AND agent_id = ?2${where.map((w) => " AND " + w).join("")} ORDER BY id DESC LIMIT ${limit + 1}`, ...args);
    const page = rows.slice(0, limit).map((r: any) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null, linked: r.linked ? JSON.parse(r.linked) : {}, credits: Math.round(r.credits * 100) / 100 }));
    return c.json({ entries: page, next_cursor: rows.length > limit ? String(page[page.length - 1].id) : null });
  });

  ws.patch("/my-agents/:id", manager, async (c) => {
    const b = await body(c, z.object({ name: z.string().min(1).max(80).optional(), brief: z.string().min(1).max(4000).optional(), status: z.enum(["running", "paused"]).optional(), rhythm: z.enum(["weekdays", "daily", "weekly", "monthly", "on_demand", "on_event"]).optional(), run_hour: z.number().int().min(0).max(23).optional(), autonomy: z.enum(["approve_all", "approve_first", "auto"]).optional(), channel_id: z.string().nullable().optional(),
      mode: Mode.optional(), monthly_budget: z.number().min(1).max(1000000).nullable().optional(), confirm: z.boolean().optional() }));
    const db = c.get("db"), id = c.req.param("id")!;
    const a = await db.one("SELECT * FROM agent WHERE org_id = ?1 AND id = ?2", id);
    if (!a) throw notFound("Agent");
    if (b.channel_id && !(await db.one("SELECT id FROM channel WHERE org_id = ?1 AND id = ?2", b.channel_id))) throw notFound("Channel");
    // A new mode or schedule for an agent that runs on its own may need the owner's say-so on what it will cost.
    if ((b.mode !== undefined && b.mode !== a.mode) || (b.rhythm !== undefined && b.rhythm !== a.rhythm)) {
      if (specFor(a)?.engine === "llm") {
        const approved = await confirmUnattended(c, a, modeFor(a, b.mode), b.rhythm ?? a.rhythm, b.confirm);
        await db.run("UPDATE agent SET confirmed_estimate = ?3 WHERE org_id = ?1 AND id = ?2", id, approved);
      }
    }
    for (const k of ["name", "brief", "rhythm", "run_hour", "autonomy", "channel_id", "mode", "monthly_budget"] as const) {
      if (b[k] !== undefined) await db.run(`UPDATE agent SET ${k} = ?3 WHERE org_id = ?1 AND id = ?2`, id, b[k]);
    }
    if (b.monthly_budget !== undefined) await clearBudgetPause(c.env, id);
    if (b.rhythm !== undefined || b.run_hour !== undefined) {
      const t = specFor(a)!;
      await db.run("UPDATE agent SET next_run_at = ?3 WHERE org_id = ?1 AND id = ?2", id, t.engine === "llm" && a.status === "running" ? nextRunAt(b.rhythm ?? a.rhythm, b.run_hour ?? a.run_hour, new Date(), spreadMinute(id)) : null);
    }
    const engineKey = ({ watch: "watch", check: "check", prospect: "prospect" } as Record<string, string>)[template(a.template)?.engine || ""];
    if (engineKey && b.channel_id !== undefined) await db.run("UPDATE agent_config SET channel_id = ?3 WHERE org_id = ?1 AND agent = ?2", engineKey, b.channel_id);
    if (b.status) await setAgentStatus(c.env, c.get("orgId"), id, b.status);
    await audit(c.env, c.get("orgId"), c.get("user").id, "agent_updated", id, b);
    return c.json({ ok: true });
  });

  ws.delete("/my-agents/:id", manager, async (c) => {
    const id = c.req.param("id")!;
    const a = await c.get("db").one("SELECT * FROM agent WHERE org_id = ?1 AND id = ?2", id);
    if (!a) throw notFound("Agent");
    await setAgentStatus(c.env, c.get("orgId"), id, "paused");
    await c.get("db").run("DELETE FROM agent WHERE org_id = ?1 AND id = ?2", id);
    await logRemovedDrafts(c.env, c.get("orgId"), id);
    await c.get("db").run("UPDATE agent_action SET status = 'rejected', decided_by = 'removed' WHERE org_id = ?1 AND agent_id = ?2 AND status = 'proposed'", id);
    await audit(c.env, c.get("orgId"), c.get("user").id, "agent_removed", id);
    return c.json({ ok: true });
  });

  ws.post("/my-agents/:id/run", manager, async (c) => {
    const b = await body(c, z.object({ input: z.string().max(4000).optional(), mode: Mode.optional(), confirm: z.boolean().optional() }));
    // A person is here, so a run likely to cost more than the threshold asks them first (409 with the estimate).
    const id = await startRun(c.env, c.get("orgId"), c.req.param("id")!, "manual", b.input, { mode: b.mode, confirm: b.confirm ?? false });
    return c.json({ run_id: id, status: "queued" }, 202);
  });

  /* ---------- Runs ---------- */
  ws.get("/runs", async (c) => {
    const agent = c.req.query("agent");
    const rows = await c.get("db").all(`SELECT r.id, r.agent_id, g.name AS agent, g.template, r.trigger, r.status, r.steps, r.tool_calls, r.summary, r.error, r.mode, r.model, r.credits, r.created_at, r.finished_at
      FROM agent_run r LEFT JOIN agent g ON g.id = r.agent_id WHERE r.org_id = ?1 ${agent ? "AND r.agent_id = ?2" : ""} ORDER BY r.created_at DESC LIMIT 100`, ...(agent ? [agent] : []));
    return c.json({ runs: rows });
  });

  ws.get("/runs/:id", async (c) => {
    const r = await c.get("db").one("SELECT r.*, g.name AS agent, g.template FROM agent_run r LEFT JOIN agent g ON g.id = r.agent_id WHERE r.org_id = ?1 AND r.id = ?2", c.req.param("id"));
    if (!r) throw notFound("Run");
    let steps: any[] = [];
    if (r.transcript_key) {
      const obj = await c.env.FILES.get(r.transcript_key);
      if (obj) steps = ((await obj.json<any>()).tool_calls || []).map((t: any) => ({ tool: t.tool, input: t.input, ok: t.ok, result: typeof t.result === "string" ? t.result : JSON.stringify(t.result).slice(0, 1500) }));
    }
    const actions = await c.get("db").all("SELECT id, title, status, created_at FROM agent_action WHERE org_id = ?1 AND run_id = ?2", r.id);
    return c.json({ run: { id: r.id, agent: r.agent, agent_id: r.agent_id, template: r.template, trigger: r.trigger, input: r.input, status: r.status, steps: r.steps, tool_calls: r.tool_calls, summary: r.summary, error: r.error, cost_pence: r.cost_pence, created_at: r.created_at, finished_at: r.finished_at }, steps, actions });
  });

  /* ---------- Approvals ---------- */
  ws.get("/actions", async (c) => {
    const status = c.req.query("status") || "proposed";
    const rows = await c.get("db").all(`SELECT x.*, g.name AS agent, g.template FROM agent_action x LEFT JOIN agent g ON g.id = x.agent_id WHERE x.org_id = ?1 ${status === "all" ? "" : "AND x.status = ?2"} ORDER BY x.created_at DESC LIMIT 100`, ...(status === "all" ? [] : [status]));
    const counts = await c.get("db").one("SELECT SUM(status='proposed') AS proposed, SUM(status='sent') AS sent, SUM(status='rejected') AS rejected, SUM(status='failed') AS failed FROM agent_action WHERE org_id = ?1");
    return c.json({ counts: { proposed: counts?.proposed || 0, sent: counts?.sent || 0, rejected: counts?.rejected || 0, failed: counts?.failed || 0 }, actions: rows.map((x: any) => ({ id: x.id, agent: x.agent, agent_id: x.agent_id, template: x.template, run_id: x.run_id, kind: x.kind, title: x.title, payload: JSON.parse(x.payload), reason: x.reason, status: x.status, decided_by: x.decided_by, decided_at: x.decided_at, result: x.result, created_at: x.created_at })) });
  });

  ws.post("/actions/:id/approve", manager, async (c) => {
    const b = await body(c, z.object({ subject: z.string().min(1).max(200).optional(), body: z.string().min(1).max(5000).optional() }));
    const before = await c.get("db").one("SELECT payload FROM agent_action WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
    const r = await executeAction(c.env, c.get("orgId"), c.req.param("id")!, c.get("user").email, b);
    await syncOrgSwarms(c.env, c.get("orgId"));
    // What the owner changed becomes a proposed house rule, when it's a preference rather than a fact about this email.
    if (before) await learnAfterApprove(c, c.req.param("id")!, JSON.parse(before.payload || "{}"), b);
    return c.json(r);
  });
  ws.post("/actions/:id/reject", manager, async (c) => {
    await rejectAction(c.env, c.get("orgId"), c.req.param("id")!, c.get("user").email);
    return c.json({ ok: true });
  });

  /* ---------- Leads, tasks ---------- */
  ws.get("/leads", async (c) => {
    const status = c.req.query("status");
    const rows = await c.get("db").all(`SELECT l.*, (SELECT COUNT(*) FROM agent_action a WHERE a.org_id = l.org_id AND a.status = 'sent' AND json_extract(a.payload, '$.lead_id') = l.id) AS emails_sent FROM lead l WHERE l.org_id = ?1 ${status ? "AND l.status = ?2" : ""} ORDER BY l.created_at DESC LIMIT 500`, ...(status ? [status] : []));
    return c.json({ leads: rows });
  });
  ws.patch("/leads/:id", manager, async (c) => {
    const b = await body(c, z.object({ status: z.enum(["new", "contacted", "replied", "won", "lost", "unsubscribed"]).optional(), notes: z.string().max(2000).nullable().optional(), email: z.string().email().nullable().optional() }));
    const db = c.get("db"), id = c.req.param("id");
    if (!(await db.one("SELECT id FROM lead WHERE org_id = ?1 AND id = ?2", id))) throw notFound("Lead");
    if (b.status) {
      await db.run("UPDATE lead SET status = ?3 WHERE org_id = ?1 AND id = ?2", id, b.status);
      await logActivity(c.env, { orgId: c.get("orgId"), leadId: id, actor: c.get("user").email, kind: b.status === "won" ? "won" : "stage", summary: `Marked ${b.status}` });
    }
    if (b.notes !== undefined) await db.run("UPDATE lead SET notes = ?3 WHERE org_id = ?1 AND id = ?2", id, b.notes);
    if (b.email !== undefined) await db.run("UPDATE lead SET email = ?3 WHERE org_id = ?1 AND id = ?2", id, b.email?.toLowerCase() ?? null);
    if (b.status || b.email !== undefined) await syncOrgSwarms(c.env, c.get("orgId"));
    return c.json({ ok: true });
  });

  // One task list for people and agents: who raised it (an agent, or a person) and who it's for.
  ws.get("/tasks", async (c) => {
    const mine = c.req.query("mine") === "1";
    const tasks = await c.get("db").all(`SELECT t.*, g.name AS agent, u.name AS assignee_name, u.email AS assignee_email FROM task t LEFT JOIN agent g ON g.id = t.agent_id LEFT JOIN user u ON u.id = t.assignee_user_id
      WHERE t.org_id = ?1 ${mine ? "AND t.assignee_user_id = ?2" : ""} ORDER BY t.status = 'done', COALESCE(t.due_date, '9999'), t.created_at DESC LIMIT 200`, ...(mine ? [c.get("user").id] : []));
    return c.json({ tasks });
  });
  const assignee = async (c: any, id: string | null | undefined) => {
    if (!id) return null;
    if (!(await c.get("db").one("SELECT user_id FROM membership WHERE org_id = ?1 AND user_id = ?2", id))) throw bad("That person isn't in this workspace.");
    return id;
  };
  ws.post("/tasks", manager, async (c) => {
    const b = await body(c, z.object({ title: z.string().min(1).max(200), detail: z.string().max(1000).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), assignee_user_id: z.string().max(60).nullable().optional() }));
    const id = newId("task");
    await c.get("db").run("INSERT INTO task (org_id, id, title, detail, due_date, assignee_user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", id, b.title, b.detail ?? null, b.due_date ?? null, await assignee(c, b.assignee_user_id), nowIso());
    return c.json({ id }, 201);
  });
  ws.patch("/tasks/:id", manager, async (c) => {
    const b = await body(c, z.object({ status: z.enum(["open", "done"]).optional(), assignee_user_id: z.string().max(60).nullable().optional() }));
    if (!b.status && b.assignee_user_id === undefined) throw bad("Say what to change: the status or who it's for.");
    const who = b.assignee_user_id === undefined ? undefined : await assignee(c, b.assignee_user_id);
    const r = await c.get("db").run(`UPDATE task SET status = COALESCE(?3, status), done_at = CASE WHEN ?3 = 'done' THEN ?4 WHEN ?3 = 'open' THEN NULL ELSE done_at END${who !== undefined ? ", assignee_user_id = ?5" : ""} WHERE org_id = ?1 AND id = ?2`,
      c.req.param("id"), b.status ?? null, nowIso(), ...(who !== undefined ? [who] : []));
    if (!r.meta.changes) throw notFound("Task");
    return c.json({ ok: true });
  });

  /* ---------- Invoices (for credit control) ---------- */
  ws.get("/invoices", async (c) => {
    const today = nowIso().slice(0, 10);
    const rows = await c.get("db").all("SELECT i.*, CAST(julianday(?2) - julianday(i.due_date) AS INTEGER) AS days_overdue FROM invoice i WHERE i.org_id = ?1 ORDER BY i.status = 'paid', i.due_date LIMIT 1000", today);
    return c.json({ today, invoices: rows });
  });

  ws.post("/invoices/import", manager, async (c) => {
    const form = await c.req.formData();
    const file = form.get("file") as unknown as File | null;
    if (!file || typeof file === "string") throw bad("Attach your invoices as a CSV file.");
    if (!/\.csv$/i.test(file.name)) throw bad("Upload a CSV. In Excel, use File, Save as, CSV.");
    const rows = parseCsv(await file.text());
    if (rows.length < 2) throw bad("The file has no invoices in it.");
    const h = rows[0].map((x) => x.trim().toLowerCase());
    const col = (...names: string[]) => h.findIndex((x) => names.some((n) => x === n || x.includes(n)));
    const I = { ref: col("invoice", "ref", "number"), customer: col("customer", "client", "name"), email: col("email"), amount: col("amount", "total", "value"), due: col("due") };
    if (I.ref < 0 || I.customer < 0 || I.amount < 0 || I.due < 0) throw bad("We need columns for the invoice reference, customer, amount and due date. Email is optional but needed for reminders.");
    let added = 0, updated = 0; const skipped: number[] = [];
    const db = c.get("db");
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const ref = (row[I.ref] || "").trim(), customer = (row[I.customer] || "").trim();
      const amount = Math.round(Number(String(row[I.amount] || "").replace(/[£,\s]/g, "")) * 100);
      const dueRaw = (row[I.due] || "").trim();
      const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : /^\d{2}\/\d{2}\/\d{4}$/.test(dueRaw) ? `${dueRaw.slice(6)}-${dueRaw.slice(3, 5)}-${dueRaw.slice(0, 2)}` : null;
      const email = I.email >= 0 ? (row[I.email] || "").trim().toLowerCase() || null : null;
      if (!ref || !customer || !Number.isFinite(amount) || amount <= 0 || !due) { skipped.push(r + 1); continue; }
      const exists = await db.one("SELECT id FROM invoice WHERE org_id = ?1 AND ref = ?2", ref);
      if (exists) {
        await db.run("UPDATE invoice SET customer = ?3, email = COALESCE(?4, email), amount_pence = ?5, due_date = ?6 WHERE org_id = ?1 AND id = ?2", exists.id, customer, email, amount, due);
        updated++;
      } else {
        await db.run("INSERT INTO invoice (org_id, id, ref, customer, email, amount_pence, due_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", newId("inv"), ref, customer, email, amount, due, nowIso());
        added++;
      }
    }
    await audit(c.env, c.get("orgId"), c.get("user").id, "invoices_imported", undefined, { rows: rows.length - 1, skipped: skipped.length });
    await syncOrgSwarms(c.env, c.get("orgId"));
    return c.json({ imported: added, updated, skipped_rows: skipped }, 201);
  });

  ws.patch("/invoices/:id", manager, async (c) => {
    const b = await body(c, z.object({ status: z.enum(["unpaid", "paid", "disputed"]) }));
    const r = await c.get("db").run("UPDATE invoice SET status = ?3 WHERE org_id = ?1 AND id = ?2", c.req.param("id"), b.status);
    if (!r.meta.changes) throw notFound("Invoice");
    await syncOrgSwarms(c.env, c.get("orgId"));
    return c.json({ ok: true });
  });

  /* ---------- Inbox ---------- */
  ws.get("/inbox", async (c) => {
    const org = await c.get("db").one("SELECT inbox_alias FROM org WHERE id = ?1");
    return c.json({
      address: org.inbox_alias ? `${org.inbox_alias}@${c.env.INBOUND_DOMAIN || "in.agenthouse.example"}` : null,
      messages: await c.get("db").all("SELECT id, from_addr, subject, substr(body, 1, 600) AS body, status, urgency, category, summary, received_at FROM inbox_message WHERE org_id = ?1 ORDER BY received_at DESC LIMIT 100"),
    });
  });
}

