// Stripe over its REST API (no SDK, so it runs in a Worker). Stripe stays the source of truth for payment.
import { HttpError } from "./http";
import { fetchT } from "./fetch";
import type { Env } from "./db";
import { resetDate } from "./credits";

function form(obj: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) p.append(k, String(v));
  return p;
}

export async function stripe(env: Env, path: string, params: Record<string, string | number | undefined>, method: "POST" | "GET" = "POST") {
  const url = (env.STRIPE_BASE || "https://api.stripe.com").replace(/\/$/, "") + path + (method === "GET" && Object.keys(params).length ? "?" + form(params) : "");
  const res = await fetchT(url, {
    method,
    headers: { Authorization: "Bearer " + env.STRIPE_SECRET, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : form(params),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Stripe returned ${res.status}`);
  return j;
}

export type PaidPlan = "starter" | "growth" | "scale";
export function planPrice(env: Env, plan: PaidPlan) {
  const price = env[`STRIPE_PRICE_${plan.toUpperCase()}` as keyof Env] as string | undefined;
  if (!price) throw new HttpError(503, "billing_off", `The ${plan} plan isn't set up for billing yet.`);
  return price;
}

/** Seconds since the epoch at midnight UK time on the 1st of next month, when plan credits reset. */
export function nextResetUnix(now = new Date()) {
  const first = new Date(resetDate(now) + "T00:00:00Z");
  // UK midnight is 23:00 UTC the day before in summer time; the 1st of a month is never in a clock-change gap.
  const bst = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "short" }).format(first).includes("BST");
  return Math.floor(first.getTime() / 1000) - (bst ? 3600 : 0);
}

/**
 * Plans: Starter, Growth or Business, one Stripe price each. Billing is anchored to the 1st, when plan credits reset,
 * so the first invoice is prorated to the rest of the month (and so are that month's credits). No overage charges.
 */
export function planCheckout(env: Env, orgId: string, email: string, plan: PaidPlan = "growth") {
  const price = planPrice(env, plan);
  return stripe(env, "/v1/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price, "line_items[0][quantity]": 1,
    "subscription_data[billing_cycle_anchor]": nextResetUnix(),
    "subscription_data[proration_behavior]": "create_prorations",
    "subscription_data[metadata][org_id]": orgId,
    "metadata[plan]": plan,
    client_reference_id: orgId, customer_email: email,
    "metadata[org_id]": orgId,
    success_url: `${env.APP_URL}#/workspace/usage?billing=done`,
    cancel_url: `${env.APP_URL}#/workspace/usage?billing=cancelled`,
  });
}

/** Call off a downgrade waiting for the 1st: release the subscription from its schedule, keeping today's price. */
export async function releaseSchedule(env: Env, subscription: string) {
  const sub = await stripe(env, `/v1/subscriptions/${subscription}`, {}, "GET");
  if (sub.schedule) await stripe(env, `/v1/subscription_schedules/${typeof sub.schedule === "string" ? sub.schedule : sub.schedule.id}/release`, {});
  return sub;
}

/** An upgrade: the new price from now, the difference for the rest of the month invoiced straight away. */
export async function upgradeSubscription(env: Env, subscription: string, plan: PaidPlan) {
  // A downgrade waiting for the 1st would otherwise still switch the price then.
  const sub = await releaseSchedule(env, subscription);
  const item = sub.items?.data?.[0]?.id;
  if (!item) throw new HttpError(502, "stripe_error", "Couldn't read the subscription from Stripe.");
  return stripe(env, `/v1/subscriptions/${subscription}`, {
    "items[0][id]": item, "items[0][price]": planPrice(env, plan),
    proration_behavior: "always_invoice", "metadata[plan]": plan,
  });
}

/** A downgrade: keep the current price until the period ends on the 1st, then switch. Nothing is refunded. */
export async function scheduleDowngrade(env: Env, subscription: string, plan: PaidPlan) {
  const sub = await stripe(env, `/v1/subscriptions/${subscription}`, {}, "GET");
  const current = sub.items?.data?.[0]?.price?.id;
  const schedule = sub.schedule || (await stripe(env, "/v1/subscription_schedules", { from_subscription: subscription })).id;
  return stripe(env, `/v1/subscription_schedules/${schedule}`, {
    end_behavior: "release", proration_behavior: "none",
    "phases[0][items][0][price]": current, "phases[0][items][0][quantity]": 1,
    "phases[0][start_date]": sub.current_period_start ?? sub.items?.data?.[0]?.current_period_start, "phases[0][end_date]": sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end,
    "phases[1][items][0][price]": planPrice(env, plan), "phases[1][items][0][quantity]": 1,
    "phases[1][metadata][plan]": plan,
  });
}

/** A one-off credit top-up. Credits are added when Stripe says the payment arrived, never before. */
export function topupCheckout(env: Env, orgId: string, email: string, customer?: string | null) {
  const price = env.STRIPE_PRICE_TOPUP as string | undefined;
  if (!price) throw new HttpError(503, "billing_off", "Top-ups aren't set up for billing yet.");
  return stripe(env, "/v1/checkout/sessions", {
    mode: "payment",
    "line_items[0][price]": price, "line_items[0][quantity]": 1,
    "metadata[kind]": "topup", "metadata[org_id]": orgId, client_reference_id: orgId,
    ...(customer ? { customer } : { customer_email: email }),
    success_url: `${env.APP_URL}#/workspace/usage?topup=done`,
    cancel_url: `${env.APP_URL}#/workspace/usage?topup=cancelled`,
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
