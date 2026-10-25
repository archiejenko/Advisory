#!/usr/bin/env bash
# One-time Cloudflare setup for www.ejtech.co.uk. Run from the repo root: bash scripts/bootstrap.sh
# Creates the database, cache, file storage and queues, writes their ids into wrangler.toml, applies every
# migration, and generates this deployment's own keys into .prod-secrets.local (never committed).
# Safe to re-run: anything that already exists is reused, and the keys are only generated once.
# Doesn't need the ejtech.co.uk zone to be active yet, so you can run it while the nameservers propagate.
# Runs without questions when these are set (none of them are keys):
#   X402_WALLET=0x... or none                the public wallet address for x402 payments; none = pay-per-call off for now
#   STORE_ID=<32 hex>                         which Secrets Store, if the account has more than one
#   SECRETS_MAP="ANTHROPIC_API_KEY=name,..."  Worker key name = Secrets Store entry name; "none" for no store
# ADMIN_TOKEN and INGEST_SECRET in the environment are used instead of generated ones, so a cloud session (whose
# disk doesn't last) uses values you already keep in your password manager.
set -euo pipefail
cd "$(dirname "$0")/.."

WR="npx wrangler"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
# Pull the first JSON value out of wrangler's output (it sometimes prints a banner first).
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=s.search(/[\[{]/);process.stdout.write(i<0?"null":s.slice(i))})'; }

[ -d node_modules ] || { say "Installing dependencies"; npm ci --no-audit --no-fund; }

say "1/6 Cloudflare sign-in"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then echo "Using CLOUDFLARE_API_TOKEN from the environment."
elif ! $WR whoami 2>&1 | grep -qi "associated with the email"; then $WR login; fi
$WR whoami 2>&1 | grep -i "email" || true

say "2/6 Database (D1)"
find_db() { $WR d1 list --json 2>/dev/null </dev/null | json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=(JSON.parse(s)||[]).find(x=>x.name==="agent-house");process.stdout.write(d?d.uuid:"")})'; }
DB_ID=$(find_db)
if [ -z "$DB_ID" ]; then $WR d1 create agent-house </dev/null; DB_ID=$(find_db); fi
[ -n "$DB_ID" ] || { echo "Couldn't create or find the agent-house database."; exit 1; }
echo "agent-house: $DB_ID"

say "3/6 Cache (KV)"
find_kv() { $WR kv namespace list 2>/dev/null </dev/null | json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=(JSON.parse(s)||[]).find(x=>/agent-house-cache$/i.test(x.title));process.stdout.write(k?k.id:"")})'; }
KV_ID=$(find_kv)
if [ -z "$KV_ID" ]; then $WR kv namespace create agent-house-cache </dev/null; KV_ID=$(find_kv); fi
[ -n "$KV_ID" ] || { echo "Couldn't create or find the cache namespace."; exit 1; }
echo "agent-house-cache: $KV_ID"

say "4/6 File storage (R2) and queues"
tolerate() { # run a create command; carry on if the thing already exists, stop on any other error
  local out; if out=$("$@" </dev/null 2>&1); then echo "created: ${*: -1}"; return; fi
  if grep -qiE "already exists|already taken|already own" <<<"$out"; then echo "exists:  ${*: -1}"; return; fi
  echo "$out"
  if grep -qi "r2" <<<"$*" && grep -qiE "enable|10042|purchase" <<<"$out"; then echo "Turn on R2 in the Cloudflare dashboard (R2 Object Storage, then Purchase), then run this again."; fi
  if grep -qi "queues" <<<"$*"; then echo "Queues need the Workers Paid plan: Workers & Pages, then Plans."; fi
  exit 1
}
tolerate $WR r2 bucket create agent-house-files
for q in agent-house-jobs agent-house-agents agent-house-dead; do tolerate $WR queues create "$q"; done

say "5/6 Config and receiving wallet"
node - "$DB_ID" "$KV_ID" <<'EOF'
const fs = require("fs"); const [db, kv] = process.argv.slice(2);
let t = fs.readFileSync("wrangler.toml", "utf8");
t = t.replace(/database_id = "[^"]*"/, `database_id = "${db}"`).replace(/(\[\[kv_namespaces\]\][^\[]*?\nid = )"[^"]*"/, `$1"${kv}"`);
fs.writeFileSync("wrangler.toml", t);
EOF
TTY=; [ -t 0 ] && TTY=1
need() { echo "$1"; exit 1; }
# The wallet that receives x402 pay-per-call payments. X402_WALLET=none deploys with pay-per-call off (API keys
# still work); run this again with a real address later to switch it on.
setwallet() { node -e 'const fs=require("fs");fs.writeFileSync("wrangler.toml",fs.readFileSync("wrangler.toml","utf8").replace(/X402_PAY_TO = "[^"]*"/,`X402_PAY_TO = "${process.argv[1]}"`))' "$1"; }
W=${X402_WALLET:-}
if [ "$W" = none ]; then
  grep -q REPLACE_WITH_RECEIVING_WALLET wrangler.toml && setwallet ""
  echo "No wallet: pay-per-call stays off."
elif [ -n "$W" ] || grep -q REPLACE_WITH_RECEIVING_WALLET wrangler.toml; then
  while ! [[ "$W" =~ ^0x[0-9a-fA-F]{40}$ ]]; do
    [ -n "$W" ] && echo "That isn't a 0x address with 40 hex characters."
    [ -n "$TTY" ] || need "Set X402_WALLET to the receiving wallet's public 0x address (or none) and run this again."
    read -r -p "Base wallet address that receives x402 payments (0x…, the public address only; none to skip): " W
    [ "$W" = none ] && break
  done
  if [ "$W" = none ]; then setwallet ""; else setwallet "$W"; echo "x402 payments go to $W"; fi
fi
node scripts/predeploy-check.mjs

say "Keys you've already saved in Cloudflare Secrets Store"
# The Worker reads these from the store directly (apps/api/src/lib/storesecrets.ts), so launch.sh won't ask for them.
# Each table row is Name | ID | AccountID, so the store id is the first 32-hex value on its row.
STORES=$($WR secrets-store store list --remote </dev/null 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=[...new Set(s.split("\n").map(l=>(l.match(/[0-9a-f]{32}/)||[])[0]).filter(Boolean))];process.stdout.write(ids.join("\n"))})' || true)
if [ -z "$STORES" ]; then
  echo "No Secrets Store found; launch.sh will ask for every key."
else
  if [ -n "${STORE_ID:-}" ]; then :
  elif [ "$(wc -l <<<"$STORES")" -gt 1 ]; then
    $WR secrets-store store list --remote </dev/null 2>/dev/null || true
    [ -n "$TTY" ] || need "This account has more than one Secrets Store. Set STORE_ID to the one holding the keys and run this again."
    read -r -p "Which store id holds your keys? " STORE_ID
  else STORE_ID=$STORES; fi
  LISTING=$($WR secrets-store secret list "$STORE_ID" --remote --per-page 100 </dev/null 2>&1 || true)
  echo "$LISTING"
  if [ -z "${SECRETS_MAP+x}" ]; then
    [ -n "$TTY" ] || need "Set SECRETS_MAP (e.g. \"ANTHROPIC_API_KEY=anthropic,SEARCH_API_KEY=brave\", or \"none\") from the names above and run this again."
    echo "For each key below, type the name it has in the list above, or press Enter if it isn't there."
  fi
  BLOCK="# BEGIN secrets-store (written by scripts/bootstrap.sh; re-run it to change)"
  for k in ANTHROPIC_API_KEY SEARCH_API_KEY MAIL_HTTP_KEY CH_API_KEY FCA_EMAIL FCA_KEY TURNSTILE_SECRET OPERATOR_EMAIL STRIPE_SECRET; do
    if [ -n "${SECRETS_MAP+x}" ]; then NAME=$(tr ',' '\n' <<<"$SECRETS_MAP" | sed -n "s/^ *$k *= *//p" | head -1 | sed 's/ *$//')
    else read -r -p "  $k: " NAME; fi
    [ -z "$NAME" ] && continue
    grep -qF -- "$NAME" <<<"$LISTING" || echo "  (not in the list above; using it anyway, check the spelling)"
    BLOCK+=$'\n'"[[secrets_store_secrets]]"$'\n'"binding = \"$k\""$'\n'"store_id = \"$STORE_ID\""$'\n'"secret_name = \"$NAME\""
  done
  BLOCK+=$'\n'"# END secrets-store"
  node -e '
    const fs = require("fs"); let t = fs.readFileSync("wrangler.toml", "utf8");
    t = t.replace(/\n*# BEGIN secrets-store[\s\S]*?# END secrets-store\n?/, "\n");
    fs.writeFileSync("wrangler.toml", t.replace(/\n*$/, "\n\n") + process.argv[1] + "\n");' "$BLOCK"
  echo "Wrote the Secrets Store bindings into wrangler.toml."
fi

say "6/6 Migrations and this deployment's own keys"
$WR d1 migrations apply agent-house --remote
if [ ! -f .prod-secrets.local ]; then
  umask 077
  node --input-type=module -e '
    import { webcrypto as c } from "node:crypto"; import { writeFileSync } from "node:fs";
    const b = (x) => Buffer.from(x).toString("base64url"); const r = (n) => b(c.getRandomValues(new Uint8Array(n)));
    const kp = await c.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const jwk = await c.subtle.exportKey("jwk", kp.privateKey);
    writeFileSync(".prod-secrets.local", JSON.stringify({ SIGNING_JWK: b(JSON.stringify(jwk)), SIGNING_KID: "ejtech-" + new Date().toISOString().slice(0, 10), CHANNEL_KEY: r(32), INGEST_SECRET: process.env.INGEST_SECRET || r(24), ADMIN_TOKEN: process.env.ADMIN_TOKEN || r(24) }, null, 2) + "\n");'
  echo "Generated .prod-secrets.local (signing key, channel key, ingest secret, admin token)."
  echo "Copy ADMIN_TOKEN from it into your password manager: it opens www.ejtech.co.uk/#/admin."
else
  echo ".prod-secrets.local already exists; keeping the same keys."
fi

say "Done. When Cloudflare shows ejtech.co.uk as Active, run: bash scripts/launch.sh"
