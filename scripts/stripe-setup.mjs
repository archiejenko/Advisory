// Sets up Stripe billing for www.ejtech.co.uk: the three monthly plans, the credit top-up and the webhook. Safe to re-run.
//   STRIPE_SECRET=sk_test_... node scripts/stripe-setup.mjs
// Test mode only unless ALLOW_LIVE=1 is set as well: a live key is refused, so nothing real is created by mistake.
// One product per plan and one for the top-up, each with one price found by lookup key, so re-running reuses them
// (a changed amount gets a new price that takes over the lookup key). Older prices are left alone, so anyone still
// subscribed to one keeps it. The webhook is recreated each run because Stripe only reveals its signing secret at
// creation. Prints {"STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_SCALE", "STRIPE_PRICE_TOPUP",
// "STRIPE_WEBHOOK_SECRET"} as JSON on stdout for launch.sh to upload as Worker secrets; progress goes to stderr.
const KEY = process.env.STRIPE_SECRET;
const SITE = (process.env.SITE || "https://www.ejtech.co.uk").replace(/\/$/, "");
if (!KEY) { console.error("Set STRIPE_SECRET first."); process.exit(1); }
if (KEY.startsWith("sk_live_") && process.env.ALLOW_LIVE !== "1") { console.error("That's a live key. This sets up test mode; set ALLOW_LIVE=1 as well only when you mean to create live prices."); process.exit(1); }

// Prices before VAT (tax_behavior exclusive). Kept in step with PLANS in packages/core/templates.ts and TOPUP in
// config/model-pricing.ts by tests/unit/stripe-setup.test.ts.
const PLANS = [
  { plan: "starter", name: "Starter", pence: 7900, credits: 1500 },
  { plan: "growth", name: "Growth", pence: 24900, credits: 5000 },
  { plan: "scale", name: "Business", pence: 59900, credits: 12000 },
];
const TOPUP = { name: "1,000 AI Team credits", pence: 3500, credits: 1000, lookup: "ah_topup_1000" };
const EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "customer.subscription.updated", "customer.subscription.deleted"];
const HOOK = `${SITE}/api/webhooks/stripe`;
const log = (...a) => console.error(...a);

async function stripe(method, path, params) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) for (const x of [].concat(v)) form.append(k, String(x));
  const q = method === "GET" && params ? "?" + form : "";
  const res = await fetch(`https://api.stripe.com/v1${path}${q}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" || method === "DELETE" ? undefined : form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${json.error?.message || res.status}`);
  return json;
}

const out = {};
log(KEY.startsWith("sk_live_") ? "Stripe: LIVE mode" : "Stripe: test mode");

/**
 * The active price for this lookup key, reused when its amount is right. Otherwise a new price takes the key over,
 * on the same product (or a new one the first time). Found by lookup key rather than product search, which can lag.
 */
async function price(lookup, product, pence, params) {
  const old = (await stripe("GET", "/prices", { "lookup_keys[]": lookup, active: "true", limit: 1 })).data[0];
  if (old && old.unit_amount === pence && old.currency === "gbp") { log(`reusing ${lookup}: ${old.id}`); return old.id; }
  const productId = old?.product || (await stripe("POST", "/products", { name: product.name, description: product.description, tax_code: "txcd_10103001" })).id;
  const p = await stripe("POST", "/prices", { product: productId, currency: "gbp", unit_amount: pence, tax_behavior: "exclusive", lookup_key: lookup, transfer_lookup_key: "true", ...params });
  log(`created ${lookup} £${pence / 100}: ${p.id}`);
  return p.id;
}

for (const p of PLANS) {
  const prod = { name: `Agent House ${p.name}`, description: `Every app, unlimited people, up to 100 AI Team members and ${p.credits.toLocaleString("en-GB")} credits a month.` };
  out[`STRIPE_PRICE_${p.plan.toUpperCase()}`] = await price(`ah_${p.plan}_monthly_v2`, prod, p.pence, { "recurring[interval]": "month", nickname: `${p.name} monthly` });
}
out.STRIPE_PRICE_TOPUP = await price(TOPUP.lookup, { name: TOPUP.name, description: "A one-off top-up of 1,000 credits for your AI Team. Top-up credits roll over." }, TOPUP.pence, { nickname: TOPUP.name });

for (const h of (await stripe("GET", "/webhook_endpoints", { limit: 100 })).data) {
  if (h.url === HOOK) { await stripe("DELETE", `/webhook_endpoints/${h.id}`); log(`removed old webhook ${h.id}`); }
}
const hook = await stripe("POST", "/webhook_endpoints", { url: HOOK, "enabled_events[]": EVENTS, description: "Agent House" });
log(`webhook ${hook.id} -> ${HOOK}`);
out.STRIPE_WEBHOOK_SECRET = hook.secret;

process.stdout.write(JSON.stringify(out) + "\n");
