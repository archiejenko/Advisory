// Local development reads Secrets Store bindings from wrangler's local store, not from .dev.vars: a binding in
// wrangler.toml shadows a .dev.vars value of the same name. This copies each bound key's .dev.vars value into the
// local store under the entry name wrangler.toml uses, so local runs see the same values the mocks expect.
//   node scripts/local-store.mjs [persist-dir]      (no dir: wrangler's default local state)
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The [[secrets_store_secrets]] entries in wrangler.toml: binding, store id and entry name. */
export function storeBindings(toml = readFileSync("wrangler.toml", "utf8")) {
  return [...toml.matchAll(/\[\[secrets_store_secrets\]\]\s*\n([\s\S]*?)(?=\n\[|\n#|$)/g)].map((m) => {
    const get = (k) => (m[1].match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m")) || [])[1];
    return { binding: get("binding"), store: get("store_id"), name: get("secret_name") };
  }).filter((b) => b.binding && b.store && b.name);
}

export function seedLocalStore(persist, vars) {
  const seeded = [];
  for (const b of storeBindings()) {
    // A key the local setup doesn't use (Resend in outbox mode, say) still gets a placeholder, so reads don't fail.
    const value = vars[b.binding] ?? "unset-locally";
    const args = ["wrangler", "secrets-store", "secret", "create", b.store, "--name", b.name, "--value", String(value), "--scopes", "workers", ...(persist ? ["--persist-to", persist] : [])];
    const r = spawnSync("npx", args, { stdio: "ignore" });
    if (r.status !== 0) throw new Error(`Couldn't seed the local Secrets Store entry for ${b.binding}`);
    seeded.push(b.binding);
  }
  return seeded;
}

export const devVars = (file = ".dev.vars") => existsSync(file)
  ? Object.fromEntries(readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), JSON.parse(l.slice(i + 1))]; }))
  : {};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seeded = seedLocalStore(process.argv[2], devVars());
  console.log(seeded.length ? `Local Secrets Store: ${seeded.join(", ")}` : "No Secrets Store bindings to seed.");
}
