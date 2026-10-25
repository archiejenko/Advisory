// Internal ingest (from the stream listener), operator admin, and inbound webhooks.
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import { newId, nowIso, randomToken, sha256Hex, district } from "../../../../packages/core/util";
import { parseCsv } from "../../../../packages/core/csv";
import { type Env, one, all, run, audit } from "../lib/db";
import { body, bad, notFound, HttpError } from "../lib/http";
import { ingestEvent } from "../lib/process";
import { sendMail } from "../lib/mail";
import { verifyStripeSignature } from "../lib/crypto";
import { pollGazette, reconcile, digests, monthly, retention } from "../lib/jobs";
import { createOrg } from "../lib/orgs";
import { dueAgents, sweepRuns } from "../lib/agents";
import { applyStripeEvent } from "../lib/billing";

const bearer = (secretName: string) => async (c: Context<{ Bindings: Env }>, next: Next) => {
  const want = c.env[secretName];
  const got = c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!want || !got || (await sha256Hex(got)) !== (await sha256Hex(want))) throw new HttpError(401, "unauthorised", "Not authorised.");
  await next();
};

/* ---------- Ingest from the stream listener ---------- */
export const internal = new Hono<{ Bindings: Env }>();
internal.use("*", bearer("INGEST_SECRET"));

const EventIn = z.object({ source: z.string(), source_id: z.string(), number: z.string().regex(/^[A-Z0-9]{8}$/i), kind: z.string(), occurred_at: z.string().optional(), timepoint: z.number().optional(), payload: z.unknown().optional() });

internal.post("/events", async (c) => {
  const b = await body(c, z.object({ events: z.array(EventIn).max(500) }));
  const out = { queued: 0, duplicate: 0, not_watched: 0 };
  for (const e of b.events) out[await ingestEvent(c.env, { ...e, number: e.number.toUpperCase() })]++;
  // Remember how far each stream got, so the listener can resume after a restart.
  const latest: Record<string, number> = {};
  for (const e of b.events) if (e.timepoint != null) latest[e.source] = Math.max(latest[e.source] || 0, e.timepoint);
  for (const [s, t] of Object.entries(latest)) await c.env.CACHE.put("timepoint:" + s, String(t));
  return c.json(out);
});

internal.get("/timepoint", async (c) => c.json({ timepoint: Number((await c.env.CACHE.get("timepoint:" + (c.req.query("source") || ""))) || 0) || null }));

/* ---------- Operator admin ---------- */
export const admin = new Hono<{ Bindings: Env }>();
admin.use("*", bearer("ADMIN_TOKEN"));
// Every operator write leaves a trace: the route, the result and where it came from. Reads aren't logged.
admin.use("*", async (c, next) => {
  await next();
  if (c.req.method === "GET") return;
  await audit(c.env, null, "operator", `admin:${c.req.method} ${c.req.path}`, c.req.path.split("/")[4], { status: c.res.status, ip: c.req.header("CF-Connecting-IP") || null })
    .catch((e) => console.error("admin audit failed", e));
});

/** Create a pilot MSP: organisation, owner, the three agents, and an internal Truth API key. */
admin.post("/orgs", async (c) => {
  const b = await body(c, z.object({ name: z.string().min(1).max(150), owner_email: z.string().email(), owner_name: z.string().max(100).optional(), agents: z.array(z.string()).max(12).optional() }));
  const r = await createOrg(c.env, { name: b.name, owner_email: b.owner_email, owner_name: b.owner_name, agents: b.agents ?? ["customer-watch", "customer-check"], by: "operator" });
  return c.json(r, 201);
});

/** Developer tools waiting for review, and the decision. */
admin.get("/tools", async (c) => c.json({ tools: (await all<any>(c.env, "SELECT t.slug, t.name, t.description, t.input_schema, t.endpoint, t.price_pence, t.status, t.review_note, t.calls, t.created_at, k.owner_email FROM tool t LEFT JOIN api_key k ON k.id = t.owner_key_id ORDER BY t.status = 'review' DESC, t.created_at DESC LIMIT 200")).map((t) => ({ ...t, input_schema: JSON.parse(t.input_schema) })) }));
admin.post("/tools/:slug/:decision", async (c) => {
  const d = c.req.param("decision");
  if (d !== "approve" && d !== "reject") throw notFound("Decision");
  const b = await body(c, z.object({ note: z.string().max(500).optional() }));
  const t = await one<any>(c.env, "SELECT t.*, k.owner_email FROM tool t LEFT JOIN api_key k ON k.id = t.owner_key_id WHERE t.slug = ?", c.req.param("slug"));
  if (!t) throw notFound("Tool");
  await run(c.env, "UPDATE tool SET status = ?, review_note = ?, reviewed_at = ? WHERE slug = ?", d === "approve" ? "live" : "rejected", b.note ?? null, nowIso(), t.slug);
  if (t.owner_email) await sendMail(c.env, { kind: "transactional", to: t.owner_email, subject: d === "approve" ? `${t.name} is live on Agent House` : `${t.name} wasn't approved`, text: d === "approve" ? `Your tool ${t.slug} is now in the catalogue and the MCP server. You earn 80% of every paid call.` : `We couldn't list ${t.slug}.${b.note ? " " + b.note : ""} Update it from your developer dashboard and it comes back to us.` });
  return c.json({ ok: true, status: d === "approve" ? "live" : "rejected" });
});

admin.get("/orgs", async (c) => c.json({ orgs: await all(c.env, `SELECT o.id, o.name, o.created_at, s.status AS plan,
  (SELECT COUNT(*) FROM client cl WHERE cl.org_id = o.id) AS clients,
  (SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = o.id AND m.role = 'owner' LIMIT 1) AS owner_email
  FROM org o LEFT JOIN subscription s ON s.org_id = o.id ORDER BY o.created_at DESC LIMIT 200`) }));

admin.get("/health-checks", async (c) => c.json({ health_checks: await all(c.env, "SELECT id, name, email, company, status, summary, created_at, approved_at, sent_at FROM health_check ORDER BY created_at DESC LIMIT 100") }));

admin.get("/health-checks/:id/preview", async (c) => {
  const hc = await one<any>(c.env, "SELECT * FROM health_check WHERE id = ?", c.req.param("id"));
  if (!hc?.report_key) throw notFound("Report");
  const obj = await c.env.FILES.get(hc.report_key);
  return new Response(obj!.body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

/** The guardrail: no health check reaches a customer until the operator approves it. */
admin.post("/health-checks/:id/approve", async (c) => {
  const hc = await one<any>(c.env, "SELECT * FROM health_check WHERE id = ?", c.req.param("id"));
  if (!hc) throw notFound("Health check");
  if (hc.status !== "awaiting_approval") throw bad(`This health check is ${hc.status.replace("_", " ")}, not awaiting approval.`);
  const link = `${c.env.API_URL}/r/${hc.token}`;
  const s = JSON.parse(hc.summary);
  const result = await sendMail(c.env, { kind: "transactional", to: hc.email, subject: `Your client book health check: ${s.flagged} of ${s.sent} clients flagged`, text: `Hi ${hc.name},\n\nWe ran ${hc.company}'s ${s.sent} clients against Companies House, The Gazette and the FCA register.\n\nMatched: ${s.matched}\nFor you to confirm: ${s.confirm}\nFlagged: ${s.flagged}\n\nRead the report: ${link}\n\nWant to go through it together? Book 20 minutes: ${c.env.APP_URL}#/book-a-call\n\nTo stop hearing from us, reply "unsubscribe".` });
  await run(c.env, "UPDATE health_check SET status = 'sent', approved_at = ?, sent_at = ? WHERE id = ?", nowIso(), nowIso(), hc.id);
  await audit(c.env, null, "operator", "health_check_approved", hc.id, { mail: result });
  return c.json({ ok: true, link, mail: result });
});

/** Load the Companies House monthly bulk snapshot (or a slice of it) into the prospect index. */
admin.post("/company-index", async (c) => {
  const text = await c.req.text();
  const rows = parseCsv(text);
  const h = rows[0].map((x) => x.trim());
  const ix = (k: string) => h.findIndex((x) => x === k);
  const I = { name: ix("CompanyName"), number: ix("CompanyNumber"), status: ix("CompanyStatus"), inc: ix("IncorporationDate"), pc: ix("RegAddress.PostCode"), sic: ix("SICCode.SicText_1") };
  if (Object.values(I).some((v) => v < 0)) throw bad("Expected the Companies House bulk data columns: CompanyName, CompanyNumber, CompanyStatus, IncorporationDate, RegAddress.PostCode, SICCode.SicText_1.");
  const month = nowIso().slice(0, 7);
  const toIso = (d: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(d) ? `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : d;
  const stmts = rows.slice(1).map((r) => c.env.DB.prepare(`INSERT INTO company_index (number, name, status, incorporated, postcode, district, sic, loaded_month) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(number) DO UPDATE SET name=excluded.name, status=excluded.status, incorporated=excluded.incorporated, postcode=excluded.postcode, district=excluded.district, sic=excluded.sic, loaded_month=excluded.loaded_month`)
    .bind(r[I.number], r[I.name], r[I.status], toIso(r[I.inc]), r[I.pc], district(r[I.pc]), (r[I.sic] || "").split(" ")[0], month));
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json({ loaded: stmts.length, month });
});

admin.post("/run/:task", async (c) => {
  const t = c.req.param("task");
  const r = t === "gazette" ? await pollGazette(c.env) : t === "reconcile" ? await reconcile(c.env, new Date(), { all: c.req.query("all") === "1" }) : t === "digests" ? await digests(c.env, new Date(c.req.query("at") || Date.now())) : t === "agents" ? await dueAgents(c.env, new Date(c.req.query("at") || Date.now())) : t === "monthly" ? await monthly(c.env) : t === "retention" ? await retention(c.env) : t === "sweep" ? await sweepRuns(c.env, new Date(c.req.query("at") || Date.now())) : null;
  if (r === null) throw notFound("Task");
  return c.json({ task: t, result: r });
});

/* ---------- Jobs that ran out of retries ---------- */
admin.get("/dead-jobs", async (c) => c.json({ jobs: await all(c.env, "SELECT id, queue, type, body, attempts, at FROM dead_job WHERE resolved_at IS NULL ORDER BY at DESC LIMIT 200") }));
/** Put a dead job back on its queue (once the cause is fixed), or mark it dealt with. */
admin.post("/dead-jobs/:id/:decision", async (c) => {
  const d = c.req.param("decision");
  if (d !== "retry" && d !== "resolve") throw bad("Use retry or resolve.");
  const j = await one<any>(c.env, "SELECT * FROM dead_job WHERE id = ? AND resolved_at IS NULL", c.req.param("id"));
  if (!j) throw notFound("Dead job");
  if (d === "retry") await (j.type === "agent_run" ? c.env.AGENT_JOBS ?? c.env.JOBS : c.env.JOBS).send(JSON.parse(j.body));
  await run(c.env, "UPDATE dead_job SET resolved_at = ? WHERE id = ?", nowIso(), j.id);
  return c.json({ ok: true });
});

admin.get("/outbox", async (c) => c.json({ mail: await all(c.env, "SELECT * FROM dev_outbox ORDER BY at DESC LIMIT 100") }));

/* ---------- Inbound webhooks ---------- */
export const hooks = new Hono<{ Bindings: Env }>();

hooks.post("/stripe", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, "billing_off", "Billing isn't set up in this environment.");
  const payload = await c.req.text();
  if (!(await verifyStripeSignature(c.env.STRIPE_WEBHOOK_SECRET, c.req.header("Stripe-Signature"), payload))) throw new HttpError(400, "bad_signature", "Signature check failed.");
  const ev = JSON.parse(payload);
  if (await one(c.env, "SELECT 1 AS x FROM webhook_seen WHERE source = 'stripe' AND event_id = ?", ev.id)) return c.json({ received: true, duplicate: true });
  // Process first, record it as seen only once that succeeds. If processing throws, Stripe's retry gets a
  // fresh attempt instead of being dropped as a duplicate. applyStripeEvent is idempotent, so a concurrent
  // second delivery is harmless.
  await applyStripeEvent(c.env, ev);
  await run(c.env, "INSERT INTO webhook_seen (source, event_id, at) VALUES ('stripe', ?, ?) ON CONFLICT DO NOTHING", ev.id, nowIso());
  return c.json({ received: true });
});
