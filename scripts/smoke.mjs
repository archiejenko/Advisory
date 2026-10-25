// Checks a live Agent House deployment from the outside. No keys needed.
//   node scripts/smoke.mjs [https://www.ejtech.co.uk]
// With AH_KEY set to an API key it also makes one real resolve call (uses a free call) and verifies the
// response's Ed25519 signature against the published key.
import { webcrypto as crypto } from "node:crypto";

const BASE = (process.argv[2] || "https://www.ejtech.co.uk").replace(/\/$/, "");
const APEX = BASE.replace("://www.", "://");
let failed = 0;
const ok = (name) => console.log(`  ok    ${name}`);
const bad = (name, why) => { failed++; console.log(`  FAIL  ${name}: ${why}`); };

async function check(name, fn) {
  try { const why = await fn(); why ? bad(name, why) : ok(name); } catch (e) { bad(name, e.message); }
}
const get = (p, init) => fetch(BASE + p, { redirect: "manual", ...init });
const rpc = (method) => get("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }) });

const canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";

console.log(`Checking ${BASE}`);
await check("website loads", async () => { const r = await get("/"); if (r.status !== 200) return `status ${r.status}`; if (!/<html/i.test(await r.text())) return "not HTML"; });
if (APEX !== BASE) await check("apex redirects to www", async () => {
  const r = await fetch(APEX + "/pricing?x=1", { redirect: "manual" });
  const to = r.headers.get("location") || "";
  if (r.status !== 301 || !to.startsWith(BASE + "/pricing?x=1")) return `status ${r.status} -> ${to || "nowhere"}`;
});
let health;
await check("API health", async () => { health = await (await get("/api/health")).json(); if (!health.ok) return JSON.stringify(health); });
await check("scheduled tasks running", async () => {
  const crons = Object.entries(health?.crons || {});
  if (!crons.length) return "health doesn't report crons (older deploy?)";
  const overdue = crons.filter(([, v]) => v.overdue).map(([k]) => k);
  if (overdue.length) return "overdue: " + overdue.join(", ");
  const never = crons.filter(([, v]) => !v.last).map(([k]) => k);
  if (never.length === crons.length) console.log("  note  no scheduled task has run yet (a fresh deploy, or crons not attached: check again in 20 minutes)");
});
await check("tool catalogue", async () => { const j = await (await get("/v1/tools")).json(); if (!j.tools?.length) return "no tools listed"; });
let jwk;
await check("signing key published", async () => { const j = await (await get("/.well-known/agent-house-key")).json(); jwk = j.keys?.[0]; if (jwk?.kty !== "OKP" || !jwk.x || jwk.d) return "missing, or not a public Ed25519 key"; });
await check("agent discovery file", async () => { const r = await get("/.well-known/agent-house.json"); if (r.status !== 200) return `status ${r.status}`; await r.json(); });
await check("llms.txt", async () => { const r = await get("/llms.txt"); if (r.status !== 200) return `status ${r.status}`; });
await check("MCP tools/list", async () => { const j = await (await rpc("tools/list")).json(); if (!j.result?.tools?.length) return JSON.stringify(j).slice(0, 200); });
await check("unpaid tool call asks for x402 payment", async () => {
  const r = await get("/v1/tools/read-page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://example.com" }) });
  if (r.status !== 402) return `status ${r.status}`;
  const h = r.headers.get("payment-required");
  if (!h) { const j = await r.json(); if (j.error?.code === "x402_off") { console.log("  note  pay-per-call is off (no wallet set)"); return; } return "no PAYMENT-REQUIRED header"; }
  const req = JSON.parse(Buffer.from(h, "base64").toString());
  const payTo = req.accepts?.[0]?.payTo; if (!/^0x[0-9a-fA-F]{40}$/.test(payTo || "")) return `payTo is ${payTo}`;
});
await check("unknown API path is a JSON 404", async () => { const r = await get("/api/nope"); if (r.status !== 404) return `status ${r.status}`; });

if (process.env.AH_KEY) await check("signed resolve response verifies", async () => {
  const r = await get("/v1/resolve", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AH_KEY}` }, body: JSON.stringify({ input: "Tesco PLC" }) });
  const j = await r.json(); if (!j.signature) return `status ${r.status}: ${JSON.stringify(j).slice(0, 200)}`;
  const { signature, ...rest } = j;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
  const good = await crypto.subtle.verify("Ed25519", key, Buffer.from(signature.replace(/^ed25519:/, ""), "base64url"), new TextEncoder().encode(canonical(rest)));
  if (!good) return "signature does not verify";
});

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
