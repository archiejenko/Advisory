// The Truth API: resolve, profile, check, watch. Paid per call with x402, or with an API key.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { newId, nowIso } from "../../../../packages/core/util";
import { signBody } from "../../../../packages/core/sign";
import { type Env, one, run } from "../lib/db";
import { body, bad, notFound, HttpError } from "../lib/http";
import { authorisePayment, completePayment, prices } from "../lib/pay";
import { resolveInput, checkInput, profileFields } from "../lib/truth";
import { companyCached } from "../lib/registers";
import { getTool, runTool, catalogue, usdcFor, builtin, creditPublisher, PUBLIC_TOOLS, type Tool } from "../lib/tools";
import { agentLoop, MAX_STEPS } from "../lib/agents";
import { signingKey, publicJwk } from "../lib/crypto";

export const truth = new Hono<{ Bindings: Env }>();

truth.get("/prices", (c) => c.json({ currency: { pence: "GBP pence for API-key credits", usdc_atomic: "USDC, 6 decimals, for x402" }, free_calls_per_month: 100, prices: prices(c.env) }));

/* The four operations, shared by the REST routes and the MCP server. */
async function resolveOp(env: Env, input: string) {
  const m = await resolveInput(env, input);
  const res = await signBody({
    response_id: newId("res"), input, confidence: m.confidence,
    candidates: m.candidates.map((x) => ({ name: x.name, number: x.number, status: x.status, postcode: x.postcode, score: x.score, reasons: x.reasons })),
    checked_at: nowIso(),
  }, await signingKey(env), env.SIGNING_KID);
  return { res, number: m.chosen ?? null };
}
const NUMBER = /^[A-Z0-9]{8}$/;
async function profileOp(env: Env, raw: string) {
  const number = raw.toUpperCase();
  if (!NUMBER.test(number)) throw bad("Company numbers are 8 characters, for example 13985402 or SC123456.");
  const rec = await companyCached(env, number);
  if (!rec) throw notFound("Company " + number);
  return signBody({ response_id: newId("prf"), ...profileFields(rec) }, await signingKey(env), env.SIGNING_KID);
}
async function watchOp(env: Env, keyId: string, raw: string[], webhook: string) {
  if (!webhook.startsWith("https://") && env.ALLOW_ANY_WEBHOOK_HOST !== "true") throw bad("The webhook must use https.");
  const numbers = [...new Set(raw.map((n) => n.toUpperCase()))];
  if (numbers.some((n) => !NUMBER.test(n))) throw bad("Company numbers are 8 characters, for example 13985402 or SC123456.");
  const id = newId("wch");
  await run(env, "INSERT INTO watch_subscription (id, key_id, numbers, webhook, created_at) VALUES (?,?,?,?,?)", id, keyId, JSON.stringify(numbers), webhook, nowIso());
  // Read each company once, so the first change can be compared against something.
  for (const n of numbers) {
    const known = await one(env, "SELECT 1 AS x FROM company WHERE number = ?", n);
    if (!known) {
      const eid = newId("evt");
      await run(env, "INSERT OR IGNORE INTO register_event (id, number, kind, occurred_at, source, source_id) VALUES (?,?,?,?,?,?)", eid, n, "baseline", nowIso(), "agent-house", "baseline:" + n);
      await env.JOBS.send({ type: "company", number: n, event_id: eid, baseline: true });
    }
  }
  return { watch_id: id, companies: numbers.length, delivery: "Signed webhook per change, as each change arrives" };
}
const WATCH_NEEDS_KEY = "Watching needs an API key, so changes can be billed and sent to you. Pay-per-call x402 works for the other endpoints.";

truth.post("/resolve", async (c) => {
  const b = await body(c, z.object({ input: z.string().min(2).max(500) }));
  const p = await authorisePayment(c, "resolve");
  const { res, number } = await resolveOp(c.env, b.input);
  await completePayment(c, "resolve", p, number);
  return c.json(res);
});

truth.get("/companies/:number", async (c) => {
  if (!NUMBER.test(c.req.param("number").toUpperCase())) throw bad("Company numbers are 8 characters, for example 13985402 or SC123456.");
  const p = await authorisePayment(c, "profile");
  const res = await profileOp(c.env, c.req.param("number"));
  await completePayment(c, "profile", p, c.req.param("number").toUpperCase());
  return c.json(res);
});

truth.post("/check", async (c) => {
  const b = await body(c, z.object({ input: z.string().min(2).max(2000) }));
  const p = await authorisePayment(c, "check");
  const res: any = await checkInput(c.env, b.input);
  await completePayment(c, "check", p, res.match?.number);
  return c.json(res);
});

truth.post("/watch", async (c) => {
  const b = await body(c, z.object({ numbers: z.array(z.string().regex(/^[A-Z0-9]{8}$/i)).min(1).max(500), webhook: z.string().url() }));
  if (!b.webhook.startsWith("https://") && c.env.ALLOW_ANY_WEBHOOK_HOST !== "true") throw bad("The webhook must use https.");
  const p = await authorisePayment(c, "watch");
  if (!p.keyId) throw bad(WATCH_NEEDS_KEY);
  const res = await watchOp(c.env, p.keyId, b.numbers, b.webhook);
  await completePayment(c, "watch", p, null);
  return c.json(res, 201);
});

truth.delete("/watch/:id", async (c) => {
  const p = await authorisePayment(c, "resolve");
  const r = await run(c.env, "UPDATE watch_subscription SET deleted_at = ? WHERE id = ? AND key_id = ? AND deleted_at IS NULL", nowIso(), c.req.param("id"), p.keyId ?? "");
  if (!r.meta.changes) throw notFound("Watch");
  return c.json({ ok: true });
});

export const wellKnown = new Hono<{ Bindings: Env }>();
wellKnown.get("/agent-house-key", (c) => c.json({ keys: [publicJwk(c.env)] }));

/* ---------- The tool gateway: any tool in the catalogue, priced per tool ---------- */
const LEGACY: Record<string, string> = { resolve: "uk-resolve", profile: "uk-profile", check: "uk-check", watch: "uk-watch" };
const WATCH_TOOL = {
  slug: "uk-watch", name: "Watch UK companies", price_pence: 10,
  description: "Subscribe to changes on a set of UK companies. Each change is posted to your webhook, signed. Needs an API key.",
  input_schema: { type: "object", properties: { numbers: { type: "array", items: { type: "string" } }, webhook: { type: "string", description: "https URL" } }, required: ["numbers", "webhook"] },
};

/** Call one tool on behalf of an outside caller: authorise payment, run, sign, settle, credit the publisher. */
export async function callTool(c: Context<{ Bindings: Env }>, slugIn: string, input: any) {
  const slug = LEGACY[slugIn] || slugIn;
  if (slug === "uk-watch") {
    const nums = Array.isArray(input?.numbers) ? input.numbers.map(String) : [];
    if (!nums.length || typeof input?.webhook !== "string") throw bad("Give numbers (a list of company numbers) and webhook (an https URL).");
    const p = await authorisePayment(c, "watch");
    if (!p.keyId) throw bad(WATCH_NEEDS_KEY);
    const res = await watchOp(c.env, p.keyId, nums, input.webhook);
    await completePayment(c, "watch", p, null);
    return res;
  }
  const tool = await getTool(c.env, slug);
  if (!tool) throw notFound("Tool " + slug);
  const price = { label: "tool:" + slug, pence: tool.price_pence, usdc_atomic: usdcFor(tool.price_pence) };
  const p = await authorisePayment(c, price);
  const result = await runTool({ env: c.env }, tool, input);
  const signed = await signBody({ response_id: newId("tl"), tool: slug, result, checked_at: nowIso() }, await signingKey(c.env), c.env.SIGNING_KID);
  const done = await completePayment(c, price, p, (result as any)?.match?.number ?? null);
  if (!builtin(slug)) await creditPublisher(c.env, slug, done.charged, done.payment);
  return signed;
}

async function catalogueOut(env: Env) {
  const base = (env.API_URL || "").replace(/\/$/, "");
  const list = (await catalogue(env)).map(({ t, publisher }) => ({ slug: t.slug, name: t.name, description: t.description, input_schema: t.input_schema, price: { pence: t.price_pence, usdc_atomic: usdcFor(t.price_pence) }, publisher, call: `POST ${base}/v1/tools/${t.slug}` }));
  list.push({ slug: WATCH_TOOL.slug, name: WATCH_TOOL.name, description: WATCH_TOOL.description, input_schema: WATCH_TOOL.input_schema, price: { pence: 10, usdc_atomic: prices(env).watch.usdc_atomic }, publisher: "Agent House", call: `POST ${base}/v1/tools/uk-watch` });
  return list;
}

truth.get("/tools", async (c) => c.json({
  tools: await catalogueOut(c.env),
  agents_run: { call: "POST /v1/agents/run", price: { pence: AGENT_RUN_PENCE, usdc_atomic: usdcFor(AGENT_RUN_PENCE) }, max_steps: MAX_STEPS },
  payment: { x402: { version: 2, network: c.env.X402_NETWORK || "eip155:8453", asset: c.env.X402_ASSET, header: "PAYMENT-SIGNATURE" }, api_key: { header: "Authorization: Bearer", free_calls_per_month: 100 } },
  signing_key: "/.well-known/agent-house-key",
}));

truth.post("/tools/:slug", async (c) => {
  let input: any = {};
  const text = await c.req.text();
  if (text.trim()) { try { input = JSON.parse(text); } catch { throw bad("Send the tool's input as a JSON object."); } }
  return c.json(await callTool(c, c.req.param("slug"), input));
});

/* ---------- Agents API: run an agent with catalogue tools, in one call ---------- */
const AGENT_RUN_PENCE = 25;
truth.post("/agents/run", async (c) => {
  const b = await body(c, z.object({ instructions: z.string().min(10).max(4000), input: z.string().max(4000).default(""), tools: z.array(z.string()).min(1).max(8), max_steps: z.number().int().min(1).max(MAX_STEPS).optional() }));
  const tools: Tool[] = [];
  for (const s of b.tools) {
    const t = await getTool(c.env, LEGACY[s] || s);
    if (!t || !builtin(t.slug)) throw bad(`"${s}" isn't a first-party tool. Agent runs can use: ${PUBLIC_TOOLS.map((x) => x.slug).join(", ")}.`);
    tools.push(t);
  }
  const price = { label: "agents-run", pence: AGENT_RUN_PENCE, usdc_atomic: usdcFor(AGENT_RUN_PENCE) };
  const p = await authorisePayment(c, price);
  const out = await agentLoop(c.env, {
    system: `${b.instructions}\n\nRules: use only the tools given; never invent facts, figures or email addresses; say what you could not find. End with your answer in plain text.`,
    user: b.input || "Begin.", tools, ctx: { env: c.env }, maxSteps: b.max_steps,
  });
  const res = await signBody({ response_id: newId("agr"), output: out.text, steps: out.toolCalls.map((t) => ({ tool: t.tool, input: t.input, ok: t.ok })), usage: { model_steps: out.steps, tokens_in: out.tokensIn, tokens_out: out.tokensOut }, finished_at: nowIso() }, await signingKey(c.env), c.env.SIGNING_KID);
  await completePayment(c, price, p, null);
  return c.json(res);
});

export const discovery = new Hono<{ Bindings: Env }>();
discovery.get("/.well-known/agent-house.json", (c) => {
  const base = (c.env.API_URL || "").replace(/\/$/, "");
  return c.json({
    name: "Agent House", description: "Tools for agents: UK company data, web and company research, and developer-published tools. Signed answers, paid per call with x402 or an API key.",
    tools: `${base}/v1/tools`, mcp: `${base}/mcp`, agents_run: `${base}/v1/agents/run`, signing_key: `${base}/.well-known/agent-house-key`,
    payment: { x402: { version: 2, network: c.env.X402_NETWORK || "eip155:8453", asset: c.env.X402_ASSET }, api_key: `${c.env.APP_URL}#/developers?s=key` },
    docs: `${c.env.APP_URL}#/for-agents`,
  });
});
discovery.get("/llms.txt", async (c) => {
  const base = (c.env.API_URL || "").replace(/\/$/, "");
  const tools = await catalogueOut(c.env);
  return c.text([
    "# Agent House", "",
    "> Tools for agents: UK company data, web and company research, and tools published by developers. Every answer is signed (Ed25519). Pay per call with x402 (USDC on Base) or an API key.", "",
    "## Use", `- Catalogue with prices and schemas: ${base}/v1/tools`, `- Call a tool: POST ${base}/v1/tools/{slug} with the input as JSON`, `- MCP server: ${base}/mcp`, `- Run an agent: POST ${base}/v1/agents/run`, `- Verify answers: ${base}/.well-known/agent-house-key`, "",
    "## Tools", ...tools.map((t) => `- ${t.slug} (${t.price.pence}p): ${t.description}`), "",
  ].join("\n"));
});

/* ---------- MCP server (Streamable HTTP, JSON responses) ----------
 * Every tool in the catalogue, billed to the API key in the Authorization header like the REST API;
 * initialize and tools/list need no key. */
export const mcp = new Hono<{ Bindings: Env }>();
const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

mcp.get("/", (c) => c.json(rpcErr(null, -32000, "Use POST with JSON-RPC. This server doesn't open event streams."), 405));
mcp.post("/", async (c) => {
  let msg: any;
  try { msg = await c.req.json(); } catch { return c.json(rpcErr(null, -32700, "Parse error"), 400); }
  if (Array.isArray(msg)) return c.json(rpcErr(null, -32600, "Batches aren't supported; send one request at a time."), 400);
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return c.body(null, 202); // notifications, e.g. notifications/initialized
  if (method === "initialize") {
    return c.json(rpc(id, { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "agent-house", title: "Agent House: tools for agents", version: "2.0.0" },
      instructions: "UK company data, web and company research, and developer tools. Every result is signed (Ed25519). Calls are billed to the API key sent as a Bearer token; 100 calls a month are free." }));
  }
  if (method === "ping") return c.json(rpc(id, {}));
  if (method === "tools/list") return c.json(rpc(id, { tools: (await catalogueOut(c.env)).map((t) => ({ name: t.slug, title: t.name, description: `${t.description} (${t.price.pence}p a call)`, inputSchema: t.input_schema })) }));
  if (method !== "tools/call") return c.json(rpcErr(id, -32601, "Method not found: " + method));
  const name = String(params?.name || ""), a = params?.arguments || {};
  const ok = (r: unknown) => c.json(rpc(id, { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r, isError: false }));
  const fail = (text: string) => c.json(rpc(id, { content: [{ type: "text", text }], isError: true }));
  if (!c.req.header("Authorization")?.startsWith("Bearer ")) return fail("Add your Agent House API key as a Bearer token in the MCP server's headers. Get one free at /#/developers.");
  const slug = LEGACY[name] || name;
  if (slug !== "uk-watch" && !(await getTool(c.env, slug))) return c.json(rpcErr(id, -32602, "Unknown tool: " + name));
  try {
    return ok(await callTool(c, slug, a));
  } catch (e: any) {
    if (e instanceof HttpError) return fail(e.message); // invalid key, credits exhausted, not found
    throw e;
  }
});
