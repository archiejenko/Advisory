// Paying for Truth API calls: API keys (internal house keys, or prepaid card credits with 100 free calls a month)
// or x402 per call. x402 v2 headers: PAYMENT-REQUIRED (402), PAYMENT-SIGNATURE (request), PAYMENT-RESPONSE (result).
// The legacy v1 X-PAYMENT header is accepted too. Field names follow the x402 spec; confirm against the
// facilitator you choose before going live.
import type { Context } from "hono";
import { b64json, fromB64json, newId, nowIso, sha256Hex } from "../../../../packages/core/util";
import { type Env, one, run } from "./db";
import { HttpError } from "./http";

export type Endpoint = "resolve" | "profile" | "check" | "watch";
export type Price = { label: string; pence: number; usdc_atomic: string };
export type Payer = { kind: "internal" | "credits" | "x402"; keyId?: string; orgId?: string; payer?: string; payment?: any; requirements?: any };

const PRICE_PENCE: Record<Endpoint, number> = { resolve: 2, profile: 3, check: 5, watch: 10 };
const FREE_CALLS = 100;

export function prices(env: Env): Record<Endpoint, { pence: number; usdc_atomic: string }> {
  const usdc = JSON.parse(env.X402_PRICES || '{"resolve":"25000","profile":"40000","check":"60000","watch":"120000"}');
  return Object.fromEntries((Object.keys(PRICE_PENCE) as Endpoint[]).map((k) => [k, { pence: PRICE_PENCE[k], usdc_atomic: usdc[k] }])) as any;
}

const priceOf = (env: Env, ep: Endpoint | Price): Price => (typeof ep === "string" ? { label: ep, ...prices(env)[ep] } : ep);

function requirements(env: Env, price: Price, url: string) {
  return {
    x402Version: 2,
    resource: { url, description: `Agent House ${price.label}`, mimeType: "application/json" },
    accepts: [{
      scheme: "exact", network: env.X402_NETWORK || "eip155:8453", amount: price.usdc_atomic,
      asset: env.X402_ASSET, payTo: env.X402_PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" },
    }],
  };
}

async function facilitator(env: Env, path: "/verify" | "/settle", payload: unknown, req: any) {
  const res = await fetch(env.FACILITATOR_URL.replace(/\/$/, "") + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req }),
  });
  if (!res.ok) throw new HttpError(402, "payment_error", `Payment facilitator returned ${res.status}.`);
  return res.json<any>();
}

/** Work out who pays, before running the handler. Throws 402 with requirements when nobody does. */
export async function authorisePayment(c: Context<{ Bindings: Env }>, ep: Endpoint | Price): Promise<Payer> {
  const env = c.env;
  const price = priceOf(env, ep);
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const key = await one<any>(env, "SELECT * FROM api_key WHERE key_hash = ? AND revoked_at IS NULL", await sha256Hex(auth.slice(7).trim()));
    if (!key) throw new HttpError(401, "invalid_key", "That API key isn't recognised. Check it, or pay per call with x402 instead.");
    if (key.kind === "internal") return { kind: "internal", keyId: key.id, orgId: key.org_id };
    const month = nowIso().slice(0, 7);
    const used = await one<any>(env, "SELECT COUNT(*) AS n FROM usage_event WHERE key_id = ? AND at >= ?", key.id, month + "-01");
    if ((used?.n || 0) >= FREE_CALLS) {
      const bal = await one<any>(env, "SELECT COALESCE(SUM(delta_pence),0) AS b FROM credit_ledger WHERE key_id = ?", key.id);
      if ((bal?.b || 0) < price.pence) throw new HttpError(402, "credits_exhausted", "This key has used its 100 free calls and has no credit left. Buy credits, or pay per call with x402.");
      const today = nowIso().slice(0, 10);
      const spent = await one<any>(env, "SELECT COALESCE(SUM(cost_pence),0) AS s FROM usage_event WHERE key_id = ? AND at >= ?", key.id, today);
      if ((spent?.s || 0) + price.pence > key.daily_cap_pence) throw new HttpError(429, "daily_cap", "This key has reached its daily spend cap. It resets at midnight UTC.");
    }
    return { kind: "credits", keyId: key.id };
  }
  const header = c.req.header("PAYMENT-SIGNATURE") || c.req.header("X-PAYMENT");
  const req = requirements(env, price, c.req.url);
  if (!header) {
    c.header("PAYMENT-REQUIRED", b64json(req));
    throw new HttpError(402, "payment_required", "Pay per call with x402, or use an API key.", req);
  }
  let payload: any;
  try { payload = fromB64json(header); } catch { throw new HttpError(400, "invalid_payment", "The payment header isn't valid base64 JSON."); }
  const v = await facilitator(env, "/verify", payload, req.accepts[0]);
  if (!v.isValid) {
    c.header("PAYMENT-REQUIRED", b64json(req));
    throw new HttpError(402, "payment_invalid", `Payment wasn't accepted: ${v.invalidReason || "unknown reason"}.`, req);
  }
  return { kind: "x402", payer: v.payer, payment: payload, requirements: req.accepts[0] };
}

/** After the handler succeeds: settle x402, charge credits, and log usage. */
export async function completePayment(c: Context<{ Bindings: Env }>, ep: Endpoint | Price, p: Payer, number?: string | null) {
  const env = c.env;
  const price = priceOf(env, ep);
  const pence = price.pence;
  let ref: string | null = null;
  if (p.kind === "x402") {
    const s = await facilitator(env, "/settle", p.payment, p.requirements);
    if (!s.success) throw new HttpError(402, "settlement_failed", "Payment could not be settled. You have not been charged.");
    ref = s.transaction;
    c.header("PAYMENT-RESPONSE", b64json({ success: true, transaction: s.transaction, network: s.network || p.requirements.network, payer: s.payer || p.payer }));
  }
  if (p.kind === "credits") {
    const month = nowIso().slice(0, 7);
    const used = await one<any>(env, "SELECT COUNT(*) AS n FROM usage_event WHERE key_id = ? AND at >= ?", p.keyId, month + "-01");
    if ((used?.n || 0) >= FREE_CALLS) {
      ref = newId("deb");
      await run(env, "INSERT INTO credit_ledger (id, key_id, delta_pence, reason, ref, at) VALUES (?,?,?,?,?,?)", newId("cl"), p.keyId, -pence, "call:" + price.label, ref, nowIso());
    } else ref = "free";
  }
  await run(env, "INSERT INTO usage_event (id, org_id, key_id, kind, number, units, cost_pence, payment, payment_ref, at) VALUES (?,?,?,?,?,1,?,?,?,?)",
    newId("use"), p.orgId ?? null, p.keyId ?? null, "api_call:" + price.label, number ?? null, p.kind === "internal" ? 0 : pence, p.kind, ref, nowIso());
  return { charged: p.kind === "internal" || ref === "free" ? 0 : pence, payment: p.kind };
}
