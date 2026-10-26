# Agent House operations runbook

What to do when something needs a person. Commands assume the repo root with `CLOUDFLARE_API_TOKEN` set. Never paste a key, token or secret into a ticket, chat or commit.

## Daily glance

- `node scripts/smoke.mjs https://www.ejtech.co.uk`. Every check should say `ok`. "scheduled tasks running" fails if any cron is overdue (no run within twice its interval).
- `GET /api/health` shows each cron's last run (`crons`).
- Operator email: dead jobs and server errors send at most one email an hour each. They send even with `SENDS_LIVE = "false"`.
- `/#/admin` → Dead jobs: retry once the cause is fixed, or mark resolved. Every admin write is on the audit log (`actor = 'operator'`).

## A cron or queue isn't running

Symptoms: smoke says a cron is overdue, or imports, health checks or agent runs sit at "queued".

1. Cloudflare dashboard → Workers & Pages → `agent-house` → Settings → Triggers. All six cron triggers and both queue consumers should be listed.
2. Missing crons on Workers Free (limit 5): Workers & Pages → Plans → Workers Paid.
3. Missing queue consumers with error 10063: open Workers & Pages once so the account gets a workers.dev subdomain.
4. Redeploy: `bash scripts/launch.sh` (it runs typecheck and unit tests first).

## Restore the database (D1 Time Travel)

D1 keeps point-in-time history: 30 days on Workers Paid, 7 on Free.

1. Find the moment before the damage: `npx wrangler d1 time-travel info agent-house --timestamp <ISO time>`. This prints a bookmark.
2. Restore: `npx wrangler d1 time-travel restore agent-house --bookmark <bookmark>`. This replaces the live database, so do it with traffic low and tell customers first.
3. Re-run smoke, then check a known workspace and the audit log.

Rehearse this once on a copy (`wrangler d1 create agent-house-drill`, import an export, restore it) before you need it. R2 (uploads, transcripts, prospect lists) has no history: turn on object versioning for `agent-house-files` in the R2 dashboard if you want it.

## Rotate the signing key

Old answers must keep verifying, so publish the old public key before switching.

1. Take the current public key from `https://www.ejtech.co.uk/.well-known/agent-house-key` (the first key) and add it to `SIGNING_JWKS_PREVIOUS` in `wrangler.toml` as a JSON array, for example `[{"kty":"OKP","crv":"Ed25519","x":"…","kid":"ah-2026-10"}]`. Public fields only.
2. Generate a new key (the command is in the README), set it with `npx wrangler secret put SIGNING_JWK`, and set a new `SIGNING_KID` in `[vars]`.
3. Deploy, then check that `/.well-known/agent-house-key` lists both keys.

## Rotate ADMIN_TOKEN or INGEST_SECRET

`npx wrangler secret put ADMIN_TOKEN` (or `INGEST_SECRET`), using a value of 24+ random bytes. For the ingest secret, update the stream listener's environment and restart it. Sign out of `/#/admin` and sign in with the new token.

## Close or delete a workspace

- An owner can close their own workspace (Usage and plan). Agents stop at once, and retention deletes everything 30 days later.
- Trials that ended without a plan are closed 30 days after the trial ends. The owner is warned a week before.
- An owner can export everything as JSON (`GET /api/ws/export`) at any time before deletion.
- To delete sooner on request (UK GDPR erasure): set `cancelled_at` to 31 days ago for the org, then `POST /api/admin/run/retention`.

## Spend and abuse

- Model spend per business is its credits: plan credits a month plus any top-ups, on the ledger in `credit_entry` (1 credit = 1p of model cost, rates in `config/model-pricing.ts`). A business with none left gets 402 `credits_used` ("Your AI Team has used this month's credits…") and its owner one email a month offering a top-up. An agent at its own budget gets 402 `agent_budget_used`.
- To give a business credits by hand (a goodwill credit, a fix): insert a `credit_entry` with `kind = 'adjustment'`, `from_topup` equal to `credits` (so it rolls over), the current `period` and a unique `ref`. Never edit or delete ledger rows; correct with another entry.
- Outside API callers use their own 35% lane of the Companies House budget. A flood of API calls returns 503 `busy` to them, not to customers' alerts.
- Turn on Turnstile for public forms: set `TURNSTILE_SITE_KEY` in `[vars]` and `TURNSTILE_SECRET` as a secret.

## Inbound mail authentication

STOP replies and lead status changes are refused when `Authentication-Results` shows the sender's domain didn't pass SPF, DKIM or DMARC. If the header is missing, the Worker logs `inbound mail without Authentication-Results` and relies on Email Routing's own SPF/DKIM check. After Email Routing is on, send one test email to the inbox address and check the log. If you see that warning for every message, tell us, so the check can read Email Routing's results another way.
