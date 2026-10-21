# Agent House

One place for everything agentic, with three doors:

- **For businesses:** hire agents that run parts of a small business (outreach, inbox, credit control, customer and supplier watch, company checks, lead lists, research, a weekly briefing). They work from the business profile, use catalogue tools, record every step, and ask before anything is sent.
- **The Floor:** describe the business (typed or spoken) and Claude designs a swarm of agents for it, or start from a preset (Sales floor, Back office; Markets desk is shown but locked until market data is connected). The swarm runs on a live Floor: a station per agent showing what it's doing, work cards moving through stages, handoffs between agents, KPIs, a desk of things waiting for you, a CRM (companies, contacts, deals, timeline), and a command bar you can talk to from your phone.
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

## Tests

```bash
npm test               # unit (78): matching, checks, signing, tenant isolation, rate limits, scheduling, catalogue, swarms,
                       # plus the hardening and swarm suites run against real SQL (Node's built-in SQLite, every migration applied)
npm run typecheck
npm run test:e2e       # API: 41 flows against wrangler dev and the mocks
node tests/e2e/ui.mjs  # browser: 20 flows clicking through the real website in Chromium
```

Stop any running `npm run dev` or `npm run mocks` before the end-to-end suites; they start their own on ports 8787 and 8788 with fresh state. The browser suite saves screenshots to `ui-shots/`.

## What's where

| Area | Routes | Notes |
|---|---|---|
| Website | `/` | Hash routes. Workspace pages show the live workspace when signed in and the demo when not. |
| Sign-in | `/api/auth/*` | Email magic links. Session is an HttpOnly cookie. |
| Workspace | `/api/ws/*` | Overview, agent catalogue and hiring, runs, approvals, leads, tasks, invoices, inbox, alerts, customers, imports, briefs, channels, usage and plan, team, audit, billing. Roles: owner, manager, viewer. Every query is forced through an org filter. |
| Swarms and the Floor | `/api/ws/swarm-presets`, `/api/ws/swarms*`, `/api/ws/work-items/:id` | Plan a blueprint from a description, preview its cost against the plan, spin it up, poll the Floor (`GET /swarms/:id?since=<cursor>`), ask the command bar, brief, pause all, remove. `/#/floor` and `/#/floor/:id`. |
| CRM | `/api/ws/crm/*` | Companies (leads), contacts, deals and an activity timeline written by agents and people. |
| Voice | `/api/ws/voice/transcribe`, `/api/ws/voice/speak` | Speech to text (Whisper) and text to speech (Deepgram Aura) on Workers AI. The browser's own speech is the fallback; dictation keyboards like Wispr Flow type into the command bar with nothing extra. |
| Public forms | `/api/public/*` | Self-serve sign-up, customer check upload, booking slots, API keys, credits, unsubscribe. Per-IP limits; Turnstile when configured. |
| Reports | `/r/:token` | Customer check reports, only after the operator approves them. |
| Tool gateway | `/v1/tools`, `/v1/tools/:slug`, `/v1/agents/run` | First-party and developer tools, priced per call. x402 (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE`) or an API key. Every response is Ed25519-signed; the key is at `/.well-known/agent-house-key`. The original `/v1/resolve`, `/v1/companies/:number`, `/v1/check` and `/v1/watch` still work. |
| Discovery | `/.well-known/agent-house.json`, `/llms.txt` | What an agent needs to find the catalogue, MCP, payment details and the signing key. |
| MCP | `/mcp` | The whole catalogue as tools, billed to the API key in the `Authorization` header. |
| Developers | `/api/dev/*`, `/#/developers/dashboard` | Signed in with an API key: publish tools (reviewed before they go live), calls, credits, earnings. Requests to developer endpoints carry `X-AgentHouse-Timestamp` and `X-AgentHouse-Signature: v1=hmac_sha256(secret, ts + "." + body)`. |
| Operator | `/api/admin/*`, `/#/admin` | Approve customer checks and developer tools, create workspaces, load the company index, run jobs. |
| Ingest | `/api/internal/*` | Stream listener posts events here. |
| Webhooks | `/api/webhooks/stripe` | Signature-checked, replay-protected. |

Background work runs on two queues. `AGENT_JOBS` carries agent runs only, one per batch, because a run can take minutes. `JOBS` carries everything else (imports, baselines, alert delivery, digests, webhooks, customer checks, reconciliation batches, monthly prospect lists, workspace purges). Crons (UTC): every 15 minutes, the stuck-run sweep (runs "running" for 15 minutes are failed with their cost recorded; runs queued for 30 minutes are re-queued) and then due agents (schedules are kept in UK time); Gazette poll every 30 minutes; reconciliation of every watched company Monday 06:00, fanned out in batches of 50; digests 07:00; lead lists on the first working day of the month at 08:00, one queued job per business; retention 03:00.

**Agent safety.** Text from inbound mail, web pages and search results is treated as information, never instructions. Without a person approving it, an agent's email only goes to an address already tied to the record it names: the lead's own address (for a lead saved before this run), the invoice's customer, or the sender of the inbox message being answered. Anything else waits in Approvals, whatever the agent's autonomy setting.

**Usage and cost.** Each agent tool call is claimed atomically against both the plan's monthly actions and the agent's own cap, and written to usage as it happens. Model cost is updated on the run after every step, so a run that fails partway still shows what it cost. Claude calls retry 429, 529 and transient 5xx responses with backoff (honouring `retry-after`), and use prompt caching for the system prompt, tools and conversation so far.

**Billing state.** Agents stop (hiring, manual runs, schedules and already-queued runs) when a workspace is cancelled, its trial has ended, or Stripe reports the subscription `unpaid`, `canceled`, `incomplete_expired` or `paused`; `past_due` gets 7 days' grace from the first failure. Plan changes in the Stripe customer portal update the workspace's plan by price id. Webhook events are recorded as seen only after they've been processed, so a failure is retried by Stripe instead of dropped.

**Deletion.** Thirty days after cancellation, retention queues a purge of the workspace: every workspace table (agents, runs, actions, leads, invoices, inbox, tasks, usage, clients, alerts and the rest), agent transcripts, prospect lists and uploaded files in R2, and people who belong to no other workspace. The audit log keeps the actions with targets and details cleared.

**Swarms.** A swarm is a checked JSON blueprint (`packages/core/swarms.ts`, validated in `lib/swarm.ts`): agents (catalogue templates, or custom roles with standing orders and a whitelisted tool set), stages with rules that place records on the board (`lead`, `invoice`, `message`), handoffs, KPIs and a skin. `lib/engine.ts` turns a description into a blueprint with one Claude call plus one correction round, falling back to the nearest preset; it never fails the owner. Swarm agents count against the plan's agents, and spinning up reuses free agents of the same template. Cards follow their records (`syncSwarm`, after every run and every change you make), and a `hand-off` tool lets one agent pass a card to another: allowed routes only, at most 5 a day per card, never straight back, and the note is passed as information, not instructions. Every step lands in `swarm_event`, which the Floor polls every 4 seconds from a cursor. The command bar has fast paths (`@agent do this`, `brief me`, `pause outreach`) and otherwise one routing call to Claude; pausing or resuming always comes back for you to confirm on screen, and nothing can be approved or sent from it.

**Two engines for agents.** LLM agents (outreach, inbox, credit control, research, briefing) run through the tool registry in `lib/agents.ts` and `lib/tools.ts`. The register agents (customer watch, customer check, prospect finder) are the original MSP engines (`agent_config`, `lib/process.ts`, `lib/truth.ts`, briefs); hiring one switches its engine on. New capabilities go into the tool registry.

Plans (in `packages/core/templates.ts`): a 14-day trial with six agents and 1,500 actions, then Starter £49 (2 agents, 300 actions), Growth £149 (6, 1,500) and Scale £399 (12, 5,000). An action is one tool call by an agent. When the month's actions are used, agents pause until the 1st; there are no overage charges. When the trial ends, agents stop until a plan is chosen.

## Deploy to Cloudflare

```bash
wrangler d1 create agent-house           # put the id in wrangler.toml
wrangler kv namespace create CACHE       # put the id in wrangler.toml
wrangler r2 bucket create agent-house-files
wrangler queues create agent-house-jobs
wrangler queues create agent-house-agents
wrangler queues create agent-house-dead
wrangler d1 migrations apply agent-house --remote
```

Set `APP_URL`, `API_URL`, `X402_PAY_TO`, `MAIL_FROM`, `INBOUND_DOMAIN`, `AGENT_MODEL` and the Stripe price ids (`STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`) in `wrangler.toml`. Then the secrets:

```bash
node -e "crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>console.log(Buffer.from(JSON.stringify(j)).toString('base64url')))"
# paste the output as SIGNING_JWK
for s in SIGNING_JWK CHANNEL_KEY CH_API_KEY FCA_EMAIL FCA_KEY STRIPE_SECRET STRIPE_WEBHOOK_SECRET INGEST_SECRET ADMIN_TOKEN OPERATOR_EMAIL TURNSTILE_SECRET ANTHROPIC_API_KEY SEARCH_API_KEY; do wrangler secret put $s; done
```

Voice uses the Workers AI binding (`[ai] binding = "AI"` in `wrangler.toml`, set `VOICE_SPEAKER` and `VOICE_LANGUAGE` in vars). Workers AI always runs remotely, so local dev and the tests point `VOICE_HTTP_URL` at the mock instead; leave it unset in production. Without either, voice routes answer 503 `voice_off` and the Floor uses the browser's speech. Apply migration `0004_swarms.sql` before deploying the Floor.

`CHANNEL_KEY` is 32 random bytes, base64url. `TURNSTILE_SECRET` is optional; set `TURNSTILE_SITE_KEY` in vars alongside it. `ANTHROPIC_API_KEY` runs the agents (model from `AGENT_MODEL`; costs are recorded per run using `AGENT_PRICE_IN_PENCE` and `AGENT_PRICE_OUT_PENCE` per million tokens, with cache writes and reads at `AGENT_CACHE_WRITE_X` and `AGENT_CACHE_READ_X` of the input price).

Pricing for callers is set in `wrangler.toml` too: `USDC_PER_PENNY` converts per-tool prices for x402 (default 0.0125), `X402_PRICES` (JSON) overrides the four original endpoints, and `AGENT_RUN_STEP_PENCE` prices `/v1/agents/run` per model step the caller allows (`max_steps`, default 4, at most 8). Agent runs aren't covered by the 100 free calls; credits are taken before the run and refunded if it fails, and x402 is settled before the run starts. `SEARCH_API_KEY` is a Brave Search API key for the web research tools.

`SENDS_LIVE` is `"false"` in production config, so Teams, Slack and webhooks are recorded but not sent until you switch it on. Turn it on after a dry run with a pilot.

```bash
npm run deploy
```

Run the stream listener somewhere that keeps a process alive (Cloudflare Containers or a small VM) with `STREAM_KEY`, `API_URL` and `INGEST_SECRET`. It resumes from the last stored timepoint after a restart.

Point Cloudflare Email Routing for `INBOUND_DOMAIN` (a catch-all) at the Worker so each business's inbox address (`<alias>@INBOUND_DOMAIN`) reaches the inbox agent, replies from leads are matched, and STOP replies unsubscribe. Point `check@` your domain at it too for emailed brief requests.

## Confirm before going live

These are built to the published documentation but have only been run against the mocks:

- **The Gazette:** the notice search URL and fields in `apps/api/src/lib/registers.ts` (`gazetteNotices`) and the poller in `jobs.ts` (`pollGazette`). `GAZETTE_BASE` is empty in production config, so Gazette checks are off until this is confirmed.
- **FCA register:** the search-by-company-number path and response fields (`fcaStatus`). Failures are reported as "FCA register unavailable", never as "not listed".
- **Companies House streaming:** event shapes in `apps/stream-listener/listener.mjs` against the live stream, and the stream key's connection limits.
- **x402:** the facilitator's `/verify` and `/settle` field names, and the USDC amounts in `pay.ts`.
- **Stripe events:** the webhook needs `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`. Check the portal's plan switch sends the new price on `items.data[0].price.id`.
- **Spreadsheets:** `.xlsx` is read by a small built-in reader (`packages/core/xlsx.ts`) instead of the `xlsx` package; old `.xls` files are refused with a request to save as `.xlsx` or CSV. Try a few real customer exports before launch.
- **Outbound email:** the Cloudflare send binding shape on your account (commented in `wrangler.toml`), or use `MAIL_MODE = "http"`.
- **Stripe:** create one recurring price per plan (Starter, Growth, Scale) and set their ids.
- **Claude and web search:** agent runs are tested against a scripted mock of the Messages API and Brave Search. Run each agent once against the real model with a test business before inviting customers, and review its drafts.
- **Developer payouts:** earnings are recorded per settled call (`tool_earning`); paying publishers out (the site says monthly by bank transfer once £20 is earned) is a manual process for now.
- **Swarm planner and command router:** tested against a scripted mock. Try ten real business descriptions against the real model and read the blueprints before opening the Floor to customers.
- **Voice:** Whisper's accuracy on UK accents and noisy phone audio, and Aura's voice choice (`VOICE_SPEAKER`). The routes cap uploads at 4 MB (about a minute) and 240 voice calls an hour per workspace.
- **Cloudflare Containers:** connection lifetime for the long-lived stream, if you host the listener there.
