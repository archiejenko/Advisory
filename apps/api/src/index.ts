// Agent House API Worker. One Worker for version 1, split by route prefix so each API can move
// to its own Worker later: /api/public, /api/auth, /api/ws, /v1 (Truth API), /api/internal, /api/admin, /api/webhooks.
import { Hono } from "hono";
import { ZodError } from "zod";
import type { Env } from "./lib/db";
import { HttpError } from "./lib/http";
import { RateLimited, UpstreamError } from "./lib/registers";
import { auth } from "./routes/auth";
import { ws } from "./routes/ws";
import { truth, wellKnown, mcp, discovery } from "./routes/truth";
import { dev } from "./routes/dev";
import { pub, reports } from "./routes/public";
import { internal, admin, hooks } from "./routes/ops";
import { onQueue, onScheduled } from "./lib/jobs";
import { onEmail } from "./lib/inbound";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (c.req.path.startsWith("/v1") || c.req.path.startsWith("/mcp") || c.req.path === "/llms.txt" || c.req.path.startsWith("/.well-known")) {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  }
});
app.options("/mcp", (c) => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version", "Access-Control-Allow-Methods": "GET, POST" } }));
app.options("/v1/*", (c) => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, PAYMENT-SIGNATURE, X-PAYMENT", "Access-Control-Allow-Methods": "GET, POST, DELETE" } }));

app.get("/api/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));
app.route("/api/public", pub);
app.route("/api/auth", auth);
app.route("/api/ws", ws);
app.route("/api/internal", internal);
app.route("/api/admin", admin);
app.route("/api/webhooks", hooks);
app.route("/v1", truth);
app.route("/mcp", mcp);
app.route("/api/dev", dev);
app.route("/", discovery);
app.route("/.well-known", wellKnown);
app.route("/r", reports);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, ...(err.extra ? { details: err.extra } : {}) } }, err.status as any);
  if (err instanceof RateLimited) return c.json({ error: { code: "busy", message: "The registers are busy right now. Try again in a few minutes." } }, 503, { "Retry-After": String(err.retryAfterSec) });
  if (err instanceof UpstreamError) return c.json({ error: { code: "register_unavailable", message: `${err.source} isn't responding. Try again shortly.` } }, 502);
  if (err instanceof ZodError) return c.json({ error: { code: "invalid_request", message: err.issues[0]?.message } }, 400);
  console.error(err);
  return c.json({ error: { code: "server_error", message: "Something went wrong on our side. It has been logged." } }, 500);
});

// Anything that isn't an API route is the website (static assets, single-page app).
app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/v1/")) return c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404);
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text("Agent House API", 200);
});

export default {
  fetch: app.fetch,
  queue: onQueue,
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(onScheduled(controller, env)),
  email: (message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) => ctx.waitUntil(onEmail(message, env)),
};
