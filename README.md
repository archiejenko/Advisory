# Agent House

A business OS: run every area of a business of up to 100 people from one place, with your people and up to 100 agents working side by side. Native apps instead of connectors, and three doors:

- **The business OS:** 118 apps across 17 areas (leadership, sales, marketing, customer service, operations, stock, finance, payments, HR, payroll, shifts, internal communication, legal, IT, data, facilities and the agent platform), from the business OS matrix in `docs/os-matrix.json`. Each app keeps its own records, has an agent role you can @mention, and a thread on every record. 6 are fully native, 34 partly built, and 78 start as records with an agent while their full screens are built; every app says which. The catalogue is `packages/core/os.ts`. Apps: `/#/workspace/apps`; one app: `/#/workspace/app/:module`; the public map: `/#/os`.
- **Messages:** channels (`#general`, `#sales`, `#finance`, `#operations`, `#people`, and any you add) and a thread on every record, where people and agents talk. @mention an agent and it is asked with the message (and the record, on a thread); its answer is posted back where it was asked. One task list for people and agents: tasks can be given to a person (`assignee_user_id`, `?mine=1`).
- **For businesses:** a team of agents for any small business, led by an orchestrator. Ready-made roles (outreach, inbox, credit control, customer and supplier watch, company checks, lead lists, research, a weekly briefing) or roles you describe, all built from the same twelve building blocks. They work from the business profile, use catalogue tools, record every step, and ask before anything is sent. The lead offer is "check before you trust or pay": customers and suppliers checked on the registers and watched daily.
- **Today:** the workspace home (`/#/workspace`). What needs the owner (drafts to approve in one go, tasks, critical alerts, runs that stopped), what came in, money owed and due, and the week's outcomes. House rules (`/#/workspace/rules`, "How we work") are learned from the owner's edits to drafts, or added directly, and every agent follows them.
- **The Floor:** describe the business (typed or spoken) and Claude designs a swarm of agents for it, or start from a preset (Sales floor, Back office; Markets desk is shown but locked until market data is connected). The swarm runs on a live Floor: a station per agent showing what it's doing, work cards moving through stages, handoffs between agents, KPIs, a desk of things waiting for you, a CRM (companies, contacts, deals, timeline), and a command bar you can talk to from your phone.
- **The org chart:** an orchestrator at the top of every team turns goals into tasks (`assign-task`, `check-tasks`), roles below it (up to two levels) do the work and report back (`finish-task`), and badges (role, skills, autonomy, rhythm) set what each agent is. Shaped by drag and drop on the Floor's Org tab; the rules live in `packages/core/badges.ts` so the UI and the API agree.
- **For developers:** call the tool catalogue over REST or MCP, run a whole agent in one call (`/v1/agents/run`), or publish an API as a tool and earn 80% of every paid call.
- **For agents:** discover the catalogue (`/.well-known/agent-house.json`, `/v1/tools`, `/llms.txt`, `/mcp`) and pay per call with x402. Every answer is Ed25519-signed.

One Cloudflare Worker serves the website, the workspace API, the tool gateway and the MCP server from the same origin. A small always-on process follows the Companies House streaming API for the customer watch.

```
apps/
  api/               Worker (Hono): routes, jobs, crons, inbound email
  web/               Website and workspace (React), built to one dist/index.html
  stream-listener/   Companies House stream follower (Node, always on)
packages/core/       Matching, checks, signing, CSV: shared and unit-tested
migrations/          D1 schema
mocks/               Local stand-ins for Companies House, Gazette, FCA, x402 facilitator, Stripe, Teams, Slack
tests/               Unit tests, API end-to-end flows, browser flows
```

## Run it locally

You need Node 20 or later. No accounts or keys: everything external is mocked.

```bash
npm install
npm --prefix apps/web install
npm run setup          # writes .dev.vars (fresh keys, pointed at the mocks) and applies migrations
npm run web:build

# three terminals
npm run mocks          # http://127.0.0.1:8788
npm run dev            # http://127.0.0.1:8787  (website, API, MCP)
npm run listener       # follows the mock stream
```

Create a workspace and sign in:

1. Open `http://127.0.0.1:8787/#/admin` and paste `ADMIN_TOKEN` from `.dev.vars`.
2. Create a pilot workspace with any email address.
3. Local email goes to an outbox instead of being sent. Read it at `GET /api/admin/outbox` (same token as a Bearer header), open the sign-in link, and you're in.

To make something happen, change a mock company:

```bash
curl -X POST http://127.0.0.1:8788/control/mutate -H 'Content-Type: application/json' \
  -d '{"number":"08812234","change":{"status":"administration"}}'
```

The listener picks it up, the Worker raises a Critical alert, and it appears in the workspace and in any Teams or Slack channel you added (point channels at `http://127.0.0.1:8788/hooks/teams/anything`; captured posts are at `/control/captured`).

Opened straight from disk, `apps/web/dist/index.html` runs as an offline demo with example data.

## The demo workspace

Signed out, `/workspace` is the Brightwork Cleaning demo. It runs entirely in the browser from one store, `apps/web/src/workspace/demo`:
- `seed.ts` holds the business.
- `selectors.ts` works out every figure on screen.
- `store.ts` holds the actions, each of which can be undone.

The screens live in `apps/web/src/workspace`. `/workspace/design` shows every component. `docs/AUDIT.md` records what the overhaul replaced, and `docs/QA.md` the checks it passes.

```bash
npm run test:workspace   # builds the stand-alone demo and runs the workspace QA in Chromium
```

## Tests

```bash
node scripts/os-matrix-check.mjs   # stage 1: every row of the business OS matrix is a module, with matching area, app, depth and phase
npm test               # unit (139): the OS catalogue, records, channels, mentions and replies (os.test.ts), matching, checks, signing, tenant isolation, register budget lanes, scheduling, catalogue, swarms, org chart,
                       # Today and house rules, and the scale fixes (queues, crons, the Floor, inbound mail, clean-up),
                       # plus the hardening and swarm suites run against real SQL (Node's built-in SQLite, every migration applied)
npm run typecheck
npm run test:e2e       # API: 44 flows against wrangler dev and the mocks (records in all 118 modules; an @mention answered in #general)
node tests/e2e/ui.mjs  # browser: 22 flows clicking through the real website in Chromium
node tests/e2e/os-check.mjs  # the demo build in Chromium: landing page, /os, pricing in credits, Usage and agent modes in the workspace
```

Stop any running `npm run dev` or `npm run mocks` before the end-to-end suites; they start their own on ports 8787 and 8788 with fresh state. The browser suite saves screenshots to `ui-shots/`.

## What's where

| Area | Routes | Notes |
|---|---|---|
| Website | `/` | Hash routes. Workspace pages show the live workspace when signed in and the demo when not. The site's story comes from `packages/core/usecases.ts`: 80 SMB use cases scored for owners, developers and agents, the twelve building blocks, and sector packs (`/#/use-cases`). The wordmark is type only, as outlines in `packages/core/brand.ts`, with the "ah" favicon in `apps/web/src/brand/`. |
| Sign-in | `/api/auth/*` | Email magic links. Session is an HttpOnly cookie. |
| Business OS | `/api/ws/os/catalogue`, `/api/ws/os/directory`, `/api/ws/os/m/:module/records`, `/api/ws/os/records/:id` (+ `/messages`), `/api/ws/os/channels` (+ `/:id/messages?after=`) | Every module with this business's record counts; who can be mentioned; module records (one `os_record` table: title, status, owner, due date, amount, party as columns, the kind's other fields as JSON; nine kinds, from items and deals to cases and measures); record threads; team channels. Anyone in the workspace reads and talks; a manager or owner changes records and channels. An @mention of an OS role hires its agent the first time (template `os`, on demand, counts towards the plan's 100), and runs it with `reply_channel` set; `postRunReply` posts the summary or the failure back. OS agents can read any module (`os-records`) and write only their own (`os-save`); anything for a person becomes a task. |
| Today and house rules | `/api/ws/today`, `/api/ws/actions/batch`, `/api/ws/rules*` | The home screen in one call; approve or reject up to 50 drafts at once (each decided on its own); list, add, keep or dismiss house rules. An approval with edits proposes a rule from what changed (one short model call, after the response). The command bar takes `rule: …` too. |
| Workspace | `/api/ws/*` | Overview (now "Agents and activity", `/#/workspace/overview`), agent catalogue and hiring, runs, approvals, leads, tasks, invoices, inbox, alerts, customers, imports, briefs, channels, usage and plan, team, audit, billing. Roles: owner, manager, viewer. Every query is forced through an org filter. |
| Org chart | `/api/ws/swarms/:id/org`, `/api/ws/swarms/:id/goals`, `/api/ws/swarms/:id/tasks`, `/api/ws/agent-tasks/:id` | Read the tree, badges and tasks; apply a list of changes all or nothing; set a goal (wakes the orchestrator); give an agent a task; close or drop one. Owner to-dos stay at `/api/ws/tasks`. |
| Swarms and the Floor | `/api/ws/swarm-presets`, `/api/ws/swarms*`, `/api/ws/work-items/:id` | Plan a blueprint from a description, preview its cost against the plan, spin it up, poll the Floor (`GET /swarms/:id?since=<cursor>`), ask the command bar, brief, pause all, remove. `/#/floor` and `/#/floor/:id`. |
| CRM | `/api/ws/crm/*` | Companies (leads), contacts, deals and an activity timeline written by agents and people. |
| Voice | `/api/ws/voice/transcribe`, `/api/ws/voice/speak` | Speech to text (Whisper) and text to speech (Deepgram Aura) on Workers AI. The browser's own speech is the fallback; dictation keyboards like Wispr Flow type into the command bar with nothing extra. |
| Public forms | `/api/public/*` | Self-serve sign-up, customer check upload, booking slots, API keys, credits, unsubscribe. Per-IP limits; Turnstile when configured. |
| Reports | `/r/:token` | Customer check reports, only after the operator approves them. |
| Tool gateway | `/v1/tools`, `/v1/tools/:slug`, `/v1/agents/run` | First-party and developer tools, priced per call. x402 (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE`) or an API key. Every response is Ed25519-signed; the key is at `/.well-known/agent-house-key`. The original `/v1/resolve`, `/v1/companies/:number`, `/v1/check` and `/v1/watch` still work. |
| Discovery | `/.well-known/agent-house.json`, `/llms.txt` | What an agent needs to find the catalogue, MCP, payment details and the signing key. |
| MCP | `/mcp` | The whole catalogue as tools, billed to the API key in the `Authorization` header. |
| Developers | `/api/dev/*`, `/#/developers/dashboard` | Signed in with an API key: publish tools (reviewed before they go live), calls, credits, earnings. Requests to developer endpoints carry `X-AgentHouse-Timestamp` and `X-AgentHouse-Signature: v1=hmac_sha256(secret, ts + "." + body)`. |
| Operator | `/api/admin/*`, `/#/admin` | Approve customer checks and developer tools, create workspaces, load the company index, run jobs (`/run/reconcile?all=1` re-checks every company at once). Jobs that ran out of retries: `GET /dead-jobs`, then `POST /dead-jobs/:id/retry` or `/resolve`. |
| Ingest | `/api/internal/*` | Stream listener posts events here. |
| Webhooks | `/api/webhooks/stripe` | Signature-checked, replay-protected. |

Background work runs on two queues, plus a dead-letter queue. `AGENT_JOBS` carries agent runs only, one per batch, because a run can take minutes; at most 2 runs per workspace go at once (`RUNS_AT_ONCE`), and a run waiting for a slot is put back with a delay rather than spending a retry. `JOBS` carries everything else (imports, baselines, alert delivery, digests, webhooks, customer checks, re-check batches, scheduled agent starts, monthly prospect lists, workspace purges). Anything that runs out of retries lands in `agent-house-dead`, whose consumer records it in `dead_job` and emails the operator at most once an hour.

Crons (UTC), each doing one indexed read and queuing work in batches:
- every 15 minutes: the stuck-run sweep (runs "running" for 15 minutes are failed with their cost recorded; runs queued for 30 minutes are re-queued once), then due agents, handed to the queue as `agent_start` messages (a start delivered twice makes one run). Agents set for the same hour start at a fixed minute between :00 and :44, from their id, so 08:00 isn't one spike.
- every 30 minutes: the Gazette poll, resuming from the newest notice it saw.
- 06:00 daily: the re-check of a seventh of the watched companies (by the last two digits of the number), so each is re-read once a week.
- 07:00: digests. First working day of the month at 08:00: lead lists. 03:00: retention.

**The Companies House budget** (600 calls per 5 minutes per key) is shared in lanes (`lib/registers.ts`): bulk work (the re-check, imports, first reads) may use 60% of a window, stream alerts 85%, and live checks (a person or an agent waiting) up to 97%. A token is only taken while the lane has room, and a job that meets the limit goes back on the queue with a delay instead of using a retry (up to 48 waits, about four hours). Truth API watches are matched by an indexed `watch_number` table, not by scanning every watch.

**Agent safety.** Text from inbound mail, web pages and search results is treated as information, never instructions. Without a person approving it, an agent's email only goes to an address already tied to the record it names: the lead's own address (for a lead saved before this run), the invoice's customer, or the sender of the inbox message being answered. Anything else waits in Approvals, whatever the agent's autonomy setting.

**Usage and cost.** Before each model step a run checks the business has credits left (after what runs in progress have used) and the agent is within its budget, so at most one step goes past either. Its credits are updated on the run after every step, so a run that fails partway is still charged for what it used, once (the ledger entry is unique by run id). Claude calls retry 429, 529 and transient 5xx responses with backoff (honouring `retry-after`), and use prompt caching for the system prompt, tools and conversation so far.

**Billing state.** Agents stop (hiring, manual runs, schedules and already-queued runs) when a workspace is cancelled, its trial has ended, or Stripe reports the subscription `unpaid`, `canceled`, `incomplete_expired` or `paused`; `past_due` gets 7 days' grace from the first failure. A plan change reported by Stripe updates the workspace's plan by price id (and an upgrade's credits, once, whichever of the route or the webhook records it first). Webhook events are recorded as seen only after they've been processed, so a failure is retried by Stripe instead of dropped.

**Deletion.** Thirty days after cancellation, retention queues a purge of the workspace, deleted in chunks of 2,000 rows (a large workspace takes several queued passes): every workspace table (agents, runs, actions, leads, invoices, inbox, tasks, usage, clients, alerts and the rest), agent transcripts, prospect lists and uploaded files in R2, and people who belong to no other workspace. The audit log keeps the actions with targets and details cleared. Retention also trims what grows: the Floor's log after 30 days (by id), processed register events after 90 days, and message and draft bodies 90 days after they arrived or were decided (the rows stay). Each step runs on its own, so one failing step doesn't stop the rest.

**Inbound mail.** Each enquiries address takes at most 300 messages an hour (`INBOX_PER_HOUR`). Auto-replies, newsletters and list mail are kept as "ignored" and don't wake the inbox agent, and a burst of mail becomes one inbox run: an agent with a run already waiting isn't woken again.

**Swarms.** A swarm is a checked JSON blueprint (`packages/core/swarms.ts`, validated in `lib/swarm.ts`): agents (catalogue templates, or custom roles with standing orders and a whitelisted tool set), stages with rules that place records on the board (`lead`, `invoice`, `message`), handoffs, KPIs and a skin. `lib/engine.ts` turns a description into a blueprint with one Claude call plus one correction round, falling back to the nearest preset; it never fails the owner. Swarm agents count against the plan's agents, and spinning up reuses free agents of the same template. Cards follow their records (`syncSwarm`, after every run and every change you make), and a `hand-off` tool lets one agent pass a card to another: allowed routes only, at most 5 a day per card, never straight back, and the note is passed as information, not instructions. Every step lands in `swarm_event`, which the Floor polls from a cursor: every 4 seconds while an agent is working, every 15 when the team is quiet, never in a hidden tab, and page by page when it fell behind. A poll re-reads the records behind the board at most once a minute (runs, approvals, mail and edits sync straight away), its numbers are cached for a minute, and an import of hundreds of records logs one line instead of one per card. The command bar has fast paths (`@agent do this`, `brief me`, `pause outreach`) and otherwise one routing call to Claude; pausing or resuming always comes back for you to confirm on screen, and nothing can be approved or sent from it.

**Two engines for agents.** LLM agents (outreach, inbox, credit control, research, briefing) run through the tool registry in `lib/agents.ts` and `lib/tools.ts`. The register agents (customer watch, customer check, prospect finder) are the original MSP engines (`agent_config`, `lib/process.ts`, `lib/truth.ts`, briefs); hiring one switches its engine on. New capabilities go into the tool registry.

**Credits.** Plans (in `packages/core/templates.ts`) are per business, not per person or agent: every plan has every app, unlimited people and up to 100 AI Team members. They differ in credits a month: Starter £79 (1,500), Growth £249 (5,000) and Business £599 (12,000), before VAT; the plan keys stay `starter`, `growth` and `scale`. A 14-day trial has 150 credits, no card. 1 credit is 1p of model cost: every run is charged for the tokens it used on the model its mode ran on, each model request priced on its own (`packages/core/credits.ts`), with a 1-credit minimum per run. Every rate lives in `config/model-pricing.ts` and nowhere else: the four modes (Quick on Haiku 5.5, Standard on Sonnet 5.5, Deep on Opus 5.5, Strategy on Fable 5.1), each model's dollar rates and cache multipliers, `USD_TO_GBP`, plan credits, the trial and the top-up. To add another provider's model, add it there with its rates and add its adapter in `lib/llm.ts`.

The ledger (`credit_entry`, `lib/credits.ts`) records every run, AI Team (system) call (the command bar, swarm drafts, learning house rules), monthly grant, lapse, top-up, upgrade and trial grant; balances are sums over it, never a stored counter. Use draws on plan credits first, then top-ups. Plan credits lapse on the 1st (UK time), from the */15 cron and whenever a balance is read; top-up credits (£35 for 1,000, a one-off Stripe Checkout) and the trial's roll over. When credits run out the AI Team pauses and the owner is told once with a top-up link; nothing is charged without their say-so. Each agent has a default mode and an optional monthly budget in credits (only that agent pauses when it's reached). Modes are suggested per job (`packages/core/modes.ts`, no model call) with a likely range from past runs of the same kind of job, priced on any mode, and the Usage page suggests a cheaper mode each month where it would likely do. A run likely to use more than the business's threshold (100 by default) asks first; agents that run on their own confirm once, when their mode or schedule is set. Billing is anchored to the 1st: a plan started mid-month, and an upgrade, get that month's credits prorated like the charge; a downgrade is a Stripe subscription schedule that takes effect on the 1st. When the trial ends, agents stop until a plan is chosen.

`npm run seed:demo` adds a demo business to the local database (Corriemoor Interiors on Growth, three months of runs across all four modes) and prints a sign-in link, so the Usage page has something to show.

## A walkthrough demo on its own

`npm --prefix apps/web run build:demo` builds the website into `apps/web/dist-demo/index.html` with the demo forced on, so it needs no API and can be hosted anywhere static. `apps/web/vercel.json` deploys it on Vercel with `apps/web` as the root directory; on Cloudflare Pages use the same build command and output directory. The real product still deploys as the Worker below.

## Deploy to Cloudflare

### www.ejtech.co.uk (this branch)

`wrangler.toml` is already set for www.ejtech.co.uk: both hosts are attached as custom domains, the apex redirects to www (`CANONICAL_HOST`), and outbound mail goes through Resend (`MAIL_MODE = "http"`). Three commands on your own machine:

```bash
npm ci
bash scripts/bootstrap.sh   # any time: sign in, create D1/KV/R2/queues, fill wrangler.toml, migrate, make keys
bash scripts/launch.sh      # once ejtech.co.uk shows Active in Cloudflare: deploy, enter keys (hidden), Stripe, checks
```

`bootstrap.sh` keeps this deployment's own keys (signing key, channel key, ingest secret, admin token) in `.prod-secrets.local`, which git ignores. Back it up: losing `SIGNING_JWK` means published signatures stop matching a new key. Keys already saved in Cloudflare Secrets Store can stay there: `bootstrap.sh` lists the store, asks which entry is which key, and writes `[[secrets_store_secrets]]` bindings into `wrangler.toml`; the Worker reads them through `lib/storesecrets.ts` (the secrets need the Workers scope, and an API token used for the deploy needs Account Secrets Store **Edit**: Read lists the store but binding a secret to a Worker counts as a write, and the deploy fails with code 10021). `launch.sh` asks for each remaining third-party key with hidden input, runs `scripts/stripe-setup.mjs` (three GBP monthly plan prices, the £35 top-up and the webhook; test mode unless `ALLOW_LIVE=1`) when you give it a Stripe key, uploads everything with `wrangler secret bulk`, then runs `scripts/smoke.mjs`. Re-run it to add a key you skipped. `node scripts/smoke.mjs` checks the live site any time; with `AH_KEY` set it also verifies a signed response.

In the Cloudflare dashboard, once:
- Workers & Pages → Plans: Workers Paid (six crons; Free allows five). Open Workers & Pages once so the account gets a workers.dev subdomain: queue consumers need one even though this Worker serves only its custom domains. R2 → Purchase (free tier) before `bootstrap.sh`.
- Email → Email Routing on `ejtech.co.uk`: add the subdomain `in.ejtech.co.uk`, then a catch-all rule sending to the Worker `agent-house`.
- Turnstile (optional): add a widget for `www.ejtech.co.uk`, put the site key in `TURNSTILE_SITE_KEY` and the secret in `TURNSTILE_SECRET`.

In Resend: add the domain `ejtech.co.uk` and add the DNS records it shows in Cloudflare DNS (DKIM, SPF on `send`, optional DMARC), then create an API key with sending access for `launch.sh`.

Before real customers: `SENDS_LIVE = "true"`, `GAZETTE_BASE` once confirmed, a live Stripe key, and the stream listener running (below).

### Any other domain

```bash
wrangler d1 create agent-house           # put the id in wrangler.toml
wrangler kv namespace create CACHE       # put the id in wrangler.toml
wrangler r2 bucket create agent-house-files
wrangler queues create agent-house-jobs
wrangler queues create agent-house-agents
wrangler queues create agent-house-dead
wrangler d1 migrations apply agent-house --remote
```

Set `APP_URL`, `API_URL`, `X402_PAY_TO`, `MAIL_FROM`, `INBOUND_DOMAIN` and the Stripe price ids (`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`, `STRIPE_PRICE_TOPUP`) in `wrangler.toml`. Then the secrets:

```bash
node -e "crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>console.log(Buffer.from(JSON.stringify(j)).toString('base64url')))"
# paste the output as SIGNING_JWK
for s in SIGNING_JWK CHANNEL_KEY CH_API_KEY FCA_EMAIL FCA_KEY STRIPE_SECRET STRIPE_WEBHOOK_SECRET INGEST_SECRET ADMIN_TOKEN OPERATOR_EMAIL TURNSTILE_SECRET ANTHROPIC_API_KEY SEARCH_API_KEY; do wrangler secret put $s; done
```

Voice uses the Workers AI binding (`[ai] binding = "AI"` in `wrangler.toml`, set `VOICE_SPEAKER` and `VOICE_LANGUAGE` in vars). Workers AI always runs remotely, so local dev and the tests point `VOICE_HTTP_URL` at the mock instead; leave it unset in production. Without either, voice routes answer 503 `voice_off` and the Floor uses the browser's speech. Apply migrations `0004_swarms.sql`, `0005_org.sql`, `0006_scale.sql` (indexes, `watch_number`, `dead_job`, house rules) and `0007_os.sql` (module records, channels, messages, task assignees, run reply channels) before deploying. `wrangler.toml` also turns on Smart Placement (the Worker runs near D1), Workers Logs at 20% sampling, the dead-letter consumer, and a Workers Rate Limiting binding (`WS_LIMITER`, 300 workspace requests a minute per workspace). `npm run deploy` refuses to deploy while `wrangler.toml` still has `REPLACE_WITH_…` placeholders.

`CHANNEL_KEY` is 32 random bytes, base64url. `TURNSTILE_SECRET` is optional; set `TURNSTILE_SITE_KEY` in vars alongside it. `ANTHROPIC_API_KEY` runs the agents, each on its mode's model; models and rates are in `config/model-pricing.ts`.

Pricing for callers is set in `wrangler.toml` too: `USDC_PER_PENNY` converts per-tool prices for x402 (default 0.0125), `X402_PRICES` (JSON) overrides the four original endpoints, and `AGENT_RUN_STEP_PENCE` prices `/v1/agents/run` per model step the caller allows (`max_steps`, default 4, at most 8). Agent runs aren't covered by the 100 free calls; credits are taken before the run and refunded if it fails, and x402 is settled before the run starts. `SEARCH_API_KEY` is a Brave Search API key for the web research tools.

`SENDS_LIVE` is `"false"` in production config, so what agents and alerts send on a business's behalf (outreach, reminders, replies, Teams, Slack, alert emails) is recorded but not sent until you switch it on. Turn it on after a dry run with a pilot. Sign-in links, invites, receipts and operator alerts are transactional and always send.

Limits and safety settings (all optional, in `[vars]`): `RUNS_PER_HOUR` (runs one business may start, default 120), `RUN_DEADLINE_MS` (no new model step after this, default 6 minutes), `SIGNING_JWKS_PREVIOUS` (JSON array of earlier public signing keys, published so old answers still verify). Operations are in `docs/runbook.md`; the architecture review and its fixes are in `docs/architecture-review.md`.

```bash
npm run deploy
```

Run the stream listener somewhere that keeps a process alive (Cloudflare Containers or a small VM) with `STREAM_KEY`, `API_URL` and `INGEST_SECRET`. It resumes from the last stored timepoint after a restart.

Point Cloudflare Email Routing for `INBOUND_DOMAIN` (a catch-all) at the Worker so each business's inbox address (`<alias>@INBOUND_DOMAIN`) reaches the inbox agent, replies from leads are matched, and STOP replies unsubscribe. Point `check@` your domain at it too for emailed brief requests.

## Still to do from the architecture check and the platform plan

Done in this release: everything in phase 0 of the check, the register budget lanes and the spread re-check (phase 1, without a Durable Object: the lanes live on the D1 counter), fair agent scheduling, inbound limits and chunked clean-up (phase 2), the Floor diet without push (phase 3), and phase A of the platform plan (Today, batch approval, outcomes-first briefings, house rules).

Done in the OS overhaul: every facet of the matrix is a working module (records, an agent, threads), channels for people and agents, @mentions that run an agent and answer in place, one task list with assignees, and per-business pricing.

Not yet:
- **Full native screens for the 78 "records + agent" apps,** built in the matrix's phase order: win work and get paid, finance depth (the ledger, bank reconciliation, payables), people and payroll (RTI, pensions), operations, then the rest. Payroll, VAT (MTD) and open banking need their HMRC recognition and a regulated payments partner.
- **Notifications for people:** @mentioning a person records the mention but doesn't notify them yet; messages are polled every 3 seconds on an open channel.
- **Your own mailbox** (Outlook, Gmail) for agents writing from your address. Google's restricted Gmail scopes need its verification and a yearly security assessment.
- **Refresh led by the stream:** a re-check still reads all four Companies House resources for a company. Ask Companies House for a higher limit before the watch grows past a few thousand companies.
- **Hosting for the stream listener,** with an alarm when its position stops moving.
- **Splitting the data** (register data in its own database, workspace data sharded), planned for about 300 workspaces.
- **Push for the Floor** over WebSockets, a separate fast lane for runs a person asked for, and the phone app with notifications (phase C).

## Confirm before going live

These are built to the published documentation but have only been run against the mocks:

- **The Gazette:** the notice search URL and fields in `apps/api/src/lib/registers.ts` (`gazetteNotices`) and the poller in `jobs.ts` (`pollGazette`). `GAZETTE_BASE` is empty in production config, so Gazette checks are off until this is confirmed.
- **FCA register:** the search-by-company-number path and response fields (`fcaStatus`). Failures are reported as "FCA register unavailable", never as "not listed".
- **Companies House streaming:** event shapes in `apps/stream-listener/listener.mjs` against the live stream, and the stream key's connection limits.
- **x402:** the facilitator's `/verify` and `/settle` field names, and the USDC amounts in `pay.ts`.
- **Stripe events:** the webhook needs `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated` and `customer.subscription.deleted`. Turn off plan switching in the customer portal's settings, so plan changes go through Usage and plan (upgrades now with prorated credits, downgrades on the 1st).
- **Spreadsheets:** `.xlsx` is read by a small built-in reader (`packages/core/xlsx.ts`) instead of the `xlsx` package; old `.xls` files are refused with a request to save as `.xlsx` or CSV. Try a few real customer exports before launch.
- **Outbound email:** the Cloudflare send binding shape on your account (commented in `wrangler.toml`), or use `MAIL_MODE = "http"`.
- **Stripe:** run `scripts/stripe-setup.mjs` with a test key, check the products, prices (exclusive of VAT) and a test checkout, then run it with a live key and `ALLOW_LIVE=1`.
- **Claude and web search:** agent runs are tested against a scripted mock of the Messages API and Brave Search. Run each agent once against the real model with a test business before inviting customers, and review its drafts.
- **Developer payouts:** earnings are recorded per settled call (`tool_earning`); paying publishers out (the site says monthly by bank transfer once £20 is earned) is a manual process for now.
- **Swarm planner and command router:** tested against a scripted mock. Try ten real business descriptions against the real model and read the blueprints before opening the Floor to customers.
- **Voice:** Whisper's accuracy on UK accents and noisy phone audio, and Aura's voice choice (`VOICE_SPEAKER`). The routes cap uploads at 4 MB (about a minute) and 240 voice calls an hour per workspace.
- **Cloudflare Containers:** connection lifetime for the long-lived stream, if you host the listener there.
