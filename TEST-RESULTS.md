# Agent House test results, 2026-10-26 (credits: the AI Team metered on model cost instead of actions)

This run, against the mocks:
1. **Typecheck** clean.
2. **Unit** 253 passed (21 files). New: `credits.test.ts` (16: the formula for every mode with uncached input, cache reads at each model's multiplier and cache writes at 1.25x; Haiku 5.5's long-prompt tier, per request; 2dp ledger rounding and the 1-credit minimum; the config; recommending a mode, estimates from past runs, the cheaper-mode suggestion), `ledger.test.ts` (18: the 150-credit trial grant once; the monthly reset in UK time, idempotent, from the cron and on read; the last step's overshoot forgiven at the reset; top-ups rolling over and arriving from Stripe only when paid, once; the plan-wide pause, told once, ended by a top-up or the 1st; the per-agent pause, alone, ended by a bigger budget, and a run stopped before the step past it; prorated upgrades from the route or the webhook, once; downgrades on the 1st; a prorated first month; asking before a run over the threshold; default modes), `stripe-setup.test.ts` (2: the setup script's prices match the site's). Tests of the old action allowance now assert the credit equivalents (concurrent charges can't spend the same credits twice; a stuck or failed run is charged once for what it used).
3. **API end-to-end** (`npm run test:e2e`) 46 passed. New flows: a top-up checkout credited only when paid, once; an upgrade charged now with its prorated credits; a downgrade scheduled for the 1st and called off again, releasing the Stripe schedule; checkout anchored to the 1st; usage showing the trial's 150 credits and what used them.
4. **Browser** (`node tests/e2e/os-check.mjs`, demo build) 12 passed, no page or console errors: the pricing page (headline, subhead, the three plans with their credits, "Most chosen", the four modes with their models in a caption, the footnote word for word, the four questions); the landing page's pricing; the Usage page (credits left, by agent and by mode, the ledger, the Inbox-on-Deep tip, a budget reached, a top-up adding 1,000); hiring with a suggested mode; an agent's mode shown with its model; a costlier mode asking first with its monthly estimate; pricing and Usage at 390 px with no sideways scroll.
5. **Seeded demo:** `npm run seed:demo` against a fresh local D1, then signed in and read `/api/ws/usage`: Growth, 5,028 credits left (4,028 plan, 1,000 topped up), 972 used this month across 6 agents and all four modes, 11 AI Team (system) calls, Research at its 150-credit budget, and "Inbox runs on Deep; Quick would likely do the job and save ~350 credits a month."

Not run: `tests/e2e/ui.mjs` already failed on the base branch at its second flow (it looks for "Demo workspace for Brightwork Cleaning", removed in f818e0b) and isn't in CI; its usage flow is updated for credits.

## Previous run, 2026-10-24 (the business OS overhaul: 118 native modules, channels for people and agents, per-business pricing, and a landing page that leads with the OS)

The staged check for this release:
1. **Stage 1, the catalogue against the matrix** (`node scripts/os-matrix-check.mjs`): 118 matrix rows in 17 areas; 118 modules in 17 areas, 108 agent roles. Every row is a module with matching area, app, depth (6 native, 34 partly built, 78 records + agent), phase and purpose; every module but whistleblowing has an agent whose standing orders name it. Passed.
2. **Stage 2, the API:** typecheck clean; unit 139 passed (11 files; `os.test.ts` adds 19: the catalogue's coverage, per-business plans, records in every one of the 118 modules with each kind's fields and checks, viewers read and talk but don't change records, deleting a record removes its thread, default channels, an @mention that hires the role's agent, runs it with the message and posts its answer back, a record's thread giving the agent the record, a failed run and a paused agent said so in the channel, longest-name mention matching with a business's own agents first, the 100-agent limit, the directory, OS agents writing only their own modules, task assignees, OS tables in the purge). API end-to-end 44 passed (two new flows: a record in all 118 modules through the API with a viewer refused; an @mention in #general answered by the agent, which saved a record in its own module, plus a record thread). The plan-limit flows now fill a business to 100 agents.
3. **Stage 3, the browser** (`node tests/e2e/os-check.mjs`, demo build): the landing page leads with the OS (every area, people and agents together, native not bolted on, built one module at a time, agents as the engine); `/os` lists all 118 apps and filters by area; pricing is per business; the launcher shows all 118 apps by area; **every one of the 118 module screens opens** with its records, its status filters, its agent (or "People only") and a link to its full screen where one exists; a record added, edited and discussed in its thread with an agent's answer; an @mention in #finance answered; a module's agent asked from its screen and answered in the area's channel; tasks given to people; landing, map, apps, a module and Messages at 390 px with no sideways scroll. 10 checks passed, no page or console errors. The full browser suite (`tests/e2e/ui.mjs`) passed 22 flows, with a new live flow: open Payables, add an entry, ask the Payables agent and see the answer in #finance.

## Previous run, 2026-10-23 (scale fixes from the architecture check, and Today with house rules; on top of the site overhaul, swarms and pre-launch hardening)

This run: typecheck clean; unit 120 passed (10 files: `scale.test.ts` and `today.test.ts` added, `ratelimit.test.ts` rewritten for budget lanes against real SQL); API end-to-end 42 passed (the operator re-check now runs with `?all=1`, since the cron takes a seventh a day); browser 21 passed (a new flow approves two drafts on Today in one go, keeps a learned rule and adds a house rule; Today measured at 390 px with no sideways scroll). The sections below are from earlier runs unless a count says otherwise.

New in the unit suite:
- `scale.test.ts` (20): agents spread across the hour; the cron queues starts without running them; a duplicated start makes one run; two runs at once per workspace, the next deferred without a retry; a late finish doesn't overwrite "interrupted"; register waits re-sent with a delay, then ordinary retries after 48; dead letters recorded with one operator email an hour; watches found by index; prospect lists past 100 parameters; the Floor paged forwards from its cursor; bulk card loads logged as one line; poll syncs at most once a minute; auto-replies and list mail kept but not waking agents; a burst of mail making one run; retention trimming the Floor's log, old bodies and register events, step by step; a purge that finishes and doesn't repeat; the daily re-check covering every company once a week.
- `today.test.ts` (10): Today's sections and headline; batch approval where one already-decided draft doesn't stop the rest; viewers can't approve; edits that teach a rule and edits that don't; owner rules active at once and not duplicated; rules in every agent's standing orders; the rules API.

Typecheck: clean (tsc -p .). `npm audit --omit=dev`: 0 vulnerabilities (the `xlsx` package is gone).

## Unit (vitest)
```
 ✓ tests/unit/swarm.test.ts (18 tests)      blueprints and stage rules, spin-up with reuse and plan limits, handoff guards, board sync, Floor state, CRM, command bar, brief
 ✓ tests/unit/inputs.test.ts (15 tests)      .xlsx reader, zip-bomb limit, MIME decoding, outbound URL and redirect checks, Claude retries and caching
 ✓ tests/unit/hardening.test.ts (15 tests)   auto-send recipients, billing state, Stripe webhook retry, atomic credits and actions, purge, stuck runs, sign-in links
 ✓ tests/unit/core.test.ts (19 tests)
 ✓ tests/unit/agents.test.ts (6 tests)
 ✓ tests/unit/scoped.test.ts (3 tests)
 ✓ tests/unit/ratelimit.test.ts (2 tests)
 Test Files  7 passed (7)
      Tests  78 passed (78)
```
The hardening suite runs the real SQL against Node's built-in SQLite with every migration applied (`tests/unit/d1.ts`).

## API end-to-end (tests/e2e/run.mjs)
```
  pass  health check: upload, match, report held for approval, approve, email, report page
  pass  operator creates a pilot workspace; owner signs in with a magic link
  pass  channels: add Teams, Slack and email; test message arrives; agent settings saved
  pass  client import: upload, match, confirm the uncertain one, clients listed
  pass  stream: administration event becomes a Critical alert, sent to Teams at once
  pass  Gazette poller: insolvency notice becomes a second Critical alert
  pass  Review alerts wait for the digest; the digest goes to Teams
  pass  reconciliation re-reads every watched company and finds nothing new
  pass  alerts: mark reviewed and reopen; counts follow; share to Slack
  pass  client record: register history with alerts, pause and resume watching
  pass  new-client brief: clean company, flagged company, and an ambiguous name
  pass  usage: totals, per-client cost share, rebilling markup, CSV export
  pass  client book: add one client by number; duplicates and unknown numbers refused
  pass  roles: a viewer can read but not change; another MSP can't see this book
  pass  Truth API: 402 with requirements, x402 payment settles, signature verifies
  pass  Truth API: developer key by email, free calls, profile with provenance on every field
  pass  MCP server: tools listed, check called with the API key, no key refused
  pass  Truth API: watch sends a signed webhook when a watched company changes
  pass  booking: slots listed, booking confirmed with calendar entry, double booking refused
  pass  billing: Stripe checkout; signed webhook activates the plan; bad and replayed webhooks handled
  pass  inbound email: a workspace user emails a company name and gets a brief back
  pass  prospect finder: index loaded, filters applied, monthly list built and downloadable
  pass  business sign-up: self-serve workspace, profile, catalogue, hire agents
  pass  outreach agent: finds a company, reads its site, saves a lead, drafts an email; approval sends it
  pass  inbox agent: an enquiry arrives by email, is triaged, and a reply is drafted; a STOP reply suppresses
  pass  credit control: invoices imported, a reminder drafted and approved; with approve-first the next goes on its own
  pass  research and briefing agents; the scheduler runs what's due
  pass  agents are private to their business: another business can't see or approve them
  pass  swarms: presets listed; a description becomes a blueprint (with a correction round, or the nearest preset)
  pass  swarms: spin up the sales floor; locked presets and over-plan swarms are refused and leave nothing behind
  pass  the Floor: the prospector finds a company, saves it as a card and hands it to outreach, which wakes
  pass  command bar: @agent instructs, brief me, questions go to the router, pause comes back for confirmation
  pass  voice: a recording is transcribed and a reply is spoken; both are metered
  pass  CRM: contacts, a deal won, notes and a timeline; moving a card moves its lead
  pass  swarms are private, viewers can't drive them, and removing one removes its agents
  pass  tool gateway: catalogue and discovery; x402 or a key; every answer signed
  pass  Agents API: priced per step, not free, paid before it runs; one call runs an agent with catalogue tools, signed
  pass  developer publishes a tool: review, then live in the catalogue and MCP; callers pay, publisher earns 80%
  pass  plan limits: the trial allows six agents; usage shows the allowance
  pass  billing state: plan changes follow Stripe; past-due and cancelled workspaces stop their agents
  pass  audit log records actions; retention job runs
All 41 end-to-end flows passed.
```
The research flow now starts with Claude answering 529 twice; the run retries and completes. Every model call in the Agents API flow carries prompt-cache markers.

## Browser (tests/e2e/ui.mjs, Chromium)

Re-run in full with the Floor added. The Floor flow describes a business, spins up the designed swarm against the real API, asks for a brief, pauses and resumes an agent from the command bar, and opens the Board and Companies views.
```
  pass  public pages render for all three doors; signed-out header offers sign in
  pass  demo workspace: signed out, approve an email and ask the research agent
  pass  free customer check: upload a customer list
  pass  booking: live slots, book one, confirmation shown
  pass  sign up at /start; the emailed link opens an empty workspace
  pass  settings: business profile saved; a Teams channel added and tested
  pass  outreach: hire, run now, watch the steps, edit and approve the email; the lead is contacted
  pass  credit control: invoices uploaded, a reminder drafted and approved
  pass  inbox: an enquiry arrives by email; the drafted reply is reviewed and rejected
  pass  research: ask from the overview; the answer comes with sources
  pass  customer watch: hire, import customers, confirm the ambiguous row
  pass  alerts: a register change arrives; review, reopen and share it
  pass  company check: ambiguous name, pick a candidate, brief completes
  pass  the Floor: describe the business, spin up a swarm, brief me, pause an agent, see the board and companies
  pass  usage and plan: actions counted; choosing Growth goes to Stripe Checkout
  pass  team: invite a viewer, sign out; the viewer can read but not approve or hire
  pass  developers: get a key, open the dashboard, publish a tool; the secret is shown once
  pass  operator: approve the customer check report and the developer tool
  pass  for agents: the live catalogue includes the new tool; a call with a key reaches it
  pass  phone width: home, agents, workspace and for-agents fit without sideways scroll
All 20 browser flows passed. Screenshots in ui-shots/
```

Both end-to-end suites run against `wrangler dev` with fresh local state and the mocks in `mocks/server.mjs` (Companies House, Gazette, FCA, x402 facilitator, Stripe, Teams, Slack, the Claude Messages API and Brave Search). The browser suite fails on any page or console error and checks phone width for sideways scroll. Screenshots are in `ui-shots/`.

The demo Floor (signed out, `/#/floor`) was also checked by hand in Chromium at 1440, 1280 and 390 wide: stations, handoff pulses, tool sparks, the desk, the board, the company drawer, the command bar's confirm step and the phone layout, with no console errors.
