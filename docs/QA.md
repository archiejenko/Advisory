# Workspace QA (Phase 8)

These results are from the demo workspace (signed out, `DEMO=1` build), checked against the brief's definition of done.

**How to run them**

```bash
npm test                    # unit: includes tests/unit/seed.test.ts (the seed reconciles at 21 times across a week)
npm run test:workspace      # builds the demo, then runs tests/e2e/workspace-qa.mjs in Chromium
```

`workspace-qa.mjs` needs no server: it opens `apps/web/dist-demo/index.html` directly. It writes screenshots and `results.json` to `ui-shots/workspace/`. If the installed Playwright has no browser of its own, point it at one with `CHROMIUM_PATH=/path/to/chrome`.

**Result: 41 of 41 checks passed** (42 since the credits merge; see below). The unit suite also passes: 460 tests, 242 of them new in `tests/unit/seed.test.ts`.

---

## 1. Consistency (automated)

The test reads the expected figures from the demo's own store, using the same selectors the screens use. It then checks every place each figure appears:

| Figure | Expected | Where it was checked |
|---|---|---|
| Pending decisions | 10 | Sidebar badge, notifications badge, Home "Needs you" count, number of cards on Home |
| Routine decisions | 4 | "Approve all 4 routine" |
| Overdue total | £2,336.00 | Money header, ageing buckets |
| Overdue invoices | 3 | Money header, late rows in Money owed to you, Invoices "Overdue" filter |
| New leads this week | 6 | Customers header, Leads table |
| Agents | 6 | Team header, roster, Setup summary |
| Apps | 18 | Setup summary, and the tab count across the four hubs |

Approving one decision moves all three badges to 9 together, and Undo returns them all to 10.

The seed itself is checked in `tests/unit/seed.test.ts`, at three times of day on each of seven days, so 21 points in all. At every point it confirms:
- 3 overdue invoices totalling £2,336.00, and INV-1047 at 21 days late with one reminder sent
- £320.00 due in the next 7 days
- 10 decisions, split 4 routine and 6 to review
- 6 new leads, 2 replies (1 today), and Ancoats won this week
- 6 agents and 8 people
- 8 weeks of history
- one trust-ladder prompt
- 2 to 4 leaks
- every link pointing to a record that exists

## 2. Banned strings (automated)

The test scans every workspace route, `/os`, the home page, `/how-it-works` and `/use-cases`. It found no matches for any of these:
- "Partly built", "Records and AI Team", "Some of this runs natively today", "records and the AI Team fill the rest", "The full native screen is still being built" and "Open the full … screen"
- a "Full" status badge
- "entrys", or a lowercase "crm"

To get there, I removed build-status copy from:
- the signed-in Apps pages (`pages/Os.jsx`, `pages/Builder.jsx`)
- the landing page legend (`pages/Home.jsx`)
- the method and use-case pages, where "Partly built" became "Live, growing"

I also fixed the "entrys" plural (`pages/Os.jsx`) and the lowercased "crm".

**Left on purpose:** the operator-only `/admin` page still mentions "roles still being built". It describes what the operator pass unlocks, and no customer sees it.

## 3. Cross-linking (automated)

- In Money owed to you, every customer and every invoice is a link.
- The test spot-checked 20 entity links collected from record pages, and all 20 open a real record:
  - INV-1047, INV-1036 and INV-1031
  - Tarnbrook, Castlefield Dental and Ancoats
  - the Tarnbrook deal, quote, job and call
  - two contacts
  - Rosa, Fern, Theo and Maya
  - Lee and Jordan
  - the Castlefield conversation and the Ancoats quote
- From INV-1047 you can reach Tarnbrook, the job, quote Q-0180, the deal, Rosa and the chase email she sent, all without using the navigation.

## 4. Responsive (automated)

The test opened 36 routes at 375, 768, 1280 and 1440px: 144 screenshots in `ui-shots/workspace/`. At every width it checked that the page doesn't scroll sideways and that no element sits outside the screen, except inside a container that's meant to scroll, such as the pipeline board, tabs or rota.

**Found and fixed during the pass:**
- A long "Outsourced to Kendal & Co Accountants" chip pushed Setup 27px wider than the screen. Chips now wrap inside tiles.
- At 768px the Ask bar was squeezed to its shortcut label. On tablets the Pause label now reads "Pause" and the shortcut hint is hidden.
- There were two nested `<main>` landmarks. The workspace content is now a `div` inside the site's `<main>`.

## 5. Copy pass

- **British English:** the rendered text has no American spellings (organize, color, center, behavior, favorite, analyze, catalog, canceled) and no `$` amounts.
- **Money:** always shown as £1,280.00, with tabular figures. Rounded £87,720 appears only in pipeline and forecast summaries.
- **Dates:** shown the UK way, for example 26 October 2026 or Mon 26 Oct, with times as 5.30pm.
- **Owner view** uses plain words: "Money owed to you", "Bills", "You owe" and "Books".
- **Accountant view**, from the avatar menu:
  - Wording changes to "Receivables", "Payables", "Sales invoices" and "Ledger".
  - Invoices gain Issued, Net and VAT columns.
  - Receivables gains Due date and Payer history.
  - The choice is saved and survives a reload.
- **Empty states:** each one says what will appear there and offers one action, with no jargon. For example: "Nothing needs you. When an agent wants to send, pay or book something, it waits here for your OK."
- **Similar errors fixed:** company names shortened in sentences ("Tarnbrook paid late 4 months running", not "Tarnbrook Logistics Ltd paid…"), the possessive ("Ancoats Architects’ first invoice"), and "Salford Media" corrected to "Salford Quays Media" on the Floor.

## 6. Five-minute test (automated, 375px, touch)

The test cleared the Home queue from 10 decisions to "Nothing needs you" with **8 taps or swipes in about 4 seconds**:

1. Tap "Yes, let Rosa do it" on the trust-ladder prompt. Spinningfields' £400 reminder goes out under the new rule.
2. Tap "Approve all 3 routine".
3. Swipe right to approve the Salford Quays Media reply.
4. Swipe right to pay Northern Janitorial.
5. Swipe right to confirm the Castlefield walk-round.
6. Swipe right to send Tarnbrook's second reminder.
7. Swipe right to send the Peel Street first email.
8. Swipe left to reject the Holcombe reply, so it can be priced again.

Every decision takes one gesture. Editing a draft first takes two taps plus typing ("Edit", then "Approve with edits"). No step needs more than two taps. Reading each preview takes no taps: the first lines show on the card, and one tap opens the rest.

## Other checks

- **Keyboard.** All controls are buttons or links with visible focus rings in primary lavender. On Home, J and K move between cards and A, E and R approve, edit or reject. Ctrl/Cmd+K opens Ask. Drawers and dialogs trap focus, close on Escape and return focus to where it was.
- **Reduced motion.** `prefers-reduced-motion` turns off every transition and animation in the workspace.
- **Contrast.** Every text colour passes WCAG AA on every surface. The figures are in `docs/AUDIT.md` §6; placeholders now use the muted text colour, which passes.
- **Pause agents.** It sits in the top bar at every width. While paused, a banner shows on every screen and agents in chat say they're paused.
- **Undo.** Every action through the store can be undone for 30 seconds from the toast. Recent actions on Home and on agent pages also show Undo while it's still possible.

## The existing browser suite (`tests/e2e/ui.mjs`)

I updated its two signed-out demo checks for the new workspace: edit and approve a decision, ask a question, and approve the routine items then undo. I also updated the `/os` headline it expects. Those checks now pass, along with the public pages, the customer check, booking, sign-up and settings.

**One failure that was already there.** The suite then stops at "outreach: hire, run now…": the signed-in API refuses the run with "Outreach works in apps that aren't in this business's OS". I ran the same suite on the untouched base branch (`hardening-batch-3`):
- It fails at this same check.
- It also fails one step earlier, on its own out-of-date demo check.

So this failure comes from the live workspace and the API, which this overhaul doesn't change. It needs fixing separately.

## Known failures

None. #1 (the signed-in outreach run refused with "Outreach works in apps that aren't in this business's OS") is fixed:
- **The cause:** the sign-up check builds its OS from the Trades pack, which has neither of Outreach's apps (Sequences, Lead generation). Hiring succeeded, but every run was refused.
- **The fix:** hiring an agent now adds the app it works in when the OS has none of them, as a logged OS change (`addAppsFor`, `apps/api/src/lib/osbuilder.ts`). An app the owner has set to outsourced, kept elsewhere or off is left alone, and the hire is refused with a message saying so.
- **Tests:** `tests/unit/osbuilder.test.ts` covers all three cases. In `ui.mjs` the outreach flow is a normal check again, and so is the Floor's Ashworth Hale company.
- **Also fixed:** with the outreach flow running for real, the signed-in suite reached the API's per-business limit (300 requests a minute) by the team check. That check now waits for the window to clear. The limit itself is unchanged.

## Integration branch (`integrate/2026-10-26`)

This branch is `claude/peaceful-bell-mkmpa8` (the workspace overhaul) with `claude/zen-fermat-p87ztx` (credits) merged in.

| Suite | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm test` | 499 passed |
| `npm run test:e2e` (API, local Worker and mocks) | 47 of 47 flows passed |
| `npm run test:workspace` | 42 of 42 checks passed |
| `node tests/e2e/os-check.mjs` (demo build) | 6 of 6 passed |
| `node tests/e2e/ui.mjs` (browser, signed in and out) | 22 of 22 flows passed (21 and 1 known failure before #1 was fixed) |

**What the merge needed:**
- **Credits in the new shell.** Usage and credits opens inside the workspace at `/workspace/setup/usage`, from Setup and from the avatar menu. `/workspace/usage` now redirects there.
  - It shows the same six agents as every other screen.
  - Setup's summary and the Team hub show credits left, in place of the old "actions a month" estimate.
  - Each agent's page has a mode picker and a monthly budget, with undo.
- **Bugs found and fixed:**
  - A redirect from an old address dropped its query string, so `?topup=done` and the top-up confirmation were lost.
  - Signing out from a signed-in workspace page could be overridden by the demo's redirect from that old address, landing you on the demo's Setup. A redirect now only fires if the page is still on the old address.
- **Stale browser checks fixed.** These had been broken since `os-overhaul` but were hidden because #1 stopped the suite first:
  - the run-status selector (`ws-titlebar` became `os-titlebar`)
  - the research box, which now lives on `/workspace/overview`
  - the app count, which moved from 118 apps in 17 areas to 138 in 18
  - the Payables check, now on Invoicing because Payables isn't in the Trades pack (see #1)
- **No team cap.** `monthly_cap` on swarms and agents was never enforced; credits and per-agent budgets are. The API no longer accepts or returns it and the demo no longer carries it, so no screen, signed in or out, shows it.
  - Production had no swarms when checked (0 with a cap), so no carry-over migration was needed.
  - `tests/unit/no-monthly-cap.test.ts` fails if any app source reads it, the Floor test checks the API response leaves it out even when an old row has one, and `workspace-qa.mjs` bans "monthly cap" and "team cap" on every route.
- **`os-check.mjs` moved onto the new shell.** It covers the landing page, `/os`, pricing in credits, Usage with a top-up, agent modes, and phone width. The workspace screens themselves are covered by `workspace-qa.mjs`.

## Known limits

- **Signed-in workspace.** As agreed, customers who sign in still see the existing live workspace. The new workspace runs on the demo store until an API adapter exists.
- **The Floor.** It is the existing screen, shown inside the new shell. It picks up the new tokens through a variable bridge, and an adapter (`workspace/demo/legacy.js`) feeds it from the store so it shows the same six agents and records. Its own layout and type are unchanged.
- **Demo data.** The data is rebuilt each day: it is saved in the browser and re-seeded on a new day, so "21 days late" stays true. Reset demo in the avatar menu restarts it at any time.
- **Bundle size.** The single-file build is 1.29 MB, up from 995 KB, because of the new workspace and the Lucide icons it imports.
