// Stage 3 of the OS check: walk the demo build in Chromium. The landing page tells the OS story, the public
// map lists every app, the launcher shows all of them, every one of the 118 module screens opens with its
// records, form and agent, and a question to an agent in Messages gets an answer. Fails on any page error.
// Run after `npm --prefix apps/web run build:demo`: node tests/e2e/os-check.mjs
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FACETS, AREAS, KINDS } from "../../packages/core/os.ts";

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
  await check("the public map lists every app, and filters by area", async () => {
    await go("/os");
    await text("Everything it takes to run a business, in one OS");
    ok((await page.locator(".osp-row").count()) === FACETS.length, "every app on /os");
    await page.selectOption("#osp-a", "F");
    ok((await page.locator(".osp-row").count()) === FACETS.filter((f) => f.area === "F").length, "area filter");
    await shot("os-02-map");
  });
  await check("pricing is per business, with the whole OS on every plan", async () => {
    await go("/pricing");
    await text("One price for the whole business");
    await text("Up to 100 agents");
    await text(`All ${FACETS.length} apps`);
  });
  await check("the launcher shows all 118 apps by area; search narrows them", async () => {
    await go("/workspace/apps");
    await text(`${FACETS.length} apps across ${AREAS.length} areas`);
    ok((await page.locator(".os-app").count()) === FACETS.length, "every app tile");
    ok((await page.locator(".os-area").count()) === AREAS.length, "every area");
    await page.fill("#os-q", "payroll");
    await page.waitForTimeout(100);
    ok((await page.locator(".os-app").count()) >= 1 && (await page.locator(".os-app").count()) < 10, "search");
    await shot("os-03-apps");
  });
  await check(`every one of the ${FACETS.length} module screens opens with its records, its kind and its agent`, async () => {
    for (const f of FACETS) {
      step = "module " + f.key;
      await go("/workspace/app/" + f.key);
      await page.locator(".ws-titlebar, h1").filter({ hasText: f.app }).first().waitFor({ timeout: 10000 });
      await page.locator(".os-table, .os-empty").first().waitFor({ timeout: 10000 });
      await text(f.name);
      if (f.agent) await page.locator(".os-agent").getByText(f.agent, { exact: true }).waitFor({ timeout: 5000 });
      else await text("People only");
      const chips = await page.locator(".os-filter .os-chip").count();
      ok(chips === KINDS[f.kind].statuses.length + 1, `${f.key}: status filters ${chips}`);
      if (f.link) ok(await page.getByText(`Open the full ${f.app.toLowerCase()} screen`).count(), `${f.key}: link to its full screen`);
    }
  });
  await check("a module: add a record, open it, change its status, talk in its thread", async () => {
    await go("/workspace/app/complaints");
    await page.getByRole("button", { name: "New case" }).click();
    await page.fill("#nr-title", "Missed bins at Holcombe Legal");
    await page.fill("#nr-party", "Holcombe Legal");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator(".os-drawer").waitFor();
    await page.selectOption("#rd-status", "open");
    await page.locator(".os-drawer").getByRole("button", { name: "Save", exact: true }).click();
    await text("Saved.");
    await page.locator(".os-drawer .composer textarea").fill("@Complaints triage what should we offer?");
    await page.locator(".os-drawer").getByRole("button", { name: "Send" }).click();
    await page.locator(".os-drawer .msg-agent").first().waitFor({ timeout: 10000 });
    await shot("os-04-record");
    await page.keyboard.press("Escape");
    await page.locator(".os-tr", { hasText: "Missed bins at Holcombe Legal" }).waitFor();
  });
  await check("Messages: people and agents in channels; an @mention gets an answer back", async () => {
    await go("/workspace/messages");
    await text("Morning all.");
    await page.getByRole("link", { name: /# finance/ }).click();
    await text("what do we owe this week?");
    await page.locator(".composer textarea").fill("@Pay");
    await page.locator(".composer-sug").getByRole("option", { name: /^Payables agent/ }).click();
    await page.locator(".composer textarea").type("anything overdue?");
    await page.getByRole("button", { name: "Send" }).click();
    await waitAgentReplies(2);
    await shot("os-05-messages");
  });
  await check("ask a module's agent from its screen; the answer arrives in the area's channel", async () => {
    await go("/workspace/app/bills-and-payables");
    await page.fill("#ask-bills-and-payables", "what's due before Friday?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.waitForURL(/#\/workspace\/messages\?c=/);
    await text("what's due before Friday?");
    await waitAgentReplies(3);
  });
  await check("tasks: one list for people and agents, each given to someone", async () => {
    await go("/workspace/tasks");
    await text("for Priya Shah");
    await page.fill("#t-title", "Book the van service");
    await page.selectOption("#t-who", { label: "Sam Okafor" });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await text("Book the van service");
    await text("for Sam Okafor");
  });
  await check("phone width: landing, apps, a module and messages fit without sideways scroll", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [h, n] of [["/", "os-06-phone-home"], ["/os", "os-07-phone-map"], ["/workspace/apps", "os-08-phone-apps"], ["/workspace/app/payroll", "os-09-phone-module"], ["/workspace/messages", "os-10-phone-messages"]]) {
      await go(h); await page.waitForTimeout(300);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(wide <= 1, `${h} scrolls sideways by ${wide}px`);
      await shot(n);
    }
  });
  ok(errors.length === 0, "Browser errors:\n" + errors.join("\n"));
  console.log(`\nStage 3 passed: ${results.length} checks, ${FACETS.length} module screens opened.`);
  await browser.close();
} catch (e) {
  console.error(`\nFAILED at: ${step}\n${e.stack || e}`);
  if (errors.length) console.error("Browser errors:\n" + errors.join("\n"));
  await page.screenshot({ path: `${SHOTS}/os-failure.png`, fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(1);
}

async function waitAgentReplies(n) {
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) { if ((await page.locator(".chat-main .msg-agent").count()) >= n) return; await page.waitForTimeout(300); }
  throw new Error(`expected ${n} agent messages in the channel`);
}
