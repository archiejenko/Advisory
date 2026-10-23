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

type App = Hono<{ Bindings: Env; Variables: Vars }>;
const manager = requireRole("manager");
const recordBody = z.object({ title: z.string().max(200).optional(), status: z.string().max(40).optional(), fields: z.record(z.union([z.string().max(4000), z.number(), z.null()])).optional() });
const who = (c: any) => ({ id: c.get("user").id, name: c.get("user").name || c.get("user").email.split("@")[0] });

export function registerOsRoutes(ws: App) {
  ws.get("/os/catalogue", async (c) => c.json(await catalogue(c.env, c.get("orgId"))));
  ws.get("/os/directory", async (c) => c.json(await directory(c.env, c.get("orgId"))));

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
    return c.json(await say(c.env, c.get("orgId"), channel, who(c), b.body), 201);
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
    return c.json(await say(c.env, c.get("orgId"), ch, who(c), b.body), 201);
  });
}
