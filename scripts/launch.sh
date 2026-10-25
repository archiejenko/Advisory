#!/usr/bin/env bash
# Puts Agent House live at www.ejtech.co.uk. Run after bootstrap.sh, once Cloudflare shows ejtech.co.uk as Active:
#   bash scripts/launch.sh
# Deploys the Worker (website, API, MCP, tool gateway), then asks for each third-party key with hidden input and
# uploads them as Worker secrets in one go. Press Enter to skip a key you don't have yet; run this again later to
# add it (already-set secrets you skip are left alone). Keys never touch the repo or your shell history.
# Run without a terminal (by an agent, say), it asks nothing: keys not in Secrets Store are skipped, Stripe too.
# OPERATOR_EMAIL and FCA_EMAIL can be passed in the environment, since they aren't secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
WR="npx wrangler"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ -f .prod-secrets.local ] || { echo "Run bash scripts/bootstrap.sh first."; exit 1; }
[ -d node_modules ] || npm ci --no-audit --no-fund
[ -d apps/web/node_modules ] || npm --prefix apps/web ci --no-audit --no-fund

say "1/4 Deploy"
npm run deploy

say "2/4 Keys (hidden input; Enter skips)"
TMP=$(mktemp); chmod 600 "$TMP"; trap 'rm -f "$TMP"' EXIT
cp .prod-secrets.local "$TMP"
add() { node -e 'const fs=require("fs"),[f,k,v]=process.argv.slice(1),o=JSON.parse(fs.readFileSync(f));o[k]=v;fs.writeFileSync(f,JSON.stringify(o))' "$TMP" "$1" "$2"; }
instore() { grep -q "^binding = \"$1\"" wrangler.toml && grep -q "secrets_store_secrets" wrangler.toml; }
ask() { # name, what it is
  if instore "$1"; then echo "$1: read from Cloudflare Secrets Store"; return; fi
  case "$1" in OPERATOR_EMAIL|FCA_EMAIL) if [ -n "${!1:-}" ]; then add "$1" "${!1}"; echo "$1: from the environment"; return; fi;; esac
  if [ ! -t 0 ]; then echo "$1: skipped (no terminal to ask in)"; return; fi
  local v; read -r -s -p "$1 ($2): " v; echo
  if [ -n "$v" ]; then add "$1" "$v"; echo "  set"; else echo "  skipped"; fi
}
ask OPERATOR_EMAIL      "your email: where failed jobs, reviews and approvals are sent"
ask CH_API_KEY          "Companies House REST API key"
ask FCA_EMAIL           "the email you registered with the FCA register API"
ask FCA_KEY             "FCA register API key"
ask ANTHROPIC_API_KEY   "Anthropic API key, sk-ant-…"
ask SEARCH_API_KEY      "Brave Search API key"
ask MAIL_HTTP_KEY       "Resend API key, re_…"
ask TURNSTILE_SECRET    "Turnstile secret key (optional)"

STRIPE_SECRET=
if [ -t 0 ]; then read -r -s -p "STRIPE_SECRET (Stripe secret key sk_live_… or sk_test_…): " STRIPE_SECRET; echo; fi
if [ -n "$STRIPE_SECRET" ]; then
  instore STRIPE_SECRET || add STRIPE_SECRET "$STRIPE_SECRET"
  say "3/4 Stripe prices and webhook"
  STRIPE_JSON=$(STRIPE_SECRET="$STRIPE_SECRET" node scripts/stripe-setup.mjs)
  node -e 'const fs=require("fs"),[f,j]=process.argv.slice(1),o=JSON.parse(fs.readFileSync(f));Object.assign(o,JSON.parse(j));fs.writeFileSync(f,JSON.stringify(o))' "$TMP" "$STRIPE_JSON"
  echo "  prices and webhook ready"
else
  say "3/4 Stripe skipped (billing stays off until you run this again with a key)"
fi
unset STRIPE_SECRET STRIPE_JSON

say "4/4 Upload secrets, then check the live site"
# The signing and channel keys are made once. If the Worker already has them, keep those: a new channel key would
# make stored channel settings unreadable, and a new signing key changes what verifiers trust. Same for the admin
# token and ingest secret unless new values were passed in the environment.
SET=$($WR secret list --format json 2>/dev/null </dev/null || echo "[]")
node -e '
  const fs=require("fs"),[f,set]=process.argv.slice(1),o=JSON.parse(fs.readFileSync(f));
  let have=[]; try { have=JSON.parse(set.slice(set.indexOf("["))).map(s=>s.name); } catch {}
  const keep=["SIGNING_JWK","SIGNING_KID","CHANNEL_KEY"].concat(["ADMIN_TOKEN","INGEST_SECRET"].filter(k=>!process.env[k]));
  if (have.includes("SIGNING_JWK")) for (const k of keep) if (have.includes(k)) { delete o[k]; console.log(k+": already set on the Worker, kept"); }
  for (const k of ["ADMIN_TOKEN","INGEST_SECRET"]) if (process.env[k]) o[k]=process.env[k];
  fs.writeFileSync(f,JSON.stringify(o));' "$TMP" "$SET"
$WR secret bulk "$TMP"
rm -f "$TMP"
node scripts/smoke.mjs https://www.ejtech.co.uk

say "Live: https://www.ejtech.co.uk  (admin: https://www.ejtech.co.uk/#/admin with ADMIN_TOKEN from .prod-secrets.local)"
echo "Outbound email stays in test mode until SENDS_LIVE is \"true\" in wrangler.toml and you deploy again."
