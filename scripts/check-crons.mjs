// Do the cron schedules on the live Worker match wrangler.toml? A deploy can go live while its crons fail to attach
// (the Free plan allows five per account), and nothing else would notice. Exits 1 on any difference.
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; prints the schedules only, never the token.
import { readFileSync } from "node:fs";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const name = toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
const triggers = toml.match(/^\[triggers\][^[]*?^crons\s*=\s*\[([^\]]*)\]/ms)?.[1] ?? "";
const want = [...triggers.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) { console.error("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."); process.exit(2); }
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}/schedules`, { headers: { Authorization: `Bearer ${token}` } });
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.success) { console.error(`Couldn't read the schedules for ${name}: ${res.status} ${JSON.stringify(body.errors || [])}`); process.exit(2); }
const live = (body.result?.schedules || []).map((s) => s.cron).sort();

const missing = want.filter((c) => !live.includes(c)), extra = live.filter((c) => !want.includes(c));
console.log(`wrangler.toml  ${want.length} crons: ${want.join(", ") || "none"}`);
console.log(`live Worker    ${live.length} crons: ${live.join(", ") || "none"}`);
if (!missing.length && !extra.length) { console.log("The live crons match wrangler.toml."); process.exit(0); }
if (missing.length) console.log(`Not on the Worker: ${missing.join(", ")}`);
if (extra.length) console.log(`On the Worker but not in wrangler.toml: ${extra.join(", ")}`);
process.exit(1);
