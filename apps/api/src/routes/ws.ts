// Workspace API. Every route sits behind requireSession, and every query goes through the Scoped helper.
import { Hono } from "hono";
import { z } from "zod";
import { newId, nowIso, sha256Hex, randomToken } from "../../../../packages/core/util";
import { toCsv } from "../../../../packages/core/csv";
import { statusLabel } from "../../../../packages/core/checks";
import { type Env, one, all, run, audit } from "../lib/db";
import { body, bad, notFound, HttpError } from "../lib/http";
import { requireSession, requireRole, type Vars } from "./auth";
import { seal } from "../lib/crypto";
import { testChannel } from "../lib/delivery";
import { checkInput, profileFields } from "../lib/truth";
import { addClient, summarise } from "../lib/imports";
import { prospectRows } from "../lib/jobs";
import { registerAgentRoutes } from "./agents";
import { registerSwarmRoutes } from "./swarms";
import { registerTodayRoutes } from "./today";
import { registerOsRoutes } from "./os";
import { PLANS } from "../../../../packages/core/templates";
import { planCheckout, portal } from "../lib/stripe";
import { sendMail } from "../lib/mail";
import { storedCompany, companyCached } from "../lib/registers";
import { modelBudget, modelSpend } from "../lib/budget";

export const ws = new Hono<{ Bindings: Env; Variables: Vars }>();
ws.use("*", requireSession);
const manager = requireRole("manager"), owner = requireRole("owner");

/* ---------- Me, org, users ---------- */
ws.get("/me", async (c) => {
  const org = await c.get("db").one("SELECT id, name, markup_pct, prospect_districts, prospect_sic, prospect_min_age, profile, plan, inbox_alias FROM org WHERE id = ?1");
  const sub = await c.get("db").one("SELECT status, founding FROM subscription WHERE org_id = ?1");
  const { inbox_alias, ...o } = org;
  return c.json({ user: c.get("user"), role: c.get("role"), org: { ...o, profile: JSON.parse(org.profile || "{}"), inbox_address: inbox_alias ? `${inbox_alias}@${c.env.INBOUND_DOMAIN || "in.agenthouse.example"}` : null, prospect_districts: JSON.parse(org.prospect_districts), prospect_sic: JSON.parse(org.prospect_sic) }, subscription: sub || { status: "none" } });
});

ws.patch("/org", owner, async (c) => {
  const b = await body(c, z.object({
    markup_pct: z.number().int().min(0).max(500).optional(),
    prospect_districts: z.array(z.string().regex(/^[A-Z]{1,2}\d{1,2}[A-Z]?$/)).max(200).optional(),
    prospect_sic: z.array(z.string().regex(/^\d{2}$/)).max(40).optional(),
    prospect_min_age: z.number().int().min(0).max(50).optional(),
    name: z.string().min(1).max(150).optional(),
    profile: z.object({ what: z.string().max(500), customers: z.string().max(500), area: z.string().max(200), tone: z.string().max(200), sign_off: z.string().max(100), website: z.string().max(200) }).partial().optional(),
  }));
  const db = c.get("db");
  if (b.name) await db.run("UPDATE org SET name = ?2 WHERE id = ?1", b.name);
  if (b.profile) {
    const cur = JSON.parse(((await db.one("SELECT profile FROM org WHERE id = ?1")) as any).profile || "{}");
    await db.run("UPDATE org SET profile = ?2 WHERE id = ?1", JSON.stringify({ ...cur, ...b.profile }));
  }
  if (b.markup_pct !== undefined) await db.run("UPDATE org SET markup_pct = ?2 WHERE id = ?1", b.markup_pct);
  if (b.prospect_districts) await db.run("UPDATE org SET prospect_districts = ?2 WHERE id = ?1", JSON.stringify(b.prospect_districts));
  if (b.prospect_sic) await db.run("UPDATE org SET prospect_sic = ?2 WHERE id = ?1", JSON.stringify(b.prospect_sic));
  if (b.prospect_min_age !== undefined) await db.run("UPDATE org SET prospect_min_age = ?2 WHERE id = ?1", b.prospect_min_age);
  await audit(c.env, c.get("orgId"), c.get("user").id, "org_updated", undefined, b);
  return c.json({ ok: true });
});

ws.get("/users", async (c) => {
  const users = await c.get("db").all("SELECT u.id, u.email, u.name, m.role FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = ?1 ORDER BY u.email");
  return c.json({ users });
});

ws.post("/users", owner, async (c) => {
  const b = await body(c, z.object({ email: z.string().email(), name: z.string().max(100).optional(), role: z.enum(["owner", "manager", "viewer"]) }));
  const email = b.email.toLowerCase();
  let u = await one<any>(c.env, "SELECT * FROM user WHERE email = ?", email);
  if (!u) { u = { id: newId("usr") }; await run(c.env, "INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?)", u.id, email, b.name ?? null, nowIso()); }
  await c.get("db").run("INSERT INTO membership (org_id, user_id, role) VALUES (?1, ?2, ?3) ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role", u.id, b.role);
  const token = randomToken();
  await run(c.env, "INSERT INTO magic_link (token_hash, email, expires_at) VALUES (?,?,?)", await sha256Hex(token), email, new Date(Date.now() + 7 * 864e5).toISOString());
  await sendMail(c.env, { kind: "transactional", to: email, subject: "You've been invited to Agent House", text: `${c.get("user").email} invited you to their Agent House workspace.\nAccept: ${c.env.APP_URL}#/sign-in?token=${token}\nThis link works once and expires in 7 days.` });
  await audit(c.env, c.get("orgId"), c.get("user").id, "user_invited", email, { role: b.role });
  return c.json({ ok: true, user_id: u.id }, 201);
});

ws.patch("/users/:id", owner, async (c) => {
  const b = await body(c, z.object({ role: z.enum(["owner", "manager", "viewer"]) }));
  const r = await c.get("db").run("UPDATE membership SET role = ?3 WHERE org_id = ?1 AND user_id = ?2", c.req.param("id"), b.role);
  if (!r.meta.changes) throw notFound("User");
  await audit(c.env, c.get("orgId"), c.get("user").id, "role_changed", c.req.param("id"), b);
  return c.json({ ok: true });
});

/* ---------- Imports ---------- */
ws.post("/imports", manager, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file") as unknown as File | null;
  if (!file || typeof file === "string") throw bad("Attach a CSV or Excel file as 'file'.");
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw bad("Upload a CSV or Excel (.xlsx) file. For an older .xls file, save it as .xlsx or CSV first.");
  if (file.size > 10 * 1024 * 1024) throw bad("The file is larger than 10 MB. Split it and upload the parts.");
  const id = newId("imp");
  const key = `imports/${c.get("orgId")}/${id}${file.name.match(/\.\w+$/)![0].toLowerCase()}`;
  await c.env.FILES.put(key, await file.arrayBuffer());
  await run(c.env, "INSERT INTO import (id, org_id, file_key, status, created_by, created_at) VALUES (?,?,?,?,?,?)", id, c.get("orgId"), key, "queued", c.get("user").id, nowIso());
  await c.env.JOBS.send({ type: "import", id, org_id: c.get("orgId"), step: "split" });
  await audit(c.env, c.get("orgId"), c.get("user").id, "import_started", id, { file: file.name });
  return c.json({ id, status: "queued" }, 202);
});

ws.get("/imports/:id", async (c) => {
  const imp = await c.get("db").one("SELECT * FROM import WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
  if (!imp) throw notFound("Import");
  const rows = await c.get("db").all("SELECT row, input, extra, candidates, confidence, chosen_number FROM import_row WHERE org_id = ?1 AND import_id = ?2 AND confidence IN ('confirm','none') ORDER BY row", c.req.param("id"));
  return c.json({
    id: imp.id, status: imp.status, total: imp.rows_total, matched: imp.rows_matched, to_confirm: imp.rows_confirm, unmatched: imp.rows_unmatched,
    rows: rows.map((r: any) => ({ row: r.row, input: r.input, name: JSON.parse(r.extra || "{}").name, confidence: r.confidence, candidates: JSON.parse(r.candidates || "[]") })),
  });
});

ws.post("/imports/:id/confirm", manager, async (c) => {
  const b = await body(c, z.object({ choices: z.array(z.object({ row: z.number().int(), number: z.string().nullable() })).min(1) }));
  const id = c.req.param("id")!, db = c.get("db");
  const imp = await db.one("SELECT * FROM import WHERE org_id = ?1 AND id = ?2", id);
  if (!imp) throw notFound("Import");
  if (imp.status === "queued" || imp.status === "matching") throw new HttpError(409, "still_matching", "This import is still being matched. Confirm once matching finishes.");
  let added = 0;
  for (const ch of b.choices) {
    const r = await db.one("SELECT * FROM import_row WHERE org_id = ?1 AND import_id = ?2 AND row = ?3", id, ch.row);
    if (!r) continue;
    const cands = JSON.parse(r.candidates || "[]");
    if (ch.number && !cands.some((x: any) => x.number === ch.number)) throw bad(`Row ${ch.row}: choose one of the candidates shown.`);
    const extra = JSON.parse(r.extra || "{}");
    if (ch.number) { extra.registered_name = cands.find((x: any) => x.number === ch.number)?.name; if (await addClient(c.env, c.get("orgId"), ch.number, extra)) added++; }
    await db.run("UPDATE import_row SET confidence = ?4, chosen_number = ?5 WHERE org_id = ?1 AND import_id = ?2 AND row = ?3", id, ch.row, ch.number ? "high" : "none", ch.number);
  }
  const s = await summarise(c.env, id);
  await db.run("UPDATE import SET status = ?3 WHERE org_id = ?1 AND id = ?2", id, s.confirm ? "needs_confirmation" : "done");
  await audit(c.env, c.get("orgId"), c.get("user").id, "matches_confirmed", id, { added });
  return c.json({ ok: true, added, ...s });
});

/* ---------- Clients ---------- */
ws.get("/clients", async (c) => {
  const q = (c.req.query("q") || "").trim();
  const status = c.req.query("status") || "all";
  const sort = c.req.query("sort") || "name";
  const per = Math.min(100, Number(c.req.query("per")) || 20), page = Math.max(0, Number(c.req.query("page")) || 0);
  const where = ["c.org_id = ?1"]; const args: any[] = [];
  if (q) { args.push(`%${q.toLowerCase()}%`, `%${q}%`); where.push(`(lower(c.display_name) LIKE ?${args.length + 0} OR c.number LIKE ?${args.length + 1})`); }
  const flagged = "EXISTS (SELECT 1 FROM alert a WHERE a.org_id = c.org_id AND a.number = c.number AND a.state = 'open')";
  if (status === "flagged") where.push(flagged);
  if (status === "clear") where.push("NOT " + flagged);
  const order = sort === "number" ? "c.number" : sort === "latest" ? "latest_at DESC NULLS LAST, c.display_name" : "c.display_name";
  const sqlBase = `FROM client c WHERE ${where.join(" AND ")}`;
  const total = (await c.get("db").one(`SELECT COUNT(*) AS n ${sqlBase}`, ...args)).n;
  const rows = await c.get("db").all(`SELECT c.number, c.display_name, c.watch_on, co.status,
      (SELECT a.title FROM alert a WHERE a.org_id = c.org_id AND a.number = c.number ORDER BY a.created_at DESC LIMIT 1) AS latest_title,
      (SELECT a.severity FROM alert a WHERE a.org_id = c.org_id AND a.number = c.number AND a.state = 'open' ORDER BY a.created_at DESC LIMIT 1) AS open_severity,
      (SELECT a.created_at FROM alert a WHERE a.org_id = c.org_id AND a.number = c.number ORDER BY a.created_at DESC LIMIT 1) AS latest_at
    ${sqlBase.replace("FROM client c", "FROM client c LEFT JOIN company co ON co.number = c.number")} ORDER BY ${order} LIMIT ${per} OFFSET ${page * per}`, ...args);
  return c.json({ total, page, per, clients: rows.map((r: any) => ({ number: r.number, name: r.display_name, watching: !!r.watch_on, status: r.status ? statusLabel(r.status) : "Reading the register", latest_finding: r.latest_title || "No changes", flagged: !!r.open_severity, severity: r.open_severity || null })) });
});

/** Add one client by company number, without a spreadsheet. */
ws.post("/clients", manager, async (c) => {
  const b = await body(c, z.object({ number: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/, "Company numbers are 8 characters, for example 08812234.") }));
  const rec = await companyCached(c.env, b.number);
  if (!rec) throw notFound("Company " + b.number + " on the register");
  const added = await addClient(c.env, c.get("orgId"), b.number, { registered_name: rec.name });
  if (!added) throw new HttpError(409, "already_watched", `${rec.name} is already in your client book.`);
  await audit(c.env, c.get("orgId"), c.get("user").id, "client_added", b.number);
  return c.json({ ok: true, number: b.number, name: rec.name }, 201);
});

ws.get("/clients/:no", async (c) => {
  const no = c.req.param("no"), db = c.get("db");
  const cl = await db.one("SELECT * FROM client WHERE org_id = ?1 AND number = ?2", no);
  if (!cl) throw notFound("Client");
  const rec = await storedCompany(c.env, no);
  const events = await all<any>(c.env, "SELECT id, kind, occurred_at, source, payload FROM register_event WHERE number = ? AND kind NOT IN ('baseline','reconcile') ORDER BY occurred_at DESC LIMIT 50", no);
  const alerts = await db.all("SELECT id, title, severity, state, created_at, event_id FROM alert WHERE org_id = ?1 AND number = ?2 ORDER BY created_at DESC", no);
  const alertByEvent = new Map(alerts.map((a: any) => [a.event_id, a]));
  return c.json({
    client: { number: no, name: cl.display_name, since: cl.since, users: cl.users, monthly_fee: cl.monthly_fee, next_invoice: cl.next_invoice, watching: !!cl.watch_on },
    record: rec ? { status: statusLabel(rec.status), raw_status: rec.status, fields: profileFields(rec) } : null,
    history: events.map((e) => ({ date: e.occurred_at.slice(0, 10), kind: e.kind, source: e.source.startsWith("ch-stream") ? "Companies House" : e.source === "gazette" ? "The Gazette" : e.source, alert: alertByEvent.get(e.id) || null })),
    alerts,
  });
});

ws.patch("/clients/:no", manager, async (c) => {
  const b = await body(c, z.object({ watching: z.boolean().optional(), monthly_fee: z.number().nonnegative().nullable().optional(), next_invoice: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), users: z.number().int().nonnegative().nullable().optional() }));
  const db = c.get("db"), no = c.req.param("no");
  const cl = await db.one("SELECT * FROM client WHERE org_id = ?1 AND number = ?2", no);
  if (!cl) throw notFound("Client");
  if (b.watching !== undefined) await db.run("UPDATE client SET watch_on = ?3 WHERE org_id = ?1 AND number = ?2", no, b.watching ? 1 : 0);
  if (b.monthly_fee !== undefined) await db.run("UPDATE client SET monthly_fee = ?3 WHERE org_id = ?1 AND number = ?2", no, b.monthly_fee);
  if (b.next_invoice !== undefined) await db.run("UPDATE client SET next_invoice = ?3 WHERE org_id = ?1 AND number = ?2", no, b.next_invoice);
  if (b.users !== undefined) await db.run("UPDATE client SET users = ?3 WHERE org_id = ?1 AND number = ?2", no, b.users);
  await audit(c.env, c.get("orgId"), c.get("user").id, b.watching === false ? "client_paused" : b.watching ? "client_resumed" : "client_updated", no, b);
  return c.json({ ok: true });
});

ws.delete("/clients/:no", manager, async (c) => {
  const r = await c.get("db").run("DELETE FROM client WHERE org_id = ?1 AND number = ?2", c.req.param("no"));
  if (!r.meta.changes) throw notFound("Client");
  await audit(c.env, c.get("orgId"), c.get("user").id, "client_removed", c.req.param("no"));
  return c.json({ ok: true });
});

/* ---------- Alerts ---------- */
const alertOut = (a: any) => ({ id: a.id, number: a.number, client: a.display_name, agent: a.agent, check: a.check_key, severity: a.severity, title: a.title, summary: a.summary, facts: JSON.parse(a.facts), next_step: a.next_step, state: a.state, reviewed_by: a.reviewed_by, reviewed_at: a.reviewed_at, created_at: a.created_at });

ws.get("/alerts", async (c) => {
  const state = c.req.query("state") || "open";
  const db = c.get("db");
  const filter = state === "all" ? "" : "AND a.state = ?2";
  const rows = await db.all(`SELECT a.*, c.display_name FROM alert a LEFT JOIN client c ON c.org_id = a.org_id AND c.number = a.number WHERE a.org_id = ?1 ${filter} ORDER BY a.created_at DESC LIMIT 200`, ...(state === "all" ? [] : [state]));
  const counts = await db.one("SELECT SUM(state='open') AS open, SUM(state='reviewed') AS reviewed, COUNT(*) AS total FROM alert WHERE org_id = ?1");
  return c.json({ counts: { open: counts.open || 0, reviewed: counts.reviewed || 0, all: counts.total || 0 }, alerts: rows.map(alertOut) });
});

ws.get("/alerts/:id", async (c) => {
  const a = await c.get("db").one("SELECT a.*, c.display_name FROM alert a LEFT JOIN client c ON c.org_id = a.org_id AND c.number = a.number WHERE a.org_id = ?1 AND a.id = ?2", c.req.param("id"));
  if (!a) throw notFound("Alert");
  return c.json(alertOut(a));
});

ws.patch("/alerts/:id", manager, async (c) => {
  const b = await body(c, z.object({ state: z.enum(["open", "reviewed"]) }));
  const u = c.get("user");
  const r = await c.get("db").run("UPDATE alert SET state = ?3, reviewed_by = ?4, reviewed_at = ?5 WHERE org_id = ?1 AND id = ?2",
    c.req.param("id"), b.state, b.state === "reviewed" ? u.email : null, b.state === "reviewed" ? nowIso() : null);
  if (!r.meta.changes) throw notFound("Alert");
  await audit(c.env, c.get("orgId"), u.id, b.state === "reviewed" ? "alert_reviewed" : "alert_reopened", c.req.param("id"));
  return c.json({ ok: true });
});

ws.post("/alerts/:id/share", manager, async (c) => {
  const b = await body(c, z.object({ channel_id: z.string() }));
  const db = c.get("db");
  if (!(await db.one("SELECT id FROM alert WHERE org_id = ?1 AND id = ?2", c.req.param("id")))) throw notFound("Alert");
  if (!(await db.one("SELECT id FROM channel WHERE org_id = ?1 AND id = ?2", b.channel_id))) throw notFound("Channel");
  await run(c.env, "DELETE FROM delivery WHERE alert_id = ? AND channel_id = ? AND kind = 'share'", c.req.param("id"), b.channel_id);
  await c.env.JOBS.send({ type: "deliver", alert_id: c.req.param("id"), channel_id: b.channel_id, kind: "share" });
  await audit(c.env, c.get("orgId"), c.get("user").id, "alert_shared", c.req.param("id"), b);
  return c.json({ ok: true, status: "queued" }, 202);
});

/* ---------- Briefs (new-client check) ---------- */
ws.post("/briefs", manager, async (c) => {
  const b = await body(c, z.object({ input: z.string().min(2).max(500) }));
  const res: any = await checkInput(c.env, b.input);
  const id = newId("brf");
  await run(c.env, "INSERT INTO brief (id, org_id, input, number, body, response_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    id, c.get("orgId"), b.input, res.match?.number ?? null, JSON.stringify(res), res.response_id, c.get("user").id, nowIso());
  await run(c.env, "INSERT INTO usage_event (id, org_id, kind, number, units, cost_pence, payment, at) VALUES (?,?,?,?,1,0,'internal',?)", newId("use"), c.get("orgId"), "brief", res.match?.number ?? null, nowIso());
  return c.json({ id, brief: res }, 201);
});
ws.get("/briefs", async (c) => c.json({ briefs: await c.get("db").all("SELECT id, input, number, response_id, created_at FROM brief WHERE org_id = ?1 ORDER BY created_at DESC LIMIT 100") }));
ws.get("/briefs/:id", async (c) => {
  const b = await c.get("db").one("SELECT * FROM brief WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
  if (!b) throw notFound("Brief");
  return c.json({ id: b.id, created_at: b.created_at, brief: JSON.parse(b.body) });
});

/* ---------- Agents and channels ---------- */
ws.get("/agents", async (c) => c.json({ agents: (await c.get("db").all("SELECT agent, on_, digest, coverage, channel_id FROM agent_config WHERE org_id = ?1 ORDER BY agent")).map((a: any) => ({ key: a.agent, on: !!a.on_, digest: a.digest, coverage: a.coverage, channel_id: a.channel_id })) }));

ws.patch("/agents/:key", manager, async (c) => {
  const key = c.req.param("key")!;
  if (!["watch", "check", "prospect"].includes(key)) throw notFound("Agent");
  const b = await body(c, z.object({ on: z.boolean().optional(), digest: z.enum(["daily", "weekly"]).optional(), channel_id: z.string().nullable().optional() }));
  const db = c.get("db");
  if (b.channel_id && !(await db.one("SELECT id FROM channel WHERE org_id = ?1 AND id = ?2", b.channel_id))) throw notFound("Channel");
  if (b.on !== undefined) await db.run("UPDATE agent_config SET on_ = ?3 WHERE org_id = ?1 AND agent = ?2", key, b.on ? 1 : 0);
  if (b.digest) await db.run("UPDATE agent_config SET digest = ?3 WHERE org_id = ?1 AND agent = ?2", key, b.digest);
  if (b.channel_id !== undefined) await db.run("UPDATE agent_config SET channel_id = ?3 WHERE org_id = ?1 AND agent = ?2", key, b.channel_id);
  await audit(c.env, c.get("orgId"), c.get("user").id, "agent_updated", key, b);
  return c.json({ ok: true });
});

function checkTarget(env: Env, kind: string, target: string) {
  if (kind === "email") { if (!z.string().email().safeParse(target).success) throw bad("Enter a valid email address."); return; }
  let u: URL; try { u = new URL(target); } catch { throw bad("Paste the full webhook URL, starting https://."); }
  if (u.protocol !== "https:" && env.ALLOW_ANY_WEBHOOK_HOST !== "true") throw bad("Webhook URLs must start with https://.");
  if (env.ALLOW_ANY_WEBHOOK_HOST === "true") return;
  const ok = kind === "teams" ? /(\.logic\.azure\.com|\.powerplatform\.com|\.powerautomate\.com)$/.test(u.hostname) : u.hostname === "hooks.slack.com";
  if (!ok) throw bad(kind === "teams" ? "Use the URL from a Teams Workflows \"post to a channel when a webhook request is received\" flow." : "Use a Slack incoming webhook URL from hooks.slack.com.");
}

ws.get("/channels", async (c) => c.json({ channels: (await c.get("db").all("SELECT id, kind, label, verified_at, created_at FROM channel WHERE org_id = ?1 ORDER BY created_at")) }));

ws.post("/channels", owner, async (c) => {
  const b = await body(c, z.object({ kind: z.enum(["email", "teams", "slack"]), label: z.string().min(1).max(80), target: z.string().min(3).max(2000) }));
  checkTarget(c.env, b.kind, b.target);
  const id = newId("chn");
  await run(c.env, "INSERT INTO channel (id, org_id, kind, label, target_enc, created_at) VALUES (?,?,?,?,?,?)", id, c.get("orgId"), b.kind, b.label, await seal(c.env, b.target), nowIso());
  await audit(c.env, c.get("orgId"), c.get("user").id, "channel_added", id, { kind: b.kind, label: b.label });
  return c.json({ id }, 201);
});

ws.post("/channels/:id/test", manager, async (c) => {
  const ch = await c.get("db").one("SELECT * FROM channel WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
  if (!ch) throw notFound("Channel");
  try { return c.json({ status: await testChannel(c.env, ch) }); }
  catch (e: any) { throw new HttpError(502, "channel_failed", `The test message didn't arrive: ${e.message}. Check the URL and try again.`); }
});

ws.delete("/channels/:id", owner, async (c) => {
  const db = c.get("db");
  await db.run("UPDATE agent_config SET channel_id = NULL WHERE org_id = ?1 AND channel_id = ?2", c.req.param("id"));
  const r = await db.run("DELETE FROM channel WHERE org_id = ?1 AND id = ?2", c.req.param("id"));
  if (!r.meta.changes) throw notFound("Channel");
  await audit(c.env, c.get("orgId"), c.get("user").id, "channel_removed", c.req.param("id"));
  return c.json({ ok: true });
});

/* ---------- Usage ---------- */
async function usage(c: any, month: string) {
  const db = c.get("db");
  const from = month + "-01", to = nextMonth(month) + "-01";
  const clients = (await db.one("SELECT COUNT(*) AS n FROM client WHERE org_id = ?1")).n as number;
  const runs = (await db.one("SELECT COUNT(*) AS n FROM usage_event WHERE org_id = ?1 AND kind = 'watch_run' AND at >= ?2 AND at < ?3", from, to)).n;
  const briefs = (await db.one("SELECT COUNT(*) AS n FROM usage_event WHERE org_id = ?1 AND kind = 'brief' AND at >= ?2 AND at < ?3", from, to)).n;
  const alerts = (await db.one("SELECT COUNT(*) AS n FROM alert WHERE org_id = ?1 AND created_at >= ?2 AND created_at < ?3", from, to)).n;
  const org = await db.one("SELECT markup_pct FROM org WHERE id = ?1");
  const costPence = 19900 + Math.max(0, clients - 100) * 100;
  const weeks = await db.all(`SELECT strftime('%Y-%W', created_at) AS wk, MIN(substr(created_at,1,10)) AS first, COUNT(*) AS n FROM alert WHERE org_id = ?1 AND created_at >= ?2 GROUP BY wk ORDER BY wk`, new Date(Date.now() - 8 * 7 * 864e5).toISOString());
  const perClient = await db.all(`SELECT c.number, c.display_name,
      (SELECT COUNT(*) FROM alert a WHERE a.org_id = c.org_id AND a.number = c.number AND a.created_at >= ?2 AND a.created_at < ?3) AS alerts,
      (SELECT COUNT(*) FROM usage_event u WHERE u.org_id = c.org_id AND u.number = c.number AND u.kind = 'brief' AND u.at >= ?2 AND u.at < ?3) AS briefs
    FROM client c WHERE c.org_id = ?1 ORDER BY alerts DESC, c.display_name`, from, to);
  const share = clients ? costPence / clients : 0;
  const orgPlan = (await db.one("SELECT plan FROM org WHERE id = ?1")).plan as string;
  const actions = (await db.one("SELECT COUNT(*) AS n FROM usage_event WHERE org_id = ?1 AND kind = 'agent_action' AND at >= ?2 AND at < ?3", from, to)).n as number;
  const modelPence = (await db.one("SELECT COALESCE(SUM(cost_pence),0) AS n FROM usage_event WHERE org_id = ?1 AND kind = 'agent_run' AND at >= ?2 AND at < ?3", from, to)).n as number;
  const byAgent = await db.all("SELECT g.name, g.template, COUNT(r.id) AS runs, COALESCE(SUM(r.tool_calls),0) AS actions FROM agent g LEFT JOIN agent_run r ON r.agent_id = g.id AND r.created_at >= ?2 AND r.created_at < ?3 WHERE g.org_id = ?1 GROUP BY g.id ORDER BY actions DESC", from, to);
  const sent = (await db.one("SELECT COUNT(*) AS n FROM agent_action WHERE org_id = ?1 AND status = 'sent' AND decided_at >= ?2 AND decided_at < ?3", from, to)).n as number;
  const p = PLANS[orgPlan] || PLANS.trial;
  return { plan: orgPlan, plan_name: p.name, plan_actions: p.actions, plan_agents: p.agents, actions, model_pence: modelPence, model_budget_pence: modelBudget(c.env, orgPlan), model_spend_pence: await modelSpend(c.env, c.get("orgId")), emails_sent: sent, by_agent: byAgent, month, clients, runs, briefs, alerts, markup_pct: org.markup_pct, cost_pence: costPence, rebill_pence: Math.round(costPence * (1 + org.markup_pct / 100)), weeks, per_client: perClient.map((r: any) => ({ ...r, cost_pence: Math.round(share) })) };
}
const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const monthOf = (c: any) => { const m = c.req.query("month") || nowIso().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(m)) throw bad("month must look like 2026-10"); return m; };

ws.get("/usage", async (c) => c.json(await usage(c, monthOf(c))));
ws.get("/usage/export", async (c) => {
  const u = await usage(c, monthOf(c));
  const csv = toCsv([["Client", "Company no.", "Alerts", "Briefs", "Cost share (GBP)", `Rebilled at ${u.markup_pct}% (GBP)`],
    ...u.per_client.map((r: any) => [r.display_name, r.number, r.alerts, r.briefs, (r.cost_pence / 100).toFixed(2), ((r.cost_pence * (1 + u.markup_pct / 100)) / 100).toFixed(2)])]);
  await audit(c.env, c.get("orgId"), c.get("user").id, "usage_exported", u.month);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="agent-house-usage-${u.month}.csv"` } });
});

/* ---------- Prospects ---------- */
ws.get("/prospects/preview", async (c) => {
  const org = await c.get("db").one("SELECT * FROM org WHERE id = ?1");
  const o = { ...org, prospect_districts: c.req.query("districts") ? JSON.stringify(c.req.query("districts")!.split(",")) : org.prospect_districts, prospect_sic: c.req.query("sic") ? JSON.stringify(c.req.query("sic")!.split(",")) : org.prospect_sic, prospect_min_age: c.req.query("age") ?? org.prospect_min_age };
  const rows = await prospectRows(c.env, o, 50);
  const loaded = await one<any>(c.env, "SELECT MAX(loaded_month) AS m, COUNT(*) AS n FROM company_index");
  return c.json({ index_month: loaded?.m || null, index_size: loaded?.n || 0, rows: rows.map((r) => ({ name: r.name, number: r.number, district: r.district, sic: r.sic, incorporated: r.incorporated })) });
});
ws.get("/prospects/file", async (c) => {
  const month = monthOf(c);
  const obj = await c.env.FILES.get(`prospects/${c.get("orgId")}/${month}.csv`);
  if (!obj) throw notFound("Prospect list for " + month);
  return new Response(obj.body, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="prospects-${month}.csv"` } });
});

/* ---------- Audit and billing ---------- */
ws.get("/audit", owner, async (c) => c.json({ entries: await c.get("db").all("SELECT actor, action, target, detail, at FROM audit_log WHERE org_id = ?1 ORDER BY at DESC LIMIT 200") }));

ws.post("/billing/checkout", owner, async (c) => {
  if (!c.env.STRIPE_SECRET) throw new HttpError(503, "billing_off", "Billing isn't set up in this environment.");
  const b = await body(c, z.object({ plan: z.enum(["starter", "growth", "scale"]).optional() }));
  const s = await planCheckout(c.env, c.get("orgId"), c.get("user").email, b.plan);
  return c.json({ url: s.url });
});
ws.post("/billing/portal", owner, async (c) => {
  const sub = await c.get("db").one("SELECT stripe_customer FROM subscription WHERE org_id = ?1");
  if (!sub?.stripe_customer) throw new HttpError(409, "no_subscription", "Start a plan first.");
  const s = await portal(c.env, sub.stripe_customer);
  return c.json({ url: s.url });
});

registerTodayRoutes(ws);
registerOsRoutes(ws);
registerAgentRoutes(ws);
registerSwarmRoutes(ws);
