// Whether a business may run agents right now: trial, cancellation and Stripe subscription state in one place.
// Stripe stays the source of truth for payment; this mirrors what its webhooks have told us.
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, run, audit } from "./db";
import { HttpError } from "./http";

export const TRIAL_DAYS = 14;
export const PAST_DUE_GRACE_DAYS = 7;
export const TRIAL_ENDED = "Your free trial has ended. Choose a plan in Usage and plan to keep your agents working.";
const CANCELLED = "This workspace's plan has been cancelled. Choose a plan in Usage and plan to start your agents again.";
const UNPAID = "Your last payment didn't go through, so your agents are paused. Update your card in Usage and plan to start them again.";

/** Stripe statuses (and our own "cancelled") in which agents must not run. `incomplete` is left out: it is a checkout in progress. */
const BLOCKED = new Set(["unpaid", "canceled", "cancelled", "incomplete_expired", "paused"]);
const PAID_PLANS = ["starter", "growth", "scale"] as const;

export const trialOver = (org: { plan?: string; created_at: string }) => org.plan === "trial" && Date.now() - new Date(org.created_at).getTime() > TRIAL_DAYS * 864e5;

/** Why this business can't run agents, or null when it can. */
export function accessProblem(org: { plan?: string; created_at: string; cancelled_at?: string | null }, sub?: { status?: string; status_since?: string | null } | null, now = Date.now()): string | null {
  if (org.cancelled_at) return CANCELLED;
  if (trialOver(org)) return TRIAL_ENDED;
  const s = sub?.status;
  if (s && BLOCKED.has(s)) return UNPAID;
  if (s === "past_due" && sub?.status_since && now - Date.parse(sub.status_since) > PAST_DUE_GRACE_DAYS * 864e5) return UNPAID;
  return null;
}

/** The 402 to return when `accessProblem` says no. */
export const accessError = (problem: string) => new HttpError(402, problem === TRIAL_ENDED ? "trial_ended" : "plan_inactive", problem);

export async function orgAccess(env: Env, orgId: string) {
  const org = await one<any>(env, "SELECT * FROM org WHERE id = ?", orgId);
  const sub = org ? await one<any>(env, "SELECT status, status_since FROM subscription WHERE org_id = ?", orgId) : null;
  return { org, sub, problem: org ? accessProblem(org, sub) : "Workspace not found." };
}

/** The plan a Stripe price belongs to, from the STRIPE_PRICE_* settings. */
export function planForPrice(env: Env, priceId?: string | null): (typeof PAID_PLANS)[number] | null {
  if (!priceId) return null;
  return PAID_PLANS.find((p) => env[`STRIPE_PRICE_${p.toUpperCase()}`] === priceId) || null;
}

/**
 * Apply one Stripe event. Idempotent: replaying an event leaves the same state, so the webhook can
 * record it as seen only after this succeeds and let Stripe retry anything that throws.
 */
export async function applyStripeEvent(env: Env, ev: any) {
  const o = ev.data?.object || {};
  const now = nowIso();
  if (ev.type === "checkout.session.completed" && o.mode === "subscription" && o.client_reference_id) {
    const orgId = o.client_reference_id;
    await run(env, `INSERT INTO subscription (org_id, stripe_customer, stripe_subscription, status, status_since, updated_at) VALUES (?,?,?,'active',?,?)
      ON CONFLICT(org_id) DO UPDATE SET stripe_customer=excluded.stripe_customer, stripe_subscription=excluded.stripe_subscription,
        status_since = CASE WHEN subscription.status = 'active' AND subscription.stripe_subscription IS excluded.stripe_subscription THEN subscription.status_since ELSE excluded.status_since END,
        status='active', updated_at=excluded.updated_at`,
      orgId, o.customer, o.subscription, now, now);
    const plan = PAID_PLANS.includes(o.metadata?.plan) ? o.metadata.plan : null;
    // A new subscription brings a cancelled workspace back (unless its data has already been purged).
    await run(env, "UPDATE org SET plan = COALESCE(?, plan), cancelled_at = NULL WHERE id = ? AND purged_at IS NULL", plan, orgId);
    await audit(env, orgId, "stripe", "subscription_started", o.subscription, { plan });
    return;
  }
  // Credits only once the money has arrived: card payments are "paid" at completion; slower methods send
  // async_payment_succeeded later.
  if ((ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") && o.mode === "payment" && o.metadata?.key_id && o.payment_status === "paid") {
    await run(env, "INSERT INTO credit_ledger (id, key_id, delta_pence, reason, ref, at) VALUES (?,?,?,?,?,?) ON CONFLICT(reason, ref) DO NOTHING",
      newId("cl"), o.metadata.key_id, o.amount_total, "purchase", o.id, now);
    return;
  }
  if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
    const sub = await one<any>(env, "SELECT org_id, status FROM subscription WHERE stripe_subscription = ?", o.id);
    if (!sub) return; // not ours, or the checkout event hasn't arrived yet: Stripe sends updates again on every change
    const deleted = ev.type.endsWith("deleted") || o.status === "canceled";
    const status = deleted ? "cancelled" : String(o.status || "active");
    // Events can arrive out of order. A deleted subscription never comes back in Stripe, so don't revive it.
    if (sub.status === "cancelled" && !deleted) return;
    await run(env, "UPDATE subscription SET status_since = CASE WHEN status = ?1 THEN COALESCE(status_since, ?2) ELSE ?2 END, status = ?1, updated_at = ?2 WHERE stripe_subscription = ?3",
      status, now, o.id);
    if (deleted) {
      await run(env, "UPDATE org SET cancelled_at = COALESCE(cancelled_at, ?) WHERE id = ?", now, sub.org_id);
      await audit(env, sub.org_id, "stripe", "subscription_cancelled", o.id);
      return;
    }
    // A plan change in the customer portal: follow the price on the subscription.
    const plan = planForPrice(env, o.items?.data?.[0]?.price?.id ?? o.plan?.id);
    if (plan) await run(env, "UPDATE org SET plan = ? WHERE id = ?", plan, sub.org_id);
    if (sub.status !== status) await audit(env, sub.org_id, "stripe", "subscription_status", o.id, { from: sub.status, to: status, plan });
  }
}
