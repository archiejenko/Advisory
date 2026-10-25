// Paying for Truth API calls: API keys (internal house keys, or prepaid card credits with 100 free calls a month)
// or x402 per call. x402 v2 headers: PAYMENT-REQUIRED (402), PAYMENT-SIGNATURE (request), PAYMENT-RESPONSE (result).
// The legacy v1 X-PAYMENT header is accepted too. Field names follow the x402 spec; confirm against the
// facilitator you choose before going live.
import type { Context } from "hono";
import { fetchT } from "./fetch";
import { b64json, fromB64json, newId, nowIso, sha256Hex } from "../../../../packages/core/util";
import { type Env, one, run } from "./db";
import { HttpError } from "./http";

export type Endpoint = "resolve" | "profile" | "check" | "watch";
export type Price = { label: string; pence: number; usdc_atomic: string };
export type Payer = {
  kind: "internal" | "credits" | "x402"; keyId?: string; orgId?: string; payer?: string; payment?: any; requirements?: any;
  /** Credits: "free" (inside the monthly free calls) or the id of the debit taken up front. */
  creditRef?: string;
  /** Free calls: the usage row reserved up front (P2), completed or removed later. */
  usageId?: string;
  /** x402: the payment payload's hash, claimed so it pays for one call only (P1). */
  paymentHash?: string;
  /** x402: set once the payment has been settled. */
  settled?: { transaction: string; network?: string; payer?: string };
};
export type PayOpts = { freeTier?: boolean };

const PRICE_PENCE: Record<Endpoint, number> = { resolve: 2, profile: 3, check: 5, watch: 10 };
const FREE_CALLS = 100;

/** Published USDC prices for the four Truth API endpoints. X402_PRICES (JSON) overrides any of them per deployment. */
const X402_DEFAULT: Record<Endpoint, string> = { resolve: "25000", profile: "40000", check: "60000", watch: "120000" };
export function prices(env: Env): Record<Endpoint, { pence: number; usdc_atomic: string }> {
  const override = JSON.parse(env.X402_PRICES || "{}");
  return Object.fromEntries((Object.keys(PRICE_PENCE) as Endpoint[]).map((k) => [k, { pence: PRICE_PENCE[k], usdc_atomic: String(override[k] ?? X402_DEFAULT[k]) }])) as any;
}

const priceOf = (env: Env, ep: Endpoint | Price): Price => (typeof ep === "string" ? { label: ep, ...prices(env)[ep] } : ep);

/** x402 is on once X402_PAY_TO holds a real 0x address. */
export const x402On = (env: Env) => /^0x[0-9a-fA-F]{40}$/.test(env.X402_PAY_TO || "");

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
  const res = await fetchT(env.FACILITATOR_URL.replace(/\/$/, "") + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req }),
  });
  if (!res.ok) throw new HttpError(402, "payment_error", `Payment facilitator returned ${res.status}.`);
  return res.json<any>();
}

/** USDC (6 decimals) for a price in pence. The rate is USDC_PER_PENNY, default 0.0125 (80p to the dollar). */
export function usdcFor(env: Env, pence: number) {
  const rate = Number(env.USDC_PER_PENNY || 0.0125);
  return String(Math.max(1, Math.round(Math.max(1, pence) * rate * 1e6)));
}

/**
 * Take `pence` from a key's credit, atomically: the debit is written only if the balance covers it,
 * so simultaneous calls can't overdraw. Returns the debit's ref, or null when the balance is short.
 */
export async function debitCredits(env: Env, keyId: string, pence: number, label: string) {
  const ref = newId("deb");
  const r = await run(env, `INSERT INTO credit_ledger (id, key_id, delta_pence, reason, ref, at)
    SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(delta_pence), 0) FROM credit_ledger WHERE key_id = ?) >= ?`,
    newId("cl"), keyId, -pence, "call:" + label, ref, nowIso(), keyId, pence);
  return r.meta.changes ? ref : null;
}

/**
 * Work out who pays, before running the handler. Throws 402 with requirements when nobody does.
 * Credits beyond the free calls are taken here, up front; `releasePayment` gives them back if the call fails.
 */
export async function authorisePayment(c: Context<{ Bindings: Env }>, ep: Endpoint | Price, opts: PayOpts = {}): Promise<Payer> {
  const env = c.env;
  const price = priceOf(env, ep);
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const key = await one<any>(env, "SELECT * FROM api_key WHERE key_hash = ? AND revoked_at IS NULL", await sha256Hex(auth.slice(7).trim()));
    if (!key) throw new HttpError(401, "invalid_key", "That API key isn't recognised. Check it, or pay per call with x402 instead.");
    if (key.kind === "internal") return { kind: "internal", keyId: key.id, orgId: key.org_id };
    const month = nowIso().slice(0, 7);
    if (opts.freeTier !== false) {
      // Reserve the free call in one statement, so a burst of simultaneous calls can't take more than the allowance.
      const usageId = newId("use");
      const r = await run(env, `INSERT INTO usage_event (id, key_id, kind, units, cost_pence, payment, payment_ref, at)
        SELECT ?, ?, ?, 1, 0, 'credits', 'free', ? WHERE (SELECT COUNT(*) FROM usage_event WHERE key_id = ? AND at >= ? AND payment_ref = 'free') < ?`,
        usageId, key.id, "api_call:" + price.label, nowIso(), key.id, month + "-01", FREE_CALLS);
      if (r.meta.changes) return { kind: "credits", keyId: key.id, creditRef: "free", usageId };
    }
    const today = nowIso().slice(0, 10);
    const spent = await one<any>(env, "SELECT COALESCE(SUM(cost_pence),0) AS s FROM usage_event WHERE key_id = ? AND at >= ?", key.id, today);
    if ((spent?.s || 0) + price.pence > key.daily_cap_pence) throw new HttpError(429, "daily_cap", "This key has reached its daily spend cap. It resets at midnight UTC.");
    const ref = await debitCredits(env, key.id, price.pence, price.label);
    if (!ref) throw new HttpError(402, "credits_exhausted", opts.freeTier === false
      ? `This call costs ${price.pence}p and isn't covered by the free calls. Buy credits, or pay per call with x402.`
      : "This key has used its 100 free calls and has no credit left. Buy credits, or pay per call with x402.");
    return { kind: "credits", keyId: key.id, creditRef: ref };
  }
  // No receiving wallet configured yet: pay-per-call is off, API keys still work.
  if (!x402On(env)) throw new HttpError(402, "x402_off", "Pay-per-call isn't switched on yet. Use an API key: the first 100 calls each month are free.");
  const header = c.req.header("PAYMENT-SIGNATURE") || c.req.header("X-PAYMENT");
  const req = requirements(env, price, c.req.url);
  if (!header) {
    c.header("PAYMENT-REQUIRED", b64json(req));
    throw new HttpError(402, "payment_required", "Pay per call with x402, or use an API key.", req);
  }
  let payload: any;
  try { payload = fromB64json(header); } catch { throw new HttpError(400, "invalid_payment", "The payment header isn't valid base64 JSON."); }
  // One payment, one call: claim the payload before verifying it, so concurrent copies of it are refused here
  // instead of each doing paid work while only one settles. Released if the call fails before settling.
  const paymentHash = await sha256Hex(header.trim());
  const claim = await run(env, "INSERT INTO x402_payment (hash, at) VALUES (?, ?) ON CONFLICT(hash) DO NOTHING", paymentHash, nowIso());
  if (!claim.meta.changes) throw new HttpError(409, "payment_reused", "This payment has already been used. Sign a new one for this call.");
  let v: any;
  try { v = await facilitator(env, "/verify", payload, req.accepts[0]); } catch (e) { await run(env, "DELETE FROM x402_payment WHERE hash = ?", paymentHash); throw e; }
  if (!v.isValid) {
    await run(env, "DELETE FROM x402_payment WHERE hash = ?", paymentHash);
    c.header("PAYMENT-REQUIRED", b64json(req));
    throw new HttpError(402, "payment_invalid", `Payment wasn't accepted: ${v.invalidReason || "unknown reason"}.`, req);
  }
  return { kind: "x402", payer: v.payer, payment: payload, requirements: req.accepts[0], paymentHash };
}

/** Settle an x402 payment now (for calls that cost us real money before they can fail, like agent runs). */
export async function settleNow(c: Context<{ Bindings: Env }>, p: Payer) {
  if (p.kind !== "x402" || p.settled) return;
  const s = await facilitator(c.env, "/settle", p.payment, p.requirements);
  if (!s.success) throw new HttpError(402, "settlement_failed", "Payment could not be settled. You have not been charged.");
  p.settled = { transaction: s.transaction, network: s.network || p.requirements.network, payer: s.payer || p.payer };
}

/** The handler failed: give back credits taken up front. (A settled x402 payment can't be returned.) */
export async function releasePayment(env: Env, p: Payer, ep: Endpoint | Price) {
  // An x402 payment that never settled can be used again; a reserved free call goes back to the allowance.
  if (p.kind === "x402" && !p.settled && p.paymentHash) { await run(env, "DELETE FROM x402_payment WHERE hash = ?", p.paymentHash); return; }
  if (p.usageId) { await run(env, "DELETE FROM usage_event WHERE id = ?", p.usageId); p.usageId = undefined; return; }
  if (p.kind !== "credits" || !p.creditRef || p.creditRef === "free") return;
  const price = priceOf(env, ep);
  await run(env, "INSERT INTO credit_ledger (id, key_id, delta_pence, reason, ref, at) VALUES (?,?,?,?,?,?) ON CONFLICT(reason, ref) DO NOTHING",
    newId("cl"), p.keyId, price.pence, "refund", p.creditRef, nowIso());
  p.creditRef = undefined;
}

/** After the handler succeeds: settle x402 (if not already), and log usage. Credits were taken in `authorisePayment`. */
export async function completePayment(c: Context<{ Bindings: Env }>, ep: Endpoint | Price, p: Payer, number?: string | null) {
  const env = c.env;
  const price = priceOf(env, ep);
  const pence = price.pence;
  let ref: string | null = null;
  if (p.kind === "x402") {
    await settleNow(c, p);
    ref = p.settled!.transaction;
    c.header("PAYMENT-RESPONSE", b64json({ success: true, transaction: p.settled!.transaction, network: p.settled!.network, payer: p.settled!.payer }));
  }
  if (p.kind === "credits") ref = p.creditRef ?? null;
  if (p.usageId) { // a free call reserved up front: just record what it was for
    await run(env, "UPDATE usage_event SET number = ? WHERE id = ?", number ?? null, p.usageId);
    return { charged: 0, payment: p.kind };
  }
  await run(env, "INSERT INTO usage_event (id, org_id, key_id, kind, number, units, cost_pence, payment, payment_ref, at) VALUES (?,?,?,?,?,1,?,?,?,?)",
    newId("use"), p.orgId ?? null, p.keyId ?? null, "api_call:" + price.label, number ?? null, p.kind === "internal" || ref === "free" ? 0 : pence, p.kind, ref, nowIso());
  return { charged: p.kind === "internal" || ref === "free" ? 0 : pence, payment: p.kind };
}

/**
 * The whole paid-call sequence: authorise (taking credits up front), optionally settle x402 first,
 * run, then settle and log. If the handler throws, credits are refunded and nothing is logged.
 */
export async function withPayment<T>(c: Context<{ Bindings: Env }>, ep: Endpoint | Price, fn: (p: Payer) => Promise<{ out: T; number?: string | null }>, opts: PayOpts & { settleFirst?: boolean } = {}) {
  const p = await authorisePayment(c, ep, opts);
  if (opts.settleFirst) {
    try { await settleNow(c, p); } catch (e) { await releasePayment(c.env, p, ep); throw e; }
  }
  let r: { out: T; number?: string | null };
  try { r = await fn(p); }
  catch (e) { await releasePayment(c.env, p, ep).catch((x) => console.error("refund failed", x)); throw e; }
  const done = await completePayment(c, ep, p, r.number ?? null);
  return { out: r.out, payer: p, ...done };
}
