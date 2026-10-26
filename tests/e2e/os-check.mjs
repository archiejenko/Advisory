// Stage 3 of the OS check: walk the demo build in Chromium. The landing page tells the OS story, /os explains the
// four hubs, pricing is in credits, and inside the demo workspace Usage shows credits and each agent has a mode.
// The workspace screens themselves are covered by tests/e2e/workspace-qa.mjs. Fails on any page error.
// Run after `npm --prefix apps/web run build:demo`: node tests/e2e/os-check.mjs
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FACETS } from "../../packages/core/os.ts";

const SHOTS = process.env.UI_SHOTS || "ui-shots";
mkdirSync(SHOTS, { recursive: true });
const FILE = "file://" + fileURLToPath(new URL("../../apps/web/dist-demo/index.html", import.meta.url));
const results = [], errors = [];
let step = "";
const ok = (c, m) => { if (!c) throw new Error(m); };
async function check(name, fn) { step = name; const t0 = Date.now(); await fn(); results.push(name); console.log(`  pass  ${name} (${Date.now() - t0} ms)`); }

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
page.on("pageerror", (e) => errors.push(`pageerror on ${step}: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console on ${step}: ${m.text()}`); });
const go = async (hash) => { await page.goto(FILE + "#" + hash); await page.waitForSelector("#main"); };
const text = (t, timeout = 15000) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ timeout });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

try {
  console.log("Stage 3: the OS in the browser (demo build)");
  await check("landing page leads with the business OS", async () => {
    await go("/");
    await text("The all-in-one business operating system, powered by an agentic future.");
    await text("Build the OS your business actually runs on.");
    await text("Then your AI Team runs it.");
    await text("Start from your industry, then change anything.");
    ok((await page.locator(".lp-cat").count()) === 10, "all ten categories on the landing page");
    ok((await page.title()).includes("all-in-one business operating system"), "page title: " + (await page.title()));
    await shot("os-01-landing");
  });
  await check("/os explains the four hubs, the money loop and the agents", async () => {
    await go("/os");
    await text("Your agents do the work. You decide, ask and see.");
    await text("The money loop");
    for (const h of ["Customers", "Money", "Work", "Team"]) ok(await page.locator("h2", { hasText: h }).count(), `hub ${h}`);
    ok(!(await page.locator("body").innerText()).match(/Partly built|Records and AI Team/), "no build status on /os");
    await shot("os-02-map");
  });
  await check("pricing is per business, with the whole OS on every plan, priced in credits", async () => {
    await go("/pricing");
    await text("One price for the whole business");
    await text("Plans differ in how many credits the AI Team gets each month");
    await text("Up to 100 AI Team members");
    await text(`All ${FACETS.length} apps`);
    for (const [plan, price, credits] of [["Starter", "£79", "1,500"], ["Growth", "£249", "5,000"], ["Business", "£599", "12,000"]]) {
      const card = page.locator(".plan", { hasText: price });
      ok((await card.count()) === 1 && (await card.innerText()).includes(plan) && (await card.innerText()).includes(`${credits} credits a month`), `${plan} card`);
    }
    ok((await page.locator(".plan.is-pick").innerText()).includes("Most chosen"), "Growth is most chosen");
    await text("Choose the right mind for the job");
    ok((await page.locator(".mode-card").count()) === 4, "four modes");
    for (const m of ["Runs on Haiku", "Runs on Sonnet", "Runs on Opus", "Runs on Fable"]) await text(m);
    await text("Prices before VAT. 14 days free with 150 credits, no card. Top up anytime at £35 per 1,000 credits, or the AI Team pauses until the 1st — nothing is charged without your say-so.");
    for (const q of ["What's a credit?", "Which mode should I use?", "What happens when I run out?", "Do unused credits roll over?"]) await text(q);
    ok(!(await page.locator("body").innerText()).match(/\bactions a month\b/i), "no action allowances left");
    await shot("os-02b-pricing");
    await go("/");
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await text("1,500 credits a month");
    await text("Choose the right mind for the job.");
  });
  await check("usage: credits left, by agent and by mode, the ledger, a cheaper-mode tip and a top-up, inside the workspace", async () => {
    await go("/workspace/setup/usage");
    await page.locator(".w-shell").waitFor();
    await text("Usage and credits");
    await text("Credits left");
    await text("Plan credits reset");
    await text("By mode");
    await text("Theo runs on Deep; Quick would likely do the job and save ~");
    for (const n of ["Maya", "Rosa", "Fern", "Owen", "Bea"]) ok(await page.locator("table").getByText(n, { exact: true }).count(), `${n} in Usage by agent`);
    ok((await page.locator("table.ledger").last().locator("tbody tr").count()) > 20, "the ledger lists the month's entries");
    await shot("os-02c-usage");
    const before = await page.locator(".stat-row > div").first().locator("b").innerText();
    await page.getByRole("button", { name: "Top up", exact: true }).click();
    await text("Your 1,000 credits arrive as soon as the payment clears");
    const want = (Number(before.replace(/,/g, "")) + 1000).toLocaleString("en-GB");
    await page.locator(".stat-row > div").first().locator("b", { hasText: want }).waitFor({ timeout: 5000 }).catch(async () => {
      throw new Error(`top-up adds 1,000 (${before} -> ${await page.locator(".stat-row > div").first().locator("b").innerText()})`);
    });
    await go("/workspace/usage");
    await page.waitForURL(/#\/workspace\/setup\/usage$/);
  });
  await check("modes: an agent's page shows its mode and model; switching mode is saved and can be undone", async () => {
    await go("/workspace/team/agents/agt_cs");
    await text("Mode and credits");
    await text("Runs on Deep");
    await page.getByRole("radio").nth(0).check();
    await text("Theo now runs on Quick.");
    await text("Runs on Quick");
    await page.locator(".w-toast").getByRole("button", { name: /Undo/ }).click();
    await text("Runs on Deep");
    await shot("os-02d-agent-mode");
  });
  await check("phone width: landing, pricing, /os and Usage fit without sideways scroll", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [h, n] of [["/", "os-06-phone-home"], ["/pricing", "os-06b-phone-pricing"], ["/workspace/setup/usage", "os-06c-phone-usage"], ["/os", "os-07-phone-map"]]) {
      await go(h); await page.waitForTimeout(300);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(wide <= 1, `${h} scrolls sideways by ${wide}px`);
      await shot(n);
    }
  });
  ok(errors.length === 0, "Browser errors:\n" + errors.join("\n"));
  console.log(`\nStage 3 passed: ${results.length} checks.`);
  await browser.close();
} catch (e) {
  console.error(`\nFAILED at: ${step}\n${e.stack || e}`);
  if (errors.length) console.error("Browser errors:\n" + errors.join("\n"));
  await page.screenshot({ path: `${SHOTS}/os-failure.png`, fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(1);
}
