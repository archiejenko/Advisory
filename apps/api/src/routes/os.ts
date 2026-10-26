// Workspace routes for the business OS: the module catalogue, module records, channels and record threads.
// Anyone in the workspace can read and talk; a manager or owner changes records and channels.
import type { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/db";
import { audit } from "../lib/db";
import { body, notFound } from "../lib/http";
import { requireRole, type Vars } from "./auth";
import { listRecords, saveRecord, shapeRecord, moduleOf } from "../lib/ostools";
import { catalogue, teamChannels, createChannel, recordChannel, channelById, messages, say, directory } from "../lib/os";
import { loadOs, saveOs, setPaused, changes, restore, preview, customFields, addCustomField, removeCustomField, customApps, addCustomApp, getLayout, putLayout } from "../lib/osbuilder";
import { PACKS, LIBRARY, GUARDRAILS, configFromPack, MODES, AUTONOMY } from "../../../../packages/core/osconfig";

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const manager = requireRole("manager");
const owner = requireRole("owner");
const moduleConfig = z.object({
  key: z.string().max(80), mode: z.enum(MODES as [string, ...string[]]), autonomy: z.enum(AUTONOMY as [string, ...string[]]),
  features: z.array(z.string().max(60)).max(20).default([]), position: z.number().int().min(0).max(999).optional(),
  provider: z.object({ name: z.string().max(120).optional(), email: z.string().email().max(200).optional().or(z.literal("")), notes: z.string().max(1000).optional() }).optional(),
});
const osBody = z.object({ pack: z.string().max(40).optional(), theme: z.enum(["dark", "calm", "terminal", "light"]).optional(), ai_paused: z.boolean().optional(), version: z.number().int().optional(), modules: z.array(moduleConfig).max(200) });
const layoutBody = z.object({ widgets: z.array(z.object({ id: z.string().max(40), type: z.string().max(40), w: z.number().int().min(1).max(4), h: z.number().int().min(1).max(4), module: z.string().max(80).optional() })).max(24), dock: z.array(z.string().max(80)).max(16) });
const recordBody = z.object({ title: z.string().max(200).optional(), status: z.string().max(40).optional(), fields: z.record(z.union([z.string().max(4000), z.number(), z.null()])).optional() });
const who = (c: any) => ({ id: c.get("user").id, name: c.get("user").name || c.get("user").email.split("@")[0] });

export function registerOsRoutes(ws: App) {
  ws.get("/os/catalogue", async (c) => c.json(await catalogue(c.env, c.get("orgId"))));
  ws.get("/os/directory", async (c) => c.json(await directory(c.env, c.get("orgId"))));

  /* ---------- Your OS: what the business runs here ---------- */
  ws.get("/os", async (c) => {
    const cfg = await loadOs(c.env, c.get("orgId"));
    return c.json({ os: cfg || { ...configFromPack("blank"), built: false, version: 0 }, guardrails: GUARDRAILS });
  });
  ws.get("/os/library", (c) => c.json({ categories: LIBRARY, packs: PACKS.map((p) => ({ key: p.key, name: p.name, blurb: p.blurb, apps: p.here.length })) }));
  ws.get("/os/packs", (c) => c.json({ packs: PACKS.map((p) => ({ key: p.key, name: p.name, blurb: p.blurb, os: configFromPack(p.key) })) }));
  ws.get("/os/packs/:key", (c) => {
    const p = PACKS.find((x) => x.key === c.req.param("key"));
    if (!p) throw notFound("Pack");
    return c.json({ pack: { key: p.key, name: p.name, blurb: p.blurb }, os: configFromPack(p.key) });
  });
  ws.post("/os/preview", async (c) => {
    const b = await body(c, osBody.extend({ people: z.number().int().min(1).max(500).optional() }));
    return c.json(preview(b as any, b.people));
  });
  ws.put("/os", owner, async (c) => {
    const b = await body(c, osBody);
    return c.json({ os: await saveOs(c.env, c.get("orgId"), b as any, c.get("user").email) });
  });
  ws.post("/os/pause", manager, async (c) => {
    const b = await body(c, z.object({ paused: z.boolean() }));
    return c.json({ os: await setPaused(c.env, c.get("orgId"), b.paused, c.get("user").email) });
  });
  ws.get("/os/changes", async (c) => c.json({ changes: await changes(c.env, c.get("orgId")) }));
  ws.post("/os/restore", owner, async (c) => {
    const b = await body(c, z.object({ version: z.number().int().min(1) }));
    return c.json({ os: await restore(c.env, c.get("orgId"), b.version, c.get("user").email) });
  });

  /* ---------- Studio ---------- */
  ws.get("/os/fields", async (c) => c.json({ fields: await customFields(c.env, c.get("orgId"), c.req.query("module") || undefined) }));
  ws.post("/os/fields", owner, async (c) => {
    const b = await body(c, z.object({ module: z.string().max(80), key: z.string().max(40), label: z.string().min(1).max(60), type: z.enum(["text", "date", "money", "long", "url", "number", "choice"]), options: z.array(z.string().max(60)).max(30).optional() }));
    return c.json({ field: await addCustomField(c.env, c.get("orgId"), b, c.get("user").email) }, 201);
  });
  // The same Studio routes under the names the overhaul spec uses.
  ws.get("/os/custom-fields", async (c) => c.json({ fields: await customFields(c.env, c.get("orgId"), c.req.query("module") || undefined) }));
  ws.post("/os/custom-fields", owner, async (c) => {
    const b = await body(c, z.object({ module: z.string().max(80), key: z.string().max(40), label: z.string().min(1).max(60), type: z.enum(["text", "date", "money", "long", "url", "number", "choice"]), options: z.array(z.string().max(60)).max(30).optional() }));
    return c.json({ field: await addCustomField(c.env, c.get("orgId"), b, c.get("user").email) }, 201);
  });
  ws.delete("/os/custom-fields/:id", owner, async (c) => { await removeCustomField(c.env, c.get("orgId"), c.req.param("id")!, c.get("user").email); return c.json({ ok: true }); });
  ws.get("/os/custom-apps", async (c) => c.json({ apps: await customApps(c.env, c.get("orgId")) }));
  ws.delete("/os/fields/:id", owner, async (c) => { await removeCustomField(c.env, c.get("orgId"), c.req.param("id")!, c.get("user").email); return c.json({ ok: true }); });
  ws.get("/os/apps", async (c) => c.json({ apps: await customApps(c.env, c.get("orgId")) }));
  ws.post("/os/apps", owner, async (c) => {
    const b = await body(c, z.object({ key: z.string().min(2).max(40), name: z.string().min(1).max(60), kind: z.enum(["item", "deal", "money", "person", "doc", "asset", "event", "metric", "case"]), category: z.string().max(40), statuses: z.array(z.string().max(30)).max(12).optional() }));
    return c.json({ app: await addCustomApp(c.env, c.get("orgId"), b, c.get("user").email) }, 201);
  });

  /* ---------- The home screen ---------- */
  ws.get("/os/layout", async (c) => c.json(await getLayout(c.env, c.get("orgId"), c.req.query("space") === "phone" ? "phone" : "desktop")));
  ws.put("/os/layout", manager, async (c) => {
    const b = await body(c, layoutBody);
    return c.json(await putLayout(c.env, c.get("orgId"), c.req.query("space") === "phone" ? "phone" : "desktop", b));
  });

  /* ---------- Records ---------- */
  ws.get("/os/m/:module/records", async (c) => {
    const f = moduleOf(c.req.param("module")!);
    return c.json({ module: f.key, records: await listRecords(c.env, c.get("orgId"), f.key, { status: c.req.query("status") || undefined, q: c.req.query("q") || undefined }) });
  });
  ws.post("/os/m/:module/records", manager, async (c) => {
    const b = await body(c, recordBody);
    return c.json({ record: await saveRecord(c.env, c.get("orgId"), c.req.param("module")!, b, c.get("user").email) }, 201);
  });
  ws.get("/os/records/:id", async (c) => {
    const r = await c.get("db").one("SELECT * FROM os_record WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
    if (!r) throw notFound("Record");
    return c.json({ record: shapeRecord(r) });
  });
  ws.patch("/os/records/:id", manager, async (c) => {
    const r = await c.get("db").one<any>("SELECT module FROM os_record WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
    if (!r) throw notFound("Record");
    const b = await body(c, recordBody);
    return c.json({ record: await saveRecord(c.env, c.get("orgId"), r.module, b, c.get("user").email, c.req.param("id")) });
  });
  ws.delete("/os/records/:id", manager, async (c) => {
    const id = c.req.param("id")!, db = c.get("db");
    const r = await db.one<any>("SELECT module, title FROM os_record WHERE org_id = ?1 AND id = ?2", id);
    if (!r) throw notFound("Record");
    const ch = await db.one<any>("SELECT id FROM os_channel WHERE org_id = ?1 AND record_id = ?2", id);
    if (ch) { await db.run("DELETE FROM os_message WHERE org_id = ?1 AND channel_id = ?2", ch.id); await db.run("DELETE FROM os_channel WHERE org_id = ?1 AND id = ?2", ch.id); }
    await db.run("DELETE FROM os_record WHERE org_id = ?1 AND id = ?2", id);
    await audit(c.env, c.get("orgId"), c.get("user").email, "record_deleted", id, { module: r.module, title: r.title });
    return c.json({ ok: true });
  });

  /* ---------- A record's thread ---------- */
  ws.get("/os/records/:id/messages", async (c) => {
    const { channel } = await recordChannel(c.env, c.get("orgId"), c.req.param("id")!);
    return c.json({ channel, messages: await messages(c.env, c.get("orgId"), channel.id, c.req.query("after") || undefined) });
  });
  ws.post("/os/records/:id/messages", async (c) => {
    const b = await body(c, z.object({ body: z.string().min(1).max(4000) }));
    const { channel } = await recordChannel(c.env, c.get("orgId"), c.req.param("id")!);
    return c.json(await say(c.env, c.get("orgId"), channel, who(c), b.body, { canAsk: c.get("role") !== "viewer" }), 201);
  });

  /* ---------- Team channels ---------- */
  ws.get("/os/channels", async (c) => c.json({ channels: await teamChannels(c.env, c.get("orgId"), c.get("user").email) }));
  ws.post("/os/channels", manager, async (c) => {
    const b = await body(c, z.object({ name: z.string().min(2).max(40) }));
    return c.json(await createChannel(c.env, c.get("orgId"), b.name, c.get("user").email), 201);
  });
  ws.get("/os/channels/:id/messages", async (c) => {
    const ch = await channelById(c.env, c.get("orgId"), c.req.param("id")!);
    return c.json({ channel: ch, messages: await messages(c.env, c.get("orgId"), ch.id, c.req.query("after") || undefined) });
  });
  ws.post("/os/channels/:id/messages", async (c) => {
    const b = await body(c, z.object({ body: z.string().min(1).max(4000) }));
    const ch = await channelById(c.env, c.get("orgId"), c.req.param("id")!);
    return c.json(await say(c.env, c.get("orgId"), ch, who(c), b.body, { canAsk: c.get("role") !== "viewer" }), 201);
  });
}
