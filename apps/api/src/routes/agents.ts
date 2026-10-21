// Workspace routes for agents: the catalogue, hiring, runs, approvals, leads, tasks, invoices and inbox.
// Registered on the workspace router, so every route sits behind requireSession and the Scoped guard.
import type { Hono } from "hono";
import { z } from "zod";
import { newId, nowIso } from "../../../../packages/core/util";
import { parseCsv } from "../../../../packages/core/csv";
import { TEMPLATES, template, RHYTHM_LABEL } from "../../../../packages/core/templates";
import { type Env, audit } from "../lib/db";
import { body, bad, notFound } from "../lib/http";
import { requireRole, type Vars } from "./auth";
import { hireAgent, setAgentStatus, startRun, nextRunAt } from "../lib/agents";
import { executeAction, rejectAction } from "../lib/actions";
import { specFor, syncOrgSwarms } from "../lib/swarm";
import { logActivity } from "../lib/crm";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const manager = requireRole("manager");
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
    return { id: a.id, template: a.template, swarm_id: a.swarm_id ?? null, role: a.role ?? null, name: a.name, brief: a.brief, settings: JSON.parse(a.settings || "{}"), status: a.status, rhythm: a.rhythm, rhythm_label: RHYTHM_LABEL[a.rhythm as keyof typeof RHYTHM_LABEL], run_hour: a.run_hour, autonomy: a.autonomy, channel_id: a.channel_id, monthly_cap: a.monthly_cap, next_run_at: a.next_run_at, last_run_at: a.last_run_at, created_at: a.created_at, engine: t?.engine, category: t?.category, glyph: t?.glyph, waiting: a.waiting ?? undefined, runs: a.runs ?? undefined };
  };
  ws.get("/my-agents", async (c) => {
    const rows = await c.get("db").all(`SELECT a.*, (SELECT COUNT(*) FROM agent_action x WHERE x.agent_id = a.id AND x.status = 'proposed') AS waiting,
      (SELECT COUNT(*) FROM agent_run r WHERE r.agent_id = a.id) AS runs FROM agent a WHERE a.org_id = ?1 ORDER BY a.created_at`);
    return c.json({ agents: rows.map(agentOut) });
  });

  ws.post("/my-agents", manager, async (c) => {
    const b = await body(c, z.object({ template: z.string(), name: z.string().max(80).optional(), brief: z.string().max(4000).optional(), rhythm: z.string().optional(), run_hour: z.number().int().min(0).max(23).optional(), autonomy: z.enum(["approve_all", "approve_first", "auto"]).optional(), channel_id: z.string().nullable().optional() }));
    if (b.channel_id && !(await c.get("db").one("SELECT id FROM channel WHERE org_id = ?1 AND id = ?2", b.channel_id))) throw notFound("Channel");
    const id = await hireAgent(c.env, c.get("orgId"), c.get("user").id, b);
    return c.json({ id }, 201);
  });

  ws.get("/my-agents/:id", async (c) => {
    const db = c.get("db"), id = c.req.param("id");
    const a = await db.one("SELECT * FROM agent WHERE org_id = ?1 AND id = ?2", id);
    if (!a) throw notFound("Agent");
    const runs = await db.all("SELECT id, trigger, status, steps, tool_calls, summary, error, cost_pence, created_at, finished_at FROM agent_run WHERE org_id = ?1 AND agent_id = ?2 ORDER BY created_at DESC LIMIT 20", id);
    const month = nowIso().slice(0, 7) + "-01";
    const used = ((await db.one("SELECT COALESCE(SUM(tool_calls),0) AS n FROM agent_run WHERE org_id = ?1 AND agent_id = ?2 AND created_at >= ?3", id, month)) as any).n;
    const org = await db.one("SELECT name, profile FROM org WHERE id = ?1");
    const t = template(a.template);
    const spec = specFor(a)!;
    const tpl = t ? tplOut(t, { name: org.name, ...JSON.parse(org.profile || "{}") })
      : { key: "custom", name: a.name, category: spec.category, glyph: spec.glyph, short: a.role || "A custom role in a swarm.", description: a.role || "", does: [], needs: "", status: "live", engine: "llm", rhythm: a.rhythm, rhythm_label: RHYTHM_LABEL[a.rhythm as keyof typeof RHYTHM_LABEL], tools: spec.tools, default_brief: a.brief };
    return c.json({ agent: agentOut(a), runs, actions_this_month: used, template: tpl });
  });

  ws.patch("/my-agents/:id", manager, async (c) => {
    const b = await body(c, z.object({ name: z.string().min(1).max(80).optional(), brief: z.string().min(1).max(4000).optional(), status: z.enum(["running", "paused"]).optional(), rhythm: z.enum(["weekdays", "daily", "weekly", "monthly", "on_demand", "on_event"]).optional(), run_hour: z.number().int().min(0).max(23).optional(), autonomy: z.enum(["approve_all", "approve_first", "auto"]).optional(), channel_id: z.string().nullable().optional(), monthly_cap: z.number().int().min(10).max(10000).optional() }));
    const db = c.get("db"), id = c.req.param("id")!;
    const a = await db.one("SELECT * FROM agent WHERE org_id = ?1 AND id = ?2", id);
    if (!a) throw notFound("Agent");
    if (b.channel_id && !(await db.one("SELECT id FROM channel WHERE org_id = ?1 AND id = ?2", b.channel_id))) throw notFound("Channel");
    for (const k of ["name", "brief", "rhythm", "run_hour", "autonomy", "channel_id", "monthly_cap"] as const) {
      if (b[k] !== undefined) await db.run(`UPDATE agent SET ${k} = ?3 WHERE org_id = ?1 AND id = ?2`, id, b[k]);
    }
    if (b.rhythm !== undefined || b.run_hour !== undefined) {
      const t = specFor(a)!;
      await db.run("UPDATE agent SET next_run_at = ?3 WHERE org_id = ?1 AND id = ?2", id, t.engine === "llm" && a.status === "running" ? nextRunAt(b.rhythm ?? a.rhythm, b.run_hour ?? a.run_hour) : null);
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
    await c.get("db").run("UPDATE agent_action SET status = 'rejected', decided_by = 'removed' WHERE org_id = ?1 AND agent_id = ?2 AND status = 'proposed'", id);
    await audit(c.env, c.get("orgId"), c.get("user").id, "agent_removed", id);
    return c.json({ ok: true });
  });

  ws.post("/my-agents/:id/run", manager, async (c) => {
    const b = await body(c, z.object({ input: z.string().max(4000).optional() }));
    const id = await startRun(c.env, c.get("orgId"), c.req.param("id")!, "manual", b.input);
    return c.json({ run_id: id, status: "queued" }, 202);
  });

  /* ---------- Runs ---------- */
  ws.get("/runs", async (c) => {
    const agent = c.req.query("agent");
    const rows = await c.get("db").all(`SELECT r.id, r.agent_id, g.name AS agent, g.template, r.trigger, r.status, r.steps, r.tool_calls, r.summary, r.error, r.cost_pence, r.created_at, r.finished_at
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
    const r = await executeAction(c.env, c.get("orgId"), c.req.param("id")!, c.get("user").email, b);
    await syncOrgSwarms(c.env, c.get("orgId"));
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

  ws.get("/tasks", async (c) => c.json({ tasks: await c.get("db").all("SELECT t.*, g.name AS agent FROM task t LEFT JOIN agent g ON g.id = t.agent_id WHERE t.org_id = ?1 ORDER BY t.status = 'done', COALESCE(t.due_date, '9999'), t.created_at DESC LIMIT 200") }));
  ws.post("/tasks", manager, async (c) => {
    const b = await body(c, z.object({ title: z.string().min(1).max(200), detail: z.string().max(1000).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
    const id = newId("task");
    await c.get("db").run("INSERT INTO task (org_id, id, title, detail, due_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", id, b.title, b.detail ?? null, b.due_date ?? null, nowIso());
    return c.json({ id }, 201);
  });
  ws.patch("/tasks/:id", manager, async (c) => {
    const b = await body(c, z.object({ status: z.enum(["open", "done"]) }));
    const r = await c.get("db").run("UPDATE task SET status = ?3, done_at = ?4 WHERE org_id = ?1 AND id = ?2", c.req.param("id"), b.status, b.status === "done" ? nowIso() : null);
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

