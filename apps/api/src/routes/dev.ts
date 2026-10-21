// Developer dashboard API: signed in with an API key. Publish tools, see calls, credits and earnings.
import { Hono, type Context, type Next } from "hono";
import { z } from "zod";
import { nowIso, randomToken, sha256Hex } from "../../../../packages/core/util";
import { type Env, one, all, run } from "../lib/db";
import { body, bad, notFound, HttpError } from "../lib/http";
import { seal } from "../lib/crypto";
import { sendMail } from "../lib/mail";
import { builtin } from "../lib/tools";

type V = { key: any };
export const dev = new Hono<{ Bindings: Env; Variables: V }>();

async function keyAuth(c: Context<{ Bindings: Env; Variables: V }>, next: Next) {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "no_key", "Sign in with your API key.");
  const key = await one<any>(c.env, "SELECT * FROM api_key WHERE key_hash = ? AND revoked_at IS NULL AND kind = 'credits'", await sha256Hex(auth.slice(7).trim()));
  if (!key) throw new HttpError(401, "invalid_key", "That API key isn't recognised.");
  c.set("key", key);
  await next();
}
dev.use("*", keyAuth);

dev.get("/me", async (c) => {
  const k = c.get("key"), month = nowIso().slice(0, 7) + "-01";
  const n = async (sql: string, ...a: any[]) => ((await one<any>(c.env, sql, ...a)) as any)?.n || 0;
  return c.json({
    key_id: k.id, email: k.owner_email, created_at: k.created_at, daily_cap_pence: k.daily_cap_pence,
    free_calls: 100, calls_this_month: await n("SELECT COUNT(*) AS n FROM usage_event WHERE key_id = ? AND at >= ?", k.id, month),
    credit_pence: await n("SELECT COALESCE(SUM(delta_pence),0) AS n FROM credit_ledger WHERE key_id = ?", k.id),
    earnings_pence: await n("SELECT COALESCE(SUM(share_pence),0) AS n FROM tool_earning WHERE owner_key_id = ?", k.id),
    earnings_month_pence: await n("SELECT COALESCE(SUM(share_pence),0) AS n FROM tool_earning WHERE owner_key_id = ? AND at >= ?", k.id, month),
  });
});

dev.get("/calls", async (c) => {
  const k = c.get("key");
  return c.json({
    calls: await all<any>(c.env, "SELECT kind, cost_pence, payment, at FROM usage_event WHERE key_id = ? ORDER BY at DESC LIMIT 100", k.id),
    earnings: await all<any>(c.env, "SELECT tool_slug, gross_pence, share_pence, payment, at FROM tool_earning WHERE owner_key_id = ? ORDER BY at DESC LIMIT 100", k.id),
  });
});

const toolOut = (t: any) => ({ slug: t.slug, name: t.name, description: t.description, input_schema: JSON.parse(t.input_schema), endpoint: t.endpoint, price_pence: t.price_pence, status: t.status, review_note: t.review_note, calls: t.calls, created_at: t.created_at, reviewed_at: t.reviewed_at });
dev.get("/tools", async (c) => c.json({ tools: (await all<any>(c.env, "SELECT * FROM tool WHERE owner_key_id = ? ORDER BY created_at DESC", c.get("key").id)).map(toolOut) }));

const ToolIn = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/, "Use 3 to 40 lowercase letters, numbers and hyphens, starting with a letter."),
  name: z.string().min(3).max(60),
  description: z.string().min(20, "Describe what it returns in at least 20 characters.").max(600),
  input_schema: z.object({ type: z.literal("object"), properties: z.record(z.any()) }).passthrough(),
  endpoint: z.string().url(),
  price_pence: z.number().int().min(1).max(500),
});
function checkEndpoint(env: Env, url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" && env.ALLOW_ANY_WEBHOOK_HOST !== "true") throw bad("The endpoint must use https.");
}

dev.post("/tools", async (c) => {
  const b = await body(c, ToolIn);
  checkEndpoint(c.env, b.endpoint);
  if (builtin(b.slug) || ["uk-watch", "agents-run"].includes(b.slug) || (await one(c.env, "SELECT slug FROM tool WHERE slug = ?", b.slug))) throw new HttpError(409, "slug_taken", `The name "${b.slug}" is taken. Choose another.`);
  const secret = "ahs_" + randomToken(24);
  await run(c.env, "INSERT INTO tool (slug, name, description, input_schema, owner_key_id, endpoint, secret_enc, price_pence, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    b.slug, b.name, b.description, JSON.stringify(b.input_schema), c.get("key").id, b.endpoint, await seal(c.env, secret), b.price_pence, "review", nowIso());
  if (c.env.OPERATOR_EMAIL) await sendMail(c.env, { to: c.env.OPERATOR_EMAIL, subject: `Tool to review: ${b.slug}`, text: `${b.name} (${b.price_pence}p) from ${c.get("key").owner_email}\n${b.description}\nEndpoint: ${b.endpoint}\nReview it: ${c.env.APP_URL}#/admin` });
  return c.json({ slug: b.slug, status: "review", signing_secret: secret, message: "We'll review it within one working day. Keep the signing secret: it's shown once, and you'll use it to check every request comes from us." }, 201);
});

dev.patch("/tools/:slug", async (c) => {
  const b = await body(c, ToolIn.partial().omit({ slug: true }).extend({ status: z.literal("retired").optional() }));
  const t = await one<any>(c.env, "SELECT * FROM tool WHERE slug = ? AND owner_key_id = ?", c.req.param("slug"), c.get("key").id);
  if (!t) throw notFound("Tool");
  if (b.endpoint) checkEndpoint(c.env, b.endpoint);
  // A changed endpoint or schema on a live tool goes back to review; so does any change to a rejected tool.
  const backToReview = (b.endpoint && b.endpoint !== t.endpoint) || b.input_schema !== undefined || (t.status === "rejected" && Object.keys(b).some((k) => k !== "status"));
  const next = b.status === "retired" ? "retired" : backToReview && ["live", "rejected"].includes(t.status) ? "review" : t.status;
  await run(c.env, `UPDATE tool SET name = ?, description = ?, input_schema = ?, endpoint = ?, price_pence = ?, status = ? WHERE slug = ?`,
    b.name ?? t.name, b.description ?? t.description, b.input_schema ? JSON.stringify(b.input_schema) : t.input_schema, b.endpoint ?? t.endpoint, b.price_pence ?? t.price_pence,
    next, t.slug);
  return c.json({ ok: true, status: next });
});
