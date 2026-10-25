// Stripe over its REST API (no SDK, so it runs in a Worker). Stripe stays the source of truth for payment.
import { HttpError } from "./http";
import { fetchT } from "./fetch";
import type { Env } from "./db";

function form(obj: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) p.append(k, String(v));
  return p;
}

export async function stripe(env: Env, path: string, params: Record<string, string | number | undefined>) {
  const res = await fetchT((env.STRIPE_BASE || "https://api.stripe.com").replace(/\/$/, "") + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.STRIPE_SECRET, "Content-Type": "application/x-www-form-urlencoded" },
    body: form(params),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Stripe returned ${res.status}`);
  return j;
}

/** Plans: Starter, Growth or Scale, one Stripe price each. No per-customer or overage charges. */
export function planCheckout(env: Env, orgId: string, email: string, plan: "starter" | "growth" | "scale" = "growth") {
  const price = env[`STRIPE_PRICE_${plan.toUpperCase()}` as keyof Env] as string | undefined;
  if (!price) throw new HttpError(503, "billing_off", `The ${plan} plan isn't set up for billing yet.`);
  return stripe(env, "/v1/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price, "line_items[0][quantity]": 1,
    "metadata[plan]": plan,
    client_reference_id: orgId, customer_email: email,
    "metadata[org_id]": orgId,
    success_url: `${env.APP_URL}#/workspace/usage?billing=done`,
    cancel_url: `${env.APP_URL}#/workspace/usage?billing=cancelled`,
  });
}

export function portal(env: Env, customer: string) {
  return stripe(env, "/v1/billing_portal/sessions", { customer, return_url: `${env.APP_URL}#/workspace/usage` });
}

/** Developer credits: a one-off payment that tops up an API key. */
export function creditsCheckout(env: Env, keyId: string, pounds: number) {
  return stripe(env, "/v1/checkout/sessions", {
    mode: "payment",
    "line_items[0][price_data][currency]": "gbp",
    "line_items[0][price_data][product_data][name]": "Agent House API credits",
    "line_items[0][price_data][unit_amount]": pounds * 100,
    "line_items[0][quantity]": 1,
    "metadata[key_id]": keyId,
    success_url: `${env.APP_URL}#/developers?credits=done`,
    cancel_url: `${env.APP_URL}#/developers?credits=cancelled`,
  });
}
