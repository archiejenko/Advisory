#!/usr/bin/env bash
# Puts Agent House live at www.ejtech.co.uk. Run after bootstrap.sh, once Cloudflare shows ejtech.co.uk as Active:
#   bash scripts/launch.sh
# Deploys the Worker (website, API, MCP, tool gateway), then asks for each third-party key with hidden input and
# uploads them as Worker secrets in one go. Press Enter to skip a key you don't have yet; run this again later to
# add it (already-set secrets you skip are left alone). Keys never touch the repo or your shell history.
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
ask() { # name, what it is
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

read -r -s -p "STRIPE_SECRET (Stripe secret key sk_live_… or sk_test_…): " STRIPE_SECRET; echo
if [ -n "$STRIPE_SECRET" ]; then
  add STRIPE_SECRET "$STRIPE_SECRET"
  say "3/4 Stripe prices and webhook"
  STRIPE_JSON=$(STRIPE_SECRET="$STRIPE_SECRET" node scripts/stripe-setup.mjs)
  node -e 'const fs=require("fs"),[f,j]=process.argv.slice(1),o=JSON.parse(fs.readFileSync(f));Object.assign(o,JSON.parse(j));fs.writeFileSync(f,JSON.stringify(o))' "$TMP" "$STRIPE_JSON"
  echo "  prices and webhook ready"
else
  say "3/4 Stripe skipped (billing stays off until you run this again with a key)"
fi
unset STRIPE_SECRET STRIPE_JSON

say "4/4 Upload secrets, then check the live site"
$WR secret bulk "$TMP"
rm -f "$TMP"
node scripts/smoke.mjs https://www.ejtech.co.uk

say "Live: https://www.ejtech.co.uk  (admin: https://www.ejtech.co.uk/#/admin with ADMIN_TOKEN from .prod-secrets.local)"
echo "Outbound email stays in test mode until SENDS_LIVE is \"true\" in wrangler.toml and you deploy again."
