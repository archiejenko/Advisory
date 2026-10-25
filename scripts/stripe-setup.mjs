// Sets up Stripe billing for www.ejtech.co.uk: the three monthly plans and the webhook. Safe to re-run.
//   STRIPE_SECRET=sk_... node scripts/stripe-setup.mjs
// Prices are found by lookup key, so re-running reuses them (a changed amount gets a new price that takes over
// the lookup key). The webhook is recreated each run because Stripe only reveals its signing secret at creation.
// Prints {"STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_SCALE", "STRIPE_WEBHOOK_SECRET"} as JSON
// on stdout for launch.sh to upload as Worker secrets; progress goes to stderr.
const KEY = process.env.STRIPE_SECRET;
const SITE = (process.env.SITE || "https://www.ejtech.co.uk").replace(/\/$/, "");
if (!KEY) { console.error("Set STRIPE_SECRET first."); process.exit(1); }

const PLANS = [
  { plan: "starter", name: "Solo", pence: 3900 },
  { plan: "growth", name: "Team", pence: 12900 },
  { plan: "scale", name: "Business", pence: 29900 },
];
const EVENTS = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted"];
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
log(KEY.startsWith("sk_live_") ? "Stripe: live mode" : "Stripe: TEST mode (use a live key before taking real payments)");
const existing = (await stripe("GET", "/prices", { "lookup_keys[]": PLANS.map((p) => `ah_${p.plan}_monthly`), active: "true", limit: 10 })).data;
let product = existing[0]?.product;
if (!product) {
  product = (await stripe("POST", "/products", { name: "Agent House", description: "AI agents for small businesses" })).id;
  log(`created product ${product}`);
}
for (const p of PLANS) {
  const lookup = `ah_${p.plan}_monthly`;
  let price = existing.find((x) => x.lookup_key === lookup);
  if (price && (price.unit_amount !== p.pence || price.currency !== "gbp" || price.recurring?.interval !== "month")) price = null;
  if (!price) {
    price = await stripe("POST", "/prices", {
      product, currency: "gbp", unit_amount: p.pence, "recurring[interval]": "month",
      lookup_key: lookup, transfer_lookup_key: "true", nickname: `${p.name} monthly`,
    });
    log(`created ${p.name} £${p.pence / 100}/month: ${price.id}`);
  } else log(`reusing ${p.name}: ${price.id}`);
  out[`STRIPE_PRICE_${p.plan.toUpperCase()}`] = price.id;
}

for (const h of (await stripe("GET", "/webhook_endpoints", { limit: 100 })).data) {
  if (h.url === HOOK) { await stripe("DELETE", `/webhook_endpoints/${h.id}`); log(`removed old webhook ${h.id}`); }
}
const hook = await stripe("POST", "/webhook_endpoints", { url: HOOK, "enabled_events[]": EVENTS, description: "Agent House" });
log(`webhook ${hook.id} -> ${HOOK}`);
out.STRIPE_WEBHOOK_SECRET = hook.secret;

process.stdout.write(JSON.stringify(out) + "\n");
