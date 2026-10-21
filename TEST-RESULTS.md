# Agent House test results, 2026-10-21 (swarms, the Floor, CRM and voice; on top of pre-launch hardening)

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
