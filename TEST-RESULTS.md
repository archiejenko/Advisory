# Agent House test results, 2026-10-21

Typecheck: clean (tsc -p .).

## Unit (vitest)
```
 ✓ tests/unit/core.test.ts (19 tests) 50ms
 ✓ tests/unit/agents.test.ts (6 tests) 27ms
 ✓ tests/unit/scoped.test.ts (3 tests) 8ms
 ✓ tests/unit/ratelimit.test.ts (2 tests) 4ms
 Test Files  4 passed (4)
      Tests  30 passed (30)
```

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
  pass  tool gateway: catalogue and discovery; x402 or a key; every answer signed
  pass  Agents API: one call runs an agent with catalogue tools, signed
  pass  developer publishes a tool: review, then live in the catalogue and MCP; callers pay, publisher earns 80%
  pass  plan limits: the trial allows six agents; usage shows the allowance
  pass  audit log records actions; retention job runs
All 33 end-to-end flows passed.
```

## Browser (tests/e2e/ui.mjs, Chromium)
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
  pass  usage and plan: actions counted; choosing Growth goes to Stripe Checkout
  pass  team: invite a viewer, sign out; the viewer can read but not approve or hire
  pass  developers: get a key, open the dashboard, publish a tool; the secret is shown once
  pass  operator: approve the customer check report and the developer tool
  pass  for agents: the live catalogue includes the new tool; a call with a key reaches it
  pass  phone width: home, agents, workspace and for-agents fit without sideways scroll
All 19 browser flows passed. Screenshots in ui-shots/
```

Both end-to-end suites run against `wrangler dev` with fresh local state and the mocks in `mocks/server.mjs` (Companies House, Gazette, FCA, x402 facilitator, Stripe, Teams, Slack, the Claude Messages API and Brave Search). The browser suite fails on any page or console error and checks phone width for sideways scroll. Screenshots are in `ui-shots/`.
