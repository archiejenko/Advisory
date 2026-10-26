// Workspace routes for swarms and the Floor, the CRM, and voice. Registered on the workspace router,
// so every route sits behind requireSession; the org id always comes from the session.
import type { Hono } from "hono";
import { z } from "zod";
import { newId, nowIso } from "../../../../packages/core/util";
import { PRESETS, preset } from "../../../../packages/core/swarms";
import { type Env, one, all, run, audit } from "../lib/db";
import { body, bad, notFound, HttpError } from "../lib/http";
import { requireRole, type Vars } from "./auth";
import { setAgentStatus } from "../lib/agents";
import { floorState, loadSwarm, syncSwarm, syncOrgSwarms, emit } from "../lib/swarm";
import { createSwarm, removeSwarm, planBlueprint, previewFor, ask, briefText, setGoal } from "../lib/engine";
import { orgState, applyOrg, ownerTask } from "../lib/org";
import { companies, companyView, saveContact, saveDeal, logActivity } from "../lib/crm";
import { transcribe, speak, voiceAvailable } from "../lib/voice";
import { hit } from "../lib/limits";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const manager = requireRole("manager"), owner = requireRole("owner");

export function registerSwarmRoutes(ws: App) {
  /* ---------- Presets and spinning up ---------- */
  ws.get("/swarm-presets", (c) => c.json({ presets: PRESETS.map((p) => ({ key: p.key, title: p.title, for: p.for, summary: p.summary, locked: p.locked ?? null, skin: p.blueprint.skin, agents: p.blueprint.agents.map((a) => ({ key: a.key, name: a.name, role: a.role, template: a.template, rhythm: a.rhythm })), stages: p.blueprint.stages.map((s) => s.name), handoffs: p.blueprint.handoffs, kpis: p.blueprint.kpis })), voice: voiceAvailable(c.env) }));

  ws.get("/swarms", async (c) => c.json({ swarms: await c.get("db").all(`SELECT s.id, s.name, s.sector, s.preset, s.status, s.created_at,
    (SELECT COUNT(*) FROM agent a WHERE a.swarm_id = s.id) AS agents,
    (SELECT COUNT(*) FROM work_item w WHERE w.swarm_id = s.id AND w.status = 'open') AS open_items
    FROM swarm s WHERE s.org_id = ?1 ORDER BY s.created_at DESC`) }));

  ws.post("/swarms/plan", manager, async (c) => {
    const b = await body(c, z.object({ description: z.string().min(10, "Tell us a sentence or two about the business.").max(2000) }));
    return c.json(await planBlueprint(c.env, c.get("orgId"), b.description));
  });

  ws.post("/swarms/preview", manager, async (c) => {
    const b = await body(c, z.object({ preset: z.string().optional(), blueprint: z.unknown().optional() }));
    const bp = b.preset ? preset(b.preset)?.blueprint : (b.blueprint as any);
    if (!bp) throw notFound("Preset");
    return c.json({ preview: await previewFor(c.env, c.get("orgId"), bp) });
  });

  ws.post("/swarms", manager, async (c) => {
    const b = await body(c, z.object({ preset: z.string().optional(), blueprint: z.unknown().optional(), description: z.string().max(2000).optional() }));
    let bp: unknown = b.blueprint;
    if (b.preset) {
      const p = preset(b.preset);
      if (!p) throw notFound("Preset");
      if (p.locked) throw new HttpError(409, "needs_connection", p.locked);
      bp = p.blueprint;
    }
    if (!bp) throw bad("Choose a preset or send a blueprint.");
    const r = await createSwarm(c.env, c.get("orgId"), c.get("user").id, bp, { preset: b.preset ?? null, description: b.description ?? null });
    return c.json(r, 201);
  });

  /* ---------- The Floor ---------- */
  ws.get("/swarms/:id", async (c) => {
    const since = Number(c.req.query("since") || 0) || undefined;
    return c.json(await floorState(c.env, c.get("orgId"), c.req.param("id")!, since));
  });

  ws.get("/swarms/:id/events", async (c) => {
    await loadSwarm(c.env, c.get("orgId"), c.req.param("id")!);
    const since = Number(c.req.query("since") || 0);
    const rows = await c.get("db").all("SELECT id, agent_id, run_id, item_id, kind, summary, detail, at FROM swarm_event WHERE org_id = ?1 AND swarm_id = ?2 AND id > ?3 ORDER BY id LIMIT 200", c.req.param("id"), since);
    return c.json({ events: rows.map((e: any) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })) });
  });

  ws.patch("/swarms/:id", manager, async (c) => {
    const b = await body(c, z.object({ name: z.string().min(1).max(60).optional(), status: z.enum(["running", "paused"]).optional(), layout: z.record(z.unknown()).optional() }));
    const id = c.req.param("id")!, orgId = c.get("orgId");
    await loadSwarm(c.env, orgId, id);
    if (b.layout && JSON.stringify(b.layout).length > 20000) throw bad("That layout is too large.");
    const db = c.get("db");
    if (b.name) await db.run("UPDATE swarm SET name = ?3 WHERE org_id = ?1 AND id = ?2", id, b.name);
    if (b.layout) await db.run("UPDATE swarm SET layout = ?3 WHERE org_id = ?1 AND id = ?2", id, JSON.stringify(b.layout));
    if (b.status) {
      await db.run("UPDATE swarm SET status = ?3 WHERE org_id = ?1 AND id = ?2", id, b.status);
      for (const a of await db.all("SELECT id FROM agent WHERE org_id = ?1 AND swarm_id = ?2", id)) await setAgentStatus(c.env, orgId, (a as any).id, b.status);
      await emit(c.env, { orgId, swarmId: id, kind: "ask", summary: b.status === "paused" ? "You paused the swarm" : "You resumed the swarm" });
    }
    await audit(c.env, orgId, c.get("user").id, "swarm_updated", id, { name: b.name, status: b.status, layout: !!b.layout });
    return c.json({ ok: true });
  });

  ws.delete("/swarms/:id", owner, async (c) => {
    await removeSwarm(c.env, c.get("orgId"), c.req.param("id")!, c.get("user").id);
    return c.json({ ok: true });
  });

  ws.post("/swarms/:id/ask", manager, async (c) => {
    const b = await body(c, z.object({ text: z.string().min(1).max(1000), voice: z.boolean().optional() }));
    return c.json(await ask(c.env, c.get("orgId"), c.req.param("id")!, b.text, { userId: c.get("user").id, email: c.get("user").email, voice: b.voice }));
  });

  /* ---------- The org chart ---------- */
  ws.get("/swarms/:id/org", async (c) => c.json(await orgState(c.env, c.get("orgId"), c.req.param("id")!)));

  const Id = z.string().min(1).max(60);
  const Change = z.union([
    z.object({ op: z.enum(["role", "unskill", "autonomy", "rhythm", "reports_to"]), agent: Id, value: z.string().max(40) }),
    z.object({ op: z.literal("skill"), agent: Id, value: z.string().max(40), from: Id.optional() }),
    z.object({ op: z.literal("hire"), id: Id, role: z.string().max(40), name: z.string().min(1).max(40).optional(), reports_to: Id.optional() }),
    z.object({ op: z.literal("remove"), agent: Id }),
  ]);
  ws.patch("/swarms/:id/org", manager, async (c) => {
    const b = await body(c, z.object({ changes: z.array(Change).min(1).max(40) }));
    return c.json(await applyOrg(c.env, c.get("orgId"), c.req.param("id")!, c.get("user"), b.changes as any));
  });

  ws.post("/swarms/:id/goals", manager, async (c) => {
    const b = await body(c, z.object({ text: z.string().min(3).max(200) }));
    return c.json(await setGoal(c.env, c.get("orgId"), c.req.param("id")!, b.text, { userId: c.get("user").id, email: c.get("user").email }));
  });

  ws.post("/swarms/:id/tasks", manager, async (c) => {
    const b = await body(c, z.object({ agent_id: Id, title: z.string().min(2).max(200), detail: z.string().max(1500).optional(), mode: z.enum(["quick", "standard", "deep", "strategy"]).optional(), confirm: z.boolean().optional() }));
    return c.json(await ownerTask(c.env, c.get("orgId"), c.req.param("id")!, c.get("user"), b.agent_id, b.title, b.detail, { mode: b.mode, confirm: b.confirm }), 201);
  });

  /** Close or drop a task an agent was given. (Owner to-dos are /tasks/:id, in routes/agents.ts.) */
  ws.patch("/agent-tasks/:id", manager, async (c) => {
    const b = await body(c, z.object({ status: z.enum(["done", "dropped"]) }));
    const t = await c.get("db").one("SELECT * FROM agent_task WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
    if (!t) throw notFound("Task");
    await c.get("db").run("UPDATE agent_task SET status = ?3, result = COALESCE(result, ?4), updated_at = ?5 WHERE org_id = ?1 AND id = ?2", t.id, b.status, b.status === "done" ? "Marked done by you." : "Dropped by you.", nowIso());
    await emit(c.env, { orgId: c.get("orgId"), swarmId: t.swarm_id, agentId: t.agent_id, kind: b.status === "done" ? "task_done" : "task_dropped", summary: `You ${b.status === "done" ? "closed" : "dropped"}: ${t.title}` });
    return c.json({ ok: true });
  });

  ws.post("/swarms/:id/brief", async (c) => c.json({ text: await briefText(c.env, c.get("orgId"), c.req.param("id")!) }));

  /** Move a card by hand. A card that follows a lead moves its lead; invoice and message cards follow their record. */
  ws.patch("/work-items/:id", manager, async (c) => {
    const b = await body(c, z.object({ stage: z.string().max(40) }));
    const db = c.get("db"), orgId = c.get("orgId");
    const it = await db.one("SELECT * FROM work_item WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
    if (!it) throw notFound("Card");
    const s = await loadSwarm(c.env, orgId, it.swarm_id);
    const st = s.blueprint.stages.find((x) => x.key === b.stage);
    if (!st) throw bad("No such stage in this swarm.");
    if (it.ref_kind === "lead") {
      const status = st.rule?.source === "lead" ? st.rule.status?.[0] : undefined;
      if (!status) throw bad("That stage doesn't hold companies.");
      await db.run("UPDATE lead SET status = ?3 WHERE org_id = ?1 AND id = ?2", it.ref_id, status);
      await logActivity(c.env, { orgId, leadId: it.ref_id, actor: c.get("user").email, kind: status === "won" ? "won" : "stage", summary: `Moved to ${st.name}` });
      await syncSwarm(c.env, orgId, it.swarm_id, { force: true });
    } else if (it.ref_kind) {
      throw new HttpError(409, "follows_record", `This card follows its ${it.ref_kind}; change the ${it.ref_kind} instead.`);
    } else {
      await db.run("UPDATE work_item SET stage = ?3, status = ?4, updated_at = ?5 WHERE org_id = ?1 AND id = ?2", it.id, st.key, st.done ? "done" : "open", nowIso());
      await emit(c.env, { orgId, swarmId: it.swarm_id, itemId: it.id, kind: "moved", summary: `You moved ${it.title} to ${st.name}`, detail: { from_stage: it.stage, to_stage: st.key } });
    }
    return c.json({ ok: true });
  });

  /* ---------- CRM ---------- */
  ws.get("/crm/companies", async (c) => c.json({ companies: await companies(c.env, c.get("orgId"), c.req.query("q") || undefined) }));
  ws.get("/crm/companies/:id", async (c) => c.json(await companyView(c.env, c.get("orgId"), c.req.param("id")!)));
  ws.post("/crm/companies", manager, async (c) => {
    const b = await body(c, z.object({ company: z.string().min(1).max(200), email: z.string().email().optional(), website: z.string().max(300).optional(), notes: z.string().max(500).optional() }));
    const id = newId("lead");
    const r = await c.get("db").run("INSERT INTO lead (org_id, id, company, email, website, notes, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(org_id, company) DO NOTHING", id, b.company, b.email?.toLowerCase() ?? null, b.website ?? null, b.notes ?? null, nowIso());
    if (!r.meta.changes) throw new HttpError(409, "exists", "You already have a company by that name.");
    await logActivity(c.env, { orgId: c.get("orgId"), leadId: id, actor: c.get("user").email, kind: "lead", summary: "Added by hand" });
    await syncOrgSwarms(c.env, c.get("orgId"));
    return c.json({ id }, 201);
  });
  ws.post("/crm/contacts", manager, async (c) => {
    const b = await body(c, z.object({ lead_id: z.string().max(60), name: z.string().min(1).max(120), role: z.string().max(120).optional(), email: z.string().email().optional(), phone: z.string().max(40).optional() }));
    return c.json(await saveContact(c.env, c.get("orgId"), { ...b, source: "manual" }, { actor: c.get("user").email }), 201);
  });
  ws.post("/crm/deals", manager, async (c) => {
    const b = await body(c, z.object({ lead_id: z.string().max(60), title: z.string().min(1).max(200), value_pence: z.number().int().min(0).max(1e11).optional(), stage: z.string().max(40).optional(), expected_close: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
    const r = await saveDeal(c.env, c.get("orgId"), b, { actor: c.get("user").email });
    if (r.status === "won") await syncOrgSwarms(c.env, c.get("orgId"));
    return c.json(r, 201);
  });
  ws.patch("/crm/deals/:id", manager, async (c) => {
    const b = await body(c, z.object({ title: z.string().min(1).max(200).optional(), value_pence: z.number().int().min(0).max(1e11).optional(), stage: z.string().max(40).optional(), status: z.enum(["open", "won", "lost"]).optional() }));
    const r = await saveDeal(c.env, c.get("orgId"), { ...b, deal_id: c.req.param("id")! }, { actor: c.get("user").email });
    if (r.status === "won") await syncOrgSwarms(c.env, c.get("orgId"));
    return c.json(r);
  });
  ws.post("/crm/notes", manager, async (c) => {
    const b = await body(c, z.object({ lead_id: z.string().max(60), summary: z.string().min(1).max(500), kind: z.enum(["note", "call"]).optional() }));
    if (!(await c.get("db").one("SELECT id FROM lead WHERE org_id = ?1 AND id = ?2", b.lead_id))) throw notFound("Company");
    await logActivity(c.env, { orgId: c.get("orgId"), leadId: b.lead_id, actor: c.get("user").email, kind: b.kind || "note", summary: b.summary });
    return c.json({ ok: true }, 201);
  });

  /* ---------- Voice ---------- */
  ws.post("/voice/transcribe", manager, async (c) => {
    if (!(await hit(c.env, "voice", c.get("orgId"), 240))) throw new HttpError(429, "slow_down", "That's a lot of voice this hour. Try again shortly.");
    let audio: ArrayBuffer;
    const type = c.req.header("Content-Type") || "";
    if (type.startsWith("multipart/form-data")) {
      const f = (await c.req.formData()).get("audio") as unknown as File | null;
      if (!f || typeof f === "string") throw bad("Send the recording as 'audio'.");
      audio = await f.arrayBuffer();
    } else audio = await c.req.arrayBuffer();
    const text = await transcribe(c.env, audio);
    await run(c.env, "INSERT INTO usage_event (id, org_id, kind, units, cost_pence, payment, at) VALUES (?,?,?,?,0,'plan',?)", newId("use"), c.get("orgId"), "voice_in", Math.ceil(audio.byteLength / 1024), nowIso());
    return c.json({ text });
  });

  ws.post("/voice/speak", async (c) => {
    if (!(await hit(c.env, "voice", c.get("orgId"), 240))) throw new HttpError(429, "slow_down", "That's a lot of voice this hour. Try again shortly.");
    const b = await body(c, z.object({ text: z.string().min(1).max(1200) }));
    await run(c.env, "INSERT INTO usage_event (id, org_id, kind, units, cost_pence, payment, at) VALUES (?,?,?,?,0,'plan',?)", newId("use"), c.get("orgId"), "voice_out", b.text.length, nowIso());
    return speak(c.env, b.text);
  });
}
