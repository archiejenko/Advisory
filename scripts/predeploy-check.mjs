// Refuses to deploy while wrangler.toml still holds placeholder values (database id, KV id, x402 wallet).
import { readFileSync } from "node:fs";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const left = [...new Set(toml.match(/REPLACE_WITH_[A-Z_]+/g) || [])];
if (left.length) {
  console.error(`wrangler.toml still has placeholders: ${left.join(", ")}. Fill them in before deploying.`);
  process.exit(1);
}
console.log("wrangler.toml: no placeholders left.");
