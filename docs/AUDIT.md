# Workspace audit (Phase 0)

What the Brightwork demo workspace is today, where every number comes from, and what Phases 1–8 will change. No UI was changed to produce this.

**Baseline.** Branch `hardening-batch-3` at `b952c3f`. It includes `deploy/ejtech`, `os-overhaul` and `swarm-floor`. The figures below come from building the stand-alone demo (`DEMO=1 node apps/web/build.mjs`), opening every workspace route in Chromium at 1280px and reading the rendered text.

**Decisions taken before this audit**
- **Demo-first.** The overhauled workspace reads only from a new client-side demo store. Signed-in customers keep the current `/workspace` pages until an API adapter for the store exists. The fork happens in `Gate` (`apps/web/src/pages/Live.jsx:38`), which already branches on whether there is a signed-in user.
- **Dark only.** Tokens come from the Dark theme. The Calm, Terminal and Light themes and the theme picker go.
- **No rewrite.** The stack stays: React 18, esbuild into a single `index.html`, the hash router, and a Cloudflare Worker serving the site. Nothing in it blocks the brief. New workspace code goes in a fresh `apps/web/src/workspace/` tree, so the live pages stay untouched.

---

## 1. Stack

| Piece | Where | Notes |
|---|---|---|
| Web app | `apps/web/src` (JSX, no TypeScript) | React 18.3.1, bundled by esbuild 0.28 (`apps/web/build.mjs`). CSS is five files concatenated into one `<style>`. |
| Router | `apps/web/src/router.jsx` | Hash routes (`#/workspace/...`), so the single file works offline. Patterns are matched in order from `App.jsx` `ROUTES`. |
| Live backend | `apps/api` (Hono on a Worker, D1) | `/api/ws/*` serves signed-in workspaces. |
| Demo backend | `apps/web/src/demo.js` and friends | `api()` in `api.js` short-circuits `/api/ws/*` to `demoApi()` when signed out (`setDemo(true)` in `Gate`). |
| Shared catalogue | `packages/core/os.ts`, `osconfig.ts`, `swarms.ts`, `badges.ts`, `templates.ts` | Used by both the API and the web app. |
| Icons | `Glyph` in `apps/web/src/kit.jsx` | Hand-drawn SVG set; no icon library. |
| Tests | `tests/unit/*.test.ts` (vitest), `tests/e2e/run.mjs` (API), `tests/e2e/ui.mjs` and `os-check.mjs` (Playwright) | The UI suites assert today's workspace copy. |

---

## 2. Route map

The workspace routes all render through `Gate`, which picks the live or demo data, and then `OsShell` (`pages/OsShell.jsx`). That gives a full-screen frame: a top bar, the page, and a floating dock.

| Route | Component | Renders |
|---|---|---|
| `/workspace` | `WsHome` (`OsHome.jsx`) | Greeting, "N things need you", **Needs you** (approvals, tasks, rules, alerts), and the editable **Your business** widget grid |
| `/workspace/today` | `WsToday` (`Today.jsx`) | A second home: Needs you, At risk, Tasks for you, Came in, This week |
| `/workspace/overview` | `WsOverview` (`Ws.jsx`) | A third home: "Agents and activity" metric tiles, Needs you (4), Recent activity |
| `/workspace/build`, `/workspace/settings/os` | `WsBuild` (`Builder.jsx`) | **Your OS** builder: Library, canvas, Undo/Redo, Start from an industry, and the summary bar |
| `/workspace/apps` | `WsApps` (`Os.jsx`) | All 138 apps by area, with Full / Partly built / Records and AI Team filters |
| `/workspace/app/:module` | `WsModule` (`Os.jsx`) | A generic record list for one app, with a depth banner, the app's agent card, and a record drawer with a thread |
| `/workspace/messages` | `WsMessages` (`Os.jsx`) | Team channels (#general, #sales, #finance, #operations, #people) with @agent mentions |
| `/workspace/rules` | `WsRules` (`Today.jsx`) | House rules, both learned and owner-written |
| `/workspace/approvals` | `WsApprovals` (`Ws.jsx`) | Email approvals: list and editor |
| `/workspace/agents`, `/agents/new`, `/agents/:id` | `WsAgents`, `WsHire`, `WsAgent` (`Ws.jsx`) | The hired agents, the hiring catalogue, and one agent's page |
| `/workspace/activity`, `/runs/:id` | `WsActivity`, `WsRun` (`Ws.jsx`) | The run log, and one run step by step |
| `/workspace/leads` | `WsLeads` (`Ws.jsx`) | Outreach leads table |
| `/workspace/inbox` | `WsInbox` (`Ws.jsx`) | Triaged inbound email |
| `/workspace/invoices` | `WsInvoices` (`Ws.jsx`) | Unpaid invoices with reminders, plus CSV upload |
| `/workspace/tasks` | `WsTasks` (`Ws.jsx`) | Tasks for people and agents |
| `/workspace/alerts`, `/clients`, `/clients/:no`, `/check`, `/import`, `/prospects` | `Live.jsx` | Companies House customer watch, customer list and record, company check, import, prospect lists |
| `/workspace/usage`, `/workspace/settings` | `Account.jsx` | Plan and usage; profile, channels and team |
| `/floor`, `/floor/:id` | `FloorHome`, `FloorView` (`Floor.jsx`) | **The Floor / AI Team**: "Describe your business. We'll staff it with agents.", presets, a drag-and-drop floor map, the desk, a board, and companies |
| `/os` | `OsPage` (`OsPublic.jsx`) | Marketing catalogue of all 138 apps, with "Partly built" copy |
| Marketing | `/`, `/agents`, `/agents/:slug`, `/start`, `/how-it-works` = `/method`, `/use-cases`, `/pricing`, `/trust` = `/standards`, `/developers`, `/developers/dashboard`, `/for-agents`, `/book-a-call`, `/health-check`, `/sign-in`, `/admin`, `/unsubscribe` | Website pages, using `Header` and `Footer` from `layout.jsx` |

**Duplicates and overlaps**
- There are three "home" screens: `/workspace`, `/workspace/today` and `/workspace/overview`.
- There are two routes for the builder (`/workspace/build` and `/workspace/settings/os`), and two each for method and standards.
- Every app has two places: a bespoke page (for example `/workspace/invoices`) and a generic `/workspace/app/sales-invoicing`. These read **different data** (see §4). The generic page links to the bespoke one with "Open the full … screen".
- `Messages` (`/workspace/messages`) and the dock's `Channels` app (`/workspace/app/team-chat-and-channels`) are the same idea.

---

## 3. Component inventory

| Concern | Implementations | Action |
|---|---|---|
| Page frame | `OsShell` (`OsShell.jsx`); `Shell` (`Live.jsx`) wraps it for workspace pages; Floor builds its own header inside it | One `AppShell` |
| Home / decision queue | `OsHome.NeedsYou` and `SwipeCard`; `Today.WsToday`; `Ws.WsOverview`; the `WsApprovals` editor | One `DecisionCard` plus one queue on Home |
| Metric tiles | `OsHome.WidgetBody` (`wd-num`), `Ws.WsOverview` tiles, `Ws.WsInvoices` summary, Floor `Kpis` | One `MetricTile` |
| Tables | Raw `<table className="ws-table ledger">` on each page; `main.jsx` mutates the DOM after render to turn tables into cards on phones | One `DataTable` with a built-in mobile layout; delete the DOM hack |
| Drawers | `Os.RecordDrawer`, `Floor.Drawer`, `Floor.CompanyPanel`, `Floor.StationPanel` | `RecordDrawer` and `RecordPage` |
| Agent cards | `Os.AgentCard`, `Org.AgentCard`, Floor `Station` | `AgentBadge` plus the agent page |
| Status pills | `.st`, `.st-done`, `.st-waiting`, `.sev`, `.sev-crit`, `.sev-rev`, `DepthPill`, `.os-badge`, `.os-badge-q` | One `StatusChip` with fixed semantic colours |
| Notices and empty states | `Live.Notice`, `Live.Loading`, `Live.Failed`, and ad-hoc `<p className="empty">` | `EmptyState`, plus loading and error states inside `DataTable` |
| Command bar | `OsShell.CommandLayer` (⌘K, voice) and the floating "Ask or say anything" button; Floor `CommandBar` | `AskBar` |
| Toasts | `OsShell` toast | `UndoToast` |
| Chat | `Os.Thread` and `Os.WsMessages` | Team chat inside the Team hub |
| Icons | `Glyph` (custom). Messages, Channels and the notification idea all use `bell`. Inbox and Helpdesk overlap. | Lucide, with one distinct icon per hub and app |
| Navigation | Floating bottom dock (`.os-dock`), which on desktop overlaps page content and the builder summary bar | Sidebar and icon rail on desktop and tablet; a tab bar on mobile |

**One-offs that stay:**
- Floor's `FloorMap`, `Station`, `Ticker` and `Desk`, and the drag-and-drop interaction. These are kept and restyled.
- The Builder's `Panel` and `Dialog`. These are kept, and the summary bar is fixed.

---

## 4. Data inventory

### 4.1 Where data lives in the demo: five overlapping fake backends
1. **`demo.js` `seed()`.** This holds 6 agents, 8 leads, 7 invoices, 6 inbox messages, 7 actions (4 of them proposed), 5 tasks, 3 rules and 4 users. It answers `/overview`, `/today`, `/actions`, `/leads`, `/invoices`, `/inbox`, `/tasks`, `/usage` and others.
2. **`osDemo.js` `seedOs()`.** This holds 27 generic "module records" across about 25 apps, 5 channels with 10 messages, and 2 extra "app agents" (Proposals agent and Payables agent). It answers `/os/catalogue`, `/os/m/:module/records` and `/os/channels`.
3. **`builderDemo.js`.** This holds the saved OS: the `trades` pack plus 17 extra apps (36 here, 3 outsourced), the layout and widgets, and the change history.
4. **`floorDemo.js`.** This is a running simulation. Creating the preset swarm adds **Orchestrator** and **Prospector** to `s.agents`, which takes the count from 6 to 8. It also has its own CRM (`/crm/companies`), built from `demo.js` leads.
5. **`packages/core`.** This is the static catalogue: `FACETS` (138 apps across 18 areas, each `full`, `partial` or `basic`), `BUILDER_APPS` (133, excluding the always-on area), `ROLES` (about 100 agent roles), and `estimate()`.

No entity links to another by ID across these stores. A lead, a CRM company, a module record and an invoice for the same business are unrelated objects.

### 4.2 Every headline figure, and its source

| Shown as | Value | Source |
|---|---|---|
| Home "Money · overdue" | £2,336.00 · 3 invoices | `todayDemo` (`demo.js:127`): `demo.js` invoices with `status === "unpaid"` and `due < today`, which are INV-1042 Quayside £640 (23 days), INV-1047 Tarnbrook £1,280 (9 days) and INV-1051 Ancoats £416 (2 days) |
| Home "due in 7 days" | £320.00 | INV-1053 Castlefield (+5 days) |
| Invoices "Unpaid, not yet due" | £1,280.00 | INV-1053 and INV-1055 (£320 + £960) |
| Invoicing app, Receivables app | **empty** ("No entrys yet") | `osDemo` has no `sales-invoicing` or `credit-control` records |
| Home "new leads this week" | 6 | `week.new_leads`, from `demo.js` leads created in the last 7 days |
| Leads page | 8 | All `demo.js` leads |
| CRM app | **empty** | `osDemo` has no `pipeline-and-crm` records. The Floor CRM, by contrast, lists the leads. |
| "replies this week" | 2 | **Hardcoded** at `demo.js:147` |
| "replies today" | 1 | `came_in.replies`, which counts leads in the `replied` status (not today's replies) |
| "won this week" | 1 | **Hardcoded** (`won: 1`, `demo.js:147`) |
| Top bar "N waiting for you" and the dock Home badge | 4 | `overview.waiting`: proposed actions |
| Home "N things need you" and the Needs you badge | 10 | `needs_you.total` = 4 approvals + 4 open tasks + 1 proposed rule + 1 critical alert |
| "Approve all N" | 4 | Approvals only |
| Approvals page "Waiting" | 4 | `/actions` counts |
| Overview "Agents working" | 8 | `s.agents`: 6 seeded plus the 2 added by `floorDemo` |
| Floor team card | "5 agents" | The swarm blueprint's agents |
| Builder summary "AI Team members" | 39 | `Builder.jsx:257`: distinct `facet.agent` roles across the 36 + 3 installed apps |
| Usage "Agents hired" | 8 of 100 | `s.agents` |
| "Runs this week" / "jobs this week" | 16 | `runs_week = real + 9` (**padding**, `demo.js:206`) |
| "Emails sent this week" | 6 | `sent_week = real + 4` (**padding**, `demo.js:207`); `todayDemo` repeats `+ 4` |
| Agent page "actions this month" | real + 38 | **Padding**, `demo.js:223` |
| Usage table | runs +6, actions +34, emails +17, `model_pence: 412` | **Padding** and hardcoded, `demo.js:266-267` |
| Weekly briefing run summary | "£2,240 overdue across 3 invoices" | **Hardcoded** string (`demo.js:93`); disagrees with £2,336 |
| #general briefing message | "4 replies to outreach … £1,280 overdue from Tarnbrook" | **Hardcoded** (`osDemo.js`); disagrees with both 2 replies and £2,336 |
| Library count vs Apps count | "133 apps" vs "138 apps" | `BUILDER_APPS` vs `FACETS` |
| `/os` page | "6 are fully native today, 34 are partly built, and 98 start as records" | `FACETS` depth counts |

### 4.3 Disagreements to fix
1. **The overdue amount has the right total but the wrong invoices.** Home shows £2,336 overdue, but Invoicing and Receivables are empty. The brief's three invoices are Tarnbrook £1,280 (21 days, one reminder sent), Didsbury Lettings £656 and Spinningfields Law £400. Today's three are Quayside, Tarnbrook (9 days, no reminder) and Ancoats.
2. **Leads.** Home says 6, CRM is empty, the Leads page says 8, and the Floor CRM shows another view of the same 8.
3. **Pending.** Pending shows as 4 (top bar, dock, "Approve all 4", Approvals) and as 10 (Home). The brief wants a single 10: 4 routine and 6 for review.
4. **Agents.** The count shows as 5 (Floor), 6 (seed), 8 (Overview and Usage), 39 (builder) and about 100 (ROLES that can be @-mentioned). The brief wants 6.
5. **Replies and briefing copy.** These are hardcoded and contradict each other.
6. **Peel Street.** Peel Street appears as a lead, an outreach approval, a quote record (£9,600, osDemo) and an inbox message about keys. None of them are linked.
7. **INV-1047.** It is 9 days late in the invoice table but "21 days, 2nd reminder" in the brief's example decision. The brief wins.
8. **Hardcoded padding.** All the `+ N` padding goes in Phase 1, and every figure becomes a selector over seeded history.

---

## 5. Banned and incorrect copy

| String | Where |
|---|---|
| "Full", "Partly built", "Records and AI Team" (badges, filters, notes) | `pages/Os.jsx:32-34, 66`; `pages/Builder.jsx:23`; `pages/Home.jsx:229, 239`; `pages/OsPublic.jsx`; `pages/Method.jsx:106`; `pages/UseCases.jsx:65` |
| "Some of this runs natively today; records and the AI Team fill the rest." | `pages/Os.jsx:33` |
| "The full native screen is still being built." | `pages/Os.jsx:34` |
| "Open the full {app} screen" (renders "Open the full **crm** screen" through `.toLowerCase()`) | `pages/Os.jsx:138` |
| "No **entrys** yet." (built from `` `${label.toLowerCase()}s` ``) | `pages/Os.jsx:151`. The same naive plural also appears in `plural()` (`OsHome.jsx:15`, `Today.jsx:16`). |
| "6 are fully native today, 34 are partly built…" | `pages/OsPublic.jsx` |
| Lowercased app names in sentences ("Used by sales manager", "works invoicing") | `pages/Os.jsx:137, 178` |
| Technical labels in the owner view ("Ledger", "Receivables", "Payables") | `packages/core/os.ts` app names, shown in the dock and builder |

These pages are mostly marketing or legacy. The banned-string test in Phase 8 will cover the rendered workspace and `/os`.

---

## 6. Extracted design values

These are measured from `apps/web/src/os.css` (`.os-shell[data-theme="dark"]`), `floor.css` and `theme.css`. They are the current look, not new choices. The proposed file is `apps/web/src/workspace/tokens.css`, scoped to `.ws` (the new workspace root) so the marketing site is unaffected.

```css
.ws {
  /* Surfaces: today's paper / card / surface, mapped to three levels */
  --surface-base:    #0E1013;   /* --paper */
  --surface-raised:  #171A1F;   /* --card */
  --surface-overlay: #1C2026;   /* --surface (menus, drawers, command bar) */
  --surface-sunken:  #14171B;   /* --stone (inputs) */
  --surface-hover:   #262B32;   /* --surface-2 */
  --base-glow: radial-gradient(1100px 520px at 15% -12%, #16213F 0%, transparent 62%);

  /* Lines */
  --line-border:  #2C3139;      /* --line */
  --line-divider: #23272E;      /* new: --line at about 70% for row dividers */

  /* Text */
  --text-primary:   #ECEDEF;    /* --ink */
  --text-secondary: #CDD0D5;    /* --body */
  --text-muted:     #A9AEB5;    /* --graphite / --mist */

  /* Brand and semantic status (fixed meanings) */
  --primary:        #7C9BFF;    /* lavender: buttons, focus, agent/info */
  --primary-ink:    #0B0C0E;
  --primary-soft:   rgba(124,155,255,.16);
  --status-agent:   #8EA8FF;    /* lavender text on dark */
  --status-attn:    #F7BE5C;    /* amber = needs you (text); fill #F5A524 */
  --status-attn-bg: rgba(245,165,36,.15);
  --status-done:    #6BE3A6;    /* green = done or paid (text); fill #3DD68C */
  --status-done-bg: rgba(61,214,140,.15);
  --status-risk:    #FF7A66;    /* coral = overdue or risk */
  --status-risk-bg: rgba(255,122,102,.15);
  --status-neutral: #A9AEB5;
  --status-neutral-bg: #262B32;

  /* Radius: in use 6/8/10/12/14/16/18/20/22/999, normalised */
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-pill: 999px;

  /* Spacing: 4pt scale (gaps in use: 2/4/6/8/9/10/12/14/16/18) */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-10: 40px; --s-12: 48px;

  /* Elevation: two levels (today's sh-2 / sh-3) */
  --e-1: 0 0 0 1px var(--line-border);
  --e-2: 0 0 0 1px var(--line-border), 0 20px 40px -16px rgba(0,0,0,.6);

  /* Type: font stack unchanged; sizes in use 11-20, 28, clamp(26,3vw,36) */
  --font: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --t-xs: 12px; --t-sm: 13px; --t-base: 15px; --t-md: 17px; --t-lg: 20px;
  --t-title: clamp(28px, 2.4vw, 32px);   /* page titles (today up to 36px, home up to 56px) */
  --t-display: clamp(32px, 4vw, 44px);   /* Home greeting only */
  --lh-tight: 1.15; --lh-body: 1.5;
  --tnum: "tnum" 1;                      /* font-feature-settings for money and counts */

  /* Layout */
  --top-h: 60px; --rail-w: 72px; --side-w: 240px; --content-max: 1200px; --row-h: 44px;
}
```

### Contrast on the current dark values (WCAG 2.1)

| Text | on base | on raised | on overlay | on hover |
|---|---|---|---|---|
| primary #ECEDEF | 16.3 | 14.9 | 14.0 | 12.2 |
| secondary #CDD0D5 | 12.3 | 11.3 | 10.6 | 9.2 |
| muted #A9AEB5 | 8.5 | 7.8 | 7.3 | 6.4 |
| lavender #7C9BFF | 7.3 | 6.6 | 6.2 | 5.4 |
| amber #F5A524 | 9.3 | 8.6 | 8.0 | 7.0 |
| green #6BE3A6 | 11.9 | 10.9 | 10.3 | 8.9 |
| coral #FF7A66 | 7.5 | 6.8 | 6.4 | 5.6 |
| **placeholder #80868E** | 5.2 | 4.8 | **4.45 ✗** | **3.9 ✗** |
| button text #0B0C0E on lavender | 7.4 | | | |

Everything passes AA except the input placeholder on overlay and hover surfaces. The new tokens use `--text-muted` for placeholders instead.

---

## 7. Risks

1. **The live and demo fork.** New workspace pages render only when `me.demo` is true. The live pages, `OsShell` and the API stay as they are. Risk: shared CSS. Mitigation: everything new is scoped under `.ws`.
2. **The UI test suites** (`tests/e2e/ui.mjs`, `os-check.mjs`) assert the current demo copy ("Demo workspace for Brightwork Cleaning", "Tarnbrook" and so on). They will be updated phase by phase alongside the screens they cover.
3. **Installed apps vs "hide unbuilt apps".** The demo OS installs 36 apps, most of them generic. The brief hides unbuilt apps and builds bespoke screens only for §7.4. Proposal: the seeded OS installs the §7.4 apps, plus Payroll and VAT/Year end (outsourced) and a handful of standard-template apps (Complaints, Health and safety, Stock). Everything else appears only in the Setup library as "Available soon".
4. **The Floor and builder are kept**, but they read today's fake backends (`floorDemo`, `builderDemo`). Phase 1 points them at the new store through a thin adapter, so their counts reconcile without rewriting their interactions.
5. **Removing the dock** changes mobile navigation, which the Floor's `MobileFloor` assumes. It is covered by the new tab bar.
6. **Bundle size** (995 KB today, a single inline file). `lucide-react` is tree-shaken, and only the imported icons are bundled. The CSP is unaffected because everything stays inline.
7. **Dates.** The seed is relative to "now", so headline figures such as "21 days late" must be computed against a fixed demo clock in tests (selectors take `now` as an argument).

---

## 8. Plan for Phases 1–8

| Phase | Output | Key files |
|---|---|---|
| 1. Data model and seed | Typed entities linked by ID; one store with subscribe and actions, persisted to `localStorage` with a "Reset demo" option; selectors for every figure; the Brightwork seed reconciled to the brief (3 overdue = £2,336.00, £320 due in 7 days, 10 approvals as 4 routine + 6 review, 6 agents, 8 people, 6 new leads, 2 replies with 1 today, 8 weeks of history); a unit test of every headline figure | `apps/web/src/workspace/demo/{types,store,seed,selectors}.ts`, `tests/unit/seed.test.ts` |
| 2. Design system | `tokens.css` (above); the components in §6 of the brief; `/workspace/design`, hidden from navigation; Lucide | `apps/web/src/workspace/ui/*`, `apps/web/src/workspace/tokens.css` |
| 3. Shell and Home | Sidebar, rail and tab bar; top bar; Home (greeting, outcomes, Needs you with keyboard and swipe, undo, trust ladder, Leaks, Today, Team activity, Brief me); `/os` explainer; entry points land on Home | `workspace/AppShell.jsx`, `workspace/pages/Home.jsx`, `pages/OsPublic.jsx`, `App.jsx` |
| 4. Hubs | Customers (Pipeline board, Leads, Quotes, Inbox), Money (Invoices, Money owed to you, Bills, Cash, outsourced cards), Work (Jobs, Rota, Tasks, Contracts), Team (roster, team chat, the Floor restyled) | `workspace/hubs/*` |
| 5. Record pages | Company, invoice, deal, quote, job, conversation, contact, person and agent pages; breadcrumbs; every reference is a link | `workspace/records/*` |
| 6. Owner and accountant views; Setup | Label maps and column sets per view, persisted; the builder restyled, with a sticky summary footer, hub categories, "Kept in current tools" with a picker, the app drawer, and saving that updates the shell | `workspace/view.js`, `pages/Builder.jsx` |
| 7. Onboarding | `/workspace/start` in five steps, with mocked connectors marked where real ones plug in | `workspace/pages/Start.jsx` |
| 8. QA | Consistency test, banned-string test, cross-link spot check, screenshots at 375, 768, 1280 and 1440px, copy pass, five-minute tap count | `tests/e2e/workspace-qa.mjs`, `docs/QA.md` |
