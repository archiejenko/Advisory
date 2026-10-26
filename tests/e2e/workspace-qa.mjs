// Workspace QA (Phase 8), run against the stand-alone demo build: DEMO=1 node apps/web/build.mjs, then
// node tests/e2e/workspace-qa.mjs. No server needed. Fails (exit 1) on any broken check.
//   1. Consistency: every shared figure matches its selector, on every screen that shows it.
//   2. Banned strings: no build-status copy in rendered output.
//   3. Cross-linking: entity references are links, and 20 of them open real records.
//   4. Responsive: every route at 375, 768, 1280 and 1440px, with nothing wider than the screen.
//   5. Copy: American spellings and "entrys"-style slips.
//   6. Five-minute test: clear Home's queue at 375px with touch, counting taps.
// Writes screenshots to ui-shots/workspace/ and a JSON summary to ui-shots/workspace/results.json.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const URL0 = pathToFileURL(ROOT + "apps/web/dist-demo/index.html").href + "#";
const OUT = ROOT + "ui-shots/workspace/";
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  "/workspace", "/workspace/customers", "/workspace/customers/leads", "/workspace/customers/quotes", "/workspace/customers/inbox?c=cv_salford", "/workspace/customers/complaints",
  "/workspace/money", "/workspace/money/owed", "/workspace/money/bills", "/workspace/money/cash",
  "/workspace/work", "/workspace/work/jobs?view=calendar", "/workspace/work/rota", "/workspace/work/tasks", "/workspace/work/contracts", "/workspace/work/safety", "/workspace/work/stock",
  "/workspace/team", "/workspace/team/chat", "/workspace/team/floor", "/workspace/setup", "/workspace/design", "/workspace/start", "/os",
  "/workspace/money/invoices/INV-1047", "/workspace/customers/companies/co_tarnbrook", "/workspace/customers/pipeline/deal_ancoats", "/workspace/customers/quotes/q_ancoats",
  "/workspace/work/jobs/job_tarnbrook", "/workspace/customers/inbox/cv_castlefield", "/workspace/team/agents/agt_credit", "/workspace/team/people/p_sam",
  "/workspace/money/bills/bill_1", "/workspace/work/tasks/task_coshh", "/workspace/customers/contacts/con_1", "/workspace/work/safety/rec_coshh",
];
const BANNED = [/Partly built/i, /Records and AI Team/i, /Some of this runs natively today/i, /records and the AI Team fill the rest/i, /The full native screen is still being built/i, /Open the full .* screen/i, /\bentrys\b/i, /\bcrm\b/];
const AMERICAN = [/\borganiz/i, /\bcolor\b/i, /\bcenter\b/i, /\bbehavior/i, /\bfavorite/i, /\banalyz/i, /\bcatalog\b/i, /\bcanceled\b/i, /\$\d/];

const results = { checks: [], failures: [] };
const ok = (cond, name, detail = "") => { results.checks.push({ name, pass: !!cond, detail }); if (!cond) { results.failures.push(`${name}${detail ? ": " + detail : ""}`); console.log("  ✗ " + name + (detail ? " — " + detail : "")); } };

// CHROMIUM_PATH points at a browser when the installed Playwright has none of its own.
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function page(width, opts = {}) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, hasTouch: width < 768, isMobile: width < 768, ...opts });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") p.errors.push(m.text()); });
  return p;
}
const go = async (p, r) => { await p.goto(URL0 + r); await p.waitForTimeout(450); };

// The figures, worked out in the page by the same selectors the screens use.
let expect;
{
  const p = await page(1280);
  await go(p, "/workspace");
  expect = await p.evaluate(() => { const { getState, q, pounds } = window.__workspace; const S = getState(); return { pending: String(q.pendingCount(S)), overdue: pounds(q.overdueTotal(S)), overdueCount: q.overdueCount(S), leads: String(q.newLeadCount(S)), agents: String(q.agentCount(S)), apps: String(q.appCount(S)) }; });
  ok(expect.pending === "10" && expect.overdue === "£2,336.00" && expect.overdueCount === 3 && expect.leads === "6", "seed headline figures", JSON.stringify(expect));
  await p.context().close();
}
const txt = (p, sel) => p.locator(sel).first().innerText().then((t) => t.trim()).catch(() => "(missing)");

/* ---------- 1. Consistency ---------- */
console.log("1. Consistency");
{
  const p = await page(1280);
  await go(p, "/workspace");
  ok(await txt(p, ".w-side .w-count") === expect.pending, "pending: sidebar badge", await txt(p, ".w-side .w-count"));
  ok(await txt(p, ".w-bell .w-count") === expect.pending, "pending: notifications badge", await txt(p, ".w-bell .w-count"));
  ok(await txt(p, "[data-testid=needs-you-count]") === expect.pending, "pending: Home Needs you", await txt(p, "[data-testid=needs-you-count]"));
  ok(await p.locator("[data-decision]").count() === 10, "pending: Home shows 10 cards", String(await p.locator("[data-decision]").count()));
  ok((await txt(p, "text=/Approve all \\d routine/")).includes("Approve all 4 routine"), "routine: Approve all 4 routine");
  await go(p, "/workspace/money");
  const money = await p.locator(".w-metrics").innerText();
  ok(money.includes(expect.overdue) && money.includes("3 invoices"), "overdue: Money header", money.split("\n").slice(0, 3).join(" "));
  await go(p, "/workspace/money/owed");
  ok((await p.locator(".w-ageing").innerText()).includes(expect.overdue), "overdue: ageing buckets add up");
  ok(await p.locator(".w-table tbody tr:has(.w-chip-risk)").count() === 3, "overdue count: 3 late rows in Money owed to you");
  await go(p, "/workspace/money/invoices?f=overdue");
  ok(await p.locator(".w-table tbody tr").count() === 3, "overdue count: Invoices overdue filter shows 3");
  await go(p, "/workspace/customers");
  const cust = await p.locator(".w-metric").first().innerText();
  ok(cust.includes("New leads this week") && cust.includes(expect.leads), "leads: Customers header", cust.replace(/\n/g, " "));
  await go(p, "/workspace/customers/leads");
  ok(await p.locator(".w-table tbody tr").count() === Number(expect.leads), "leads: Leads table shows 6 new this week");
  await go(p, "/workspace/team");
  const team = await p.locator(".w-metrics").innerText();
  ok(team.includes("Agents\n" + expect.agents), "agents: Team header", team.replace(/\n/g, " "));
  await go(p, "/workspace/team/roster");
  const agentCards = await p.locator(".w-roster").nth(1).locator(".w-person").count();
  ok(String(agentCards) === expect.agents, "agents: roster lists the same number", String(agentCards));
  await go(p, "/workspace/setup");
  ok(await txt(p, "[data-testid=setup-agents]") === expect.agents, "agents: Setup summary", await txt(p, "[data-testid=setup-agents]"));
  ok(await txt(p, "[data-testid=setup-apps]") === expect.apps, "apps: Setup summary", await txt(p, "[data-testid=setup-apps]"));
  let tabs = 0;
  for (const h of ["customers", "money", "work", "team"]) { await go(p, "/workspace/" + h); tabs += await p.locator(".w-tabs .w-tab").count(); }
  ok(String(tabs) === expect.apps, "apps: tabs across the four hubs match Setup", String(tabs));
  // Approving moves every count together.
  await go(p, "/workspace");
  await p.locator("[data-decision=apr_tarnbrook]").getByRole("button", { name: "Approve" }).click();
  await p.waitForTimeout(200);
  const after = [await txt(p, ".w-side .w-count"), await txt(p, ".w-bell .w-count"), await txt(p, "[data-testid=needs-you-count]")];
  ok(after.every((x) => x === "9"), "approving one decision moves every badge to 9", after.join(","));
  await p.locator(".w-toast").getByRole("button", { name: /Undo/ }).click();
  await p.waitForTimeout(200);
  ok(await txt(p, ".w-side .w-count") === "10", "undo puts it back to 10");
  ok(!p.errors.length, "no console errors (consistency)", p.errors.join(" | "));
  await p.context().close();
}

/* ---------- 2, 3, 5. Banned strings, links, copy ---------- */
console.log("2. Banned strings · 3. Cross-links · 5. Copy");
{
  const p = await page(1280);
  const hits = [], us = [];
  for (const r of [...ROUTES, "/", "/how-it-works", "/use-cases"]) {
    await go(p, r);
    const t = await p.evaluate(() => document.body.innerText);
    for (const re of BANNED) if (re.test(t)) hits.push(`${r}: ${t.match(re)[0]}`);
    for (const re of AMERICAN) if (re.test(t)) us.push(`${r}: ${t.match(re)[0]}`);
    const fullBadge = await p.locator(".w-chip, .st, .os-depth").filter({ hasText: /^Full$/ }).count();
    if (fullBadge) hits.push(`${r}: "Full" badge`);
  }
  ok(!hits.length, "no banned strings on any route", hits.join("; "));
  ok(!us.length, "British English in rendered copy", us.join("; "));
  ok(!p.errors.length, "no console errors (all routes)", p.errors.slice(0, 5).join(" | "));

  // Entity references render as links: on record pages, company names and invoice numbers are anchors.
  await go(p, "/workspace/money/owed");
  const plain = await p.evaluate(() => [...document.querySelectorAll(".w-table tbody td:first-child")].filter((td) => !td.querySelector("a")).length);
  ok(plain === 0, "every customer and invoice in Money owed to you is a link");
  // Spot-check 20 links from record pages: each opens a real record.
  const hrefs = new Set();
  for (const r of ["/workspace/money/invoices/INV-1047", "/workspace/customers/companies/co_tarnbrook", "/workspace/team/agents/agt_credit", "/workspace/customers/inbox/cv_castlefield", "/workspace/work/jobs/job_ancoats", "/workspace/team/chat?c=finance"]) {
    await go(p, r);
    for (const h of await p.$$eval("main a.w-reflink, main a.w-agent, main a.w-acard, main a.w-link", (as) => as.map((a) => a.getAttribute("href")))) if (h && /#\/workspace\/[a-z]+\/[a-z]+\//.test(h)) hrefs.add(h);
  }
  const sample = [...hrefs].slice(0, 20);
  const broken = [];
  for (const h of sample) {
    await p.goto(URL0 + h.slice(1)); await p.waitForTimeout(250);
    const h1 = await txt(p, "#main h1");
    if (/isn't here|nothing at this address/i.test(await p.locator("#main").innerText()) || h1 === "(missing)") broken.push(h);
  }
  results.links = sample;
  ok(sample.length >= 20, "found 20 entity links to spot-check", String(sample.length));
  ok(!broken.length, "all 20 spot-checked links open a record", broken.join(", "));
  // INV-1047 reaches Tarnbrook, the job, the quote, the deal, the chase emails and the agent.
  await go(p, "/workspace/money/invoices/INV-1047");
  const inv = await p.$$eval("main a", (as) => as.map((a) => a.getAttribute("href")));
  for (const [name, re] of [["Tarnbrook", /companies\/co_tarnbrook/], ["job", /jobs\/job_tarnbrook/], ["quote", /quotes\/q_tarnbrook/], ["deal", /pipeline\/deal_tarnbrook/], ["Rosa", /agents\/agt_credit/]]) ok(inv.some((h) => re.test(h || "")), `INV-1047 links to ${name}`);
  await p.getByRole("button", { name: "Read the email" }).first().click();
  ok((await p.locator(".w-preview-body").first().innerText()).includes("INV-1047"), "INV-1047 shows the chase email Rosa sent");
  await p.context().close();
}

/* ---------- 4. Responsive ---------- */
console.log("4. Responsive");
{
  const over = [];
  for (const w of [375, 768, 1280, 1440]) {
    const p = await page(w);
    for (const r of ROUTES) {
      await go(p, r);
      const bad = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > vw + 1) return "page scrolls sideways by " + (document.documentElement.scrollWidth - vw) + "px";
        const scrollable = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true; } return false; };
        for (const el of document.querySelectorAll("main *")) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > vw + 1 || r.left < -1) && !scrollable(el) && getComputedStyle(el).position !== "fixed") return `${el.tagName.toLowerCase()}.${el.className} at ${Math.round(r.left)}–${Math.round(r.right)}`;
        }
        return null;
      });
      if (bad) over.push(`${w}px ${r}: ${bad}`);
      await p.screenshot({ path: `${OUT}${w}${r.replace(/[\/?=&]/g, "_")}.png`, fullPage: false });
    }
    ok(!p.errors.length, `no console errors at ${w}px`, p.errors.slice(0, 3).join(" | "));
    await p.context().close();
  }
  results.overflow = over;
  ok(!over.length, "nothing overflows at 375, 768, 1280 or 1440px", over.slice(0, 8).join("; "));
}

/* ---------- 6. Five-minute test ---------- */
console.log("6. Five-minute test (375px, touch)");
{
  const p = await page(375);
  await go(p, "/workspace");
  const t0 = Date.now();
  let taps = 0;
  const log = [];
  const tap = async (loc, why) => { await loc.scrollIntoViewIfNeeded(); await loc.tap(); taps++; log.push(why); await p.waitForTimeout(150); };
  const swipe = async (card, dir, why) => {
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    const y = box.y + 40, x0 = box.x + box.width / 2;
    const cdp = await p.context().newCDPSession(p);
    const pt = (x) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x0) });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x0 + (dir * 160 * i) / 8) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    taps++; log.push(why); await p.waitForTimeout(250);
  };
  // The trust prompt: one tap, and it clears Spinningfields' £400 reminder on its own.
  await tap(p.getByRole("button", { name: /Yes, let Rosa/ }), "trust: let Rosa send reminders under £500");
  await tap(p.getByRole("button", { name: /Approve all \d routine/ }), "approve all routine");
  // Read each "needs a look" card; reject the Holcombe reply to price it again, swipe to approve the rest.
  let guard = 0;
  while ((await p.locator("[data-decision]").count()) > 0 && guard++ < 12) {
    const card = p.locator("[data-decision]").first();
    const id = await card.getAttribute("data-decision");
    if (id === "apr_holcombe") await swipe(card, -1, "swipe left: reject " + id);
    else await swipe(card, 1, "swipe right: approve " + id);
  }
  const left = await p.locator("[data-decision]").count();
  results.fiveMinute = { taps, seconds: Math.round((Date.now() - t0) / 1000), steps: log, left };
  ok(left === 0, "five-minute test: queue cleared on a phone", `${left} left`);
  ok(taps <= 2 + 6, "five-minute test: at most one tap per decision, plus two", `${taps} taps`);
  ok((await p.locator("text=Nothing needs you").count()) === 1, "five-minute test: Home says nothing needs you");
  await p.screenshot({ path: OUT + "five-minute-done.png" });
  ok(!p.errors.length, "no console errors (five-minute test)", p.errors.join(" | "));
  await p.context().close();
}

await b.close();
writeFileSync(OUT + "results.json", JSON.stringify(results, null, 2));
const passed = results.checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${results.checks.length} checks passed. Screenshots in ui-shots/workspace/.`);
process.exit(results.failures.length ? 1 : 0);
