// Browser test: drives the website's own buttons and forms in Chromium against the local stack
// (mocks, wrangler dev with fresh state, stream listener). Fails on any page error or console error.
// Screenshots of each page go to UI_SHOTS (default: ./ui-shots).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const API = "http://127.0.0.1:8787", MOCK = "http://127.0.0.1:8788";
const SHOTS = process.env.UI_SHOTS || "ui-shots";
mkdirSync(SHOTS, { recursive: true });
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").trim().split("\n").map((l) => { const i = l.indexOf("="); return [l.slice(0, i), JSON.parse(l.slice(i + 1))]; }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
function start(cmd, args, env, name) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.logs = []; p.stdout.on("data", (d) => p.logs.push(String(d))); p.stderr.on("data", (d) => p.logs.push(String(d)));
  p.name = name; procs.push(p); return p;
}
const stopAll = () => { for (const p of procs) try { process.kill(-p.pid, "SIGTERM"); } catch {} };
process.on("exit", stopAll);
async function waitFor(fn, what, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(400); }
  throw new Error("Timed out waiting for " + what);
}
const admin = async (m, p, body, type) => (await fetch(API + "/api/admin" + p, { method: m, headers: { Authorization: "Bearer " + vars.ADMIN_TOKEN, ...(body ? { "Content-Type": type || "application/json" } : {}) }, body: body ? (type ? body : JSON.stringify(body)) : undefined })).json();
const mock = async (m, p, b) => (await fetch(MOCK + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();
const tokenFor = (email) => waitFor(async () => (await admin("GET", "/outbox")).mail.find((x) => x.to_addr === email && x.body.includes("#/sign-in?token="))?.body.match(/token=([A-Za-z0-9_-]+)/)[1], "sign-in email to " + email);

const results = [];
let page;
const errors = [];
let step = "";
async function check(name, fn) { step = name; await fn(); results.push(name); console.log("  pass  " + name); }
const ok = (c, m) => { if (!c) throw new Error(m); };

async function main() {
  const persist = mkdtempSync(join(tmpdir(), "ah-ui-"));
  console.log("Starting mocks, API and stream listener…");
  start("node", ["mocks/server.mjs"], {}, "mocks");
  await waitFor(async () => (await fetch(MOCK + "/health")).ok, "mocks");
  await new Promise((y, n) => { const p = spawn("npx", ["wrangler", "d1", "migrations", "apply", "agent-house", "--local", "--persist-to", persist], { stdio: "ignore" }); p.on("exit", (c) => (c === 0 ? y() : n(new Error("migrations failed")))); });
  start("npx", ["wrangler", "dev", "--local", "--port", "8787", "--ip", "127.0.0.1", "--persist-to", persist], {}, "api");
  await waitFor(async () => (await fetch(API + "/api/health")).ok, "API", 90000);
  start("node", ["apps/stream-listener/listener.mjs"], { STREAM_BASE: MOCK + "/ch-stream", STREAM_KEY: "dev-key", API_URL: API, INGEST_SECRET: vars.INGEST_SECRET, STREAMS: "companies,officers,charges" }, "listener");

  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource: the server responded with a status of (401|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
  // Stripe Checkout is a different site; answer it locally so the redirect can be observed.
  await ctx.route("https://checkout.stripe.example/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stripe Checkout (mock)</h1>" }));
  await ctx.route("https://billing.stripe.example/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stripe portal (mock)</h1>" }));
  const go = async (hash) => { await page.goto(API + "/#" + hash); await page.waitForSelector("#main"); };
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
  const btn = (name) => page.getByRole("button", { name, exact: true }).first().click();
  const text = (t, timeout = 30000) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ timeout });

  const csv = join(persist, "customers.csv");
  writeFileSync(csv, ["Customer,Company number,Postcode,Monthly fee,Next invoice", "Ellacombe Print,,,1450,2026-11-01", "Tarnbrook Logistics,11420987,,900,", "Harlow Vale Studios,,,,", "Corriemoor Interiors,,,,", "Joe Bloggs Plumbing,,,,", "Fenwright Motors,12207718,,,"].join("\n"));
  const invoices = join(persist, "invoices.csv");
  writeFileSync(invoices, ["Invoice,Customer,Email,Amount,Due date", "INV-1001,Quayside Lettings,accounts@quayside.example,£480.00,01/09/2026", "INV-1002,Peel Street Accountants,pay@peelstreet.example,1200,2099-01-01"].join("\n"));
  const runUntil = async (re) => { await page.waitForURL(/#\/workspace\/runs\//); await waitFor(async () => (await page.locator(".ws-titlebar .st").innerText()).match(re), "run to finish", 60000); };
  const hire = async (key, setup) => {
    await go("/workspace/agents/new?t=" + key);
    await page.locator("#h-name").waitFor();
    if (setup) await setup();
    await page.getByRole("button", { name: /^Hire / }).click();
    await text("Hired. It's working for you now.");
  };

  console.log("Flows:");
  await check("public pages render for all three doors; signed-out header offers sign in", async () => {
    await go("/");
    await text("Run your business from one OS.");
    await text("Every area of the business. One place.");
    await page.locator(".hdr-right").getByText("Sign in", { exact: true }).waitFor();
    await shot("01-home");
    for (const [p, t] of [["/agents", "Ready-made roles for your team"], ["/agents/outreach", "Where it fits among the use cases"], ["/agents/client-book-watch", "Customer and supplier watch"], ["/agents/bookings", "Coming soon"], ["/how-it-works", "Get a team that reports to you"], ["/use-cases", "80 jobs an agent can do"], ["/pricing", "Pay per call"], ["/os", "Everything it takes to run a business, in one OS"], ["/trust", "Agents you can leave alone"], ["/developers", "Customers for your tools"], ["/for-agents", "Facts your agent can cite"], ["/health-check", "who are you about to pay"]]) {
      await go(p); await text(t);
    }
    await shot("02-for-agents");
  });

  await check("demo workspace: signed out, approve an email and ask the research agent", async () => {
    await go("/workspace");
    await text("Demo workspace for Brightwork Cleaning");
    await text("things need you.");
    await text("Learned from your edits");
    await shot("03-demo-today");
    await go("/workspace/approvals");
    await page.locator("input[aria-label=Subject]").fill("Cleaning for Peel Street");
    await btn("Approve and send");
    await text("Sent to office@peelstreet.example with your edits");
    await go("/workspace");
    await page.fill("#ask", "Who are the biggest cleaning firms in Salford?");
    await btn("Ask");
    await runUntil(/Done/);
    await text("Demo answer");
  });

  await check("demo Today: approve two drafts in one go, keep a learned rule, add a house rule", async () => {
    await go("/workspace");
    await text("emails to approve");
    const boxes = page.locator(".td-pick");
    const n = await boxes.count();
    for (let i = 2; i < n; i++) await boxes.nth(i).uncheck();
    await btn("Approve 2");
    await text("Sent 2 emails.");
    await page.locator(".td-rule").first().getByRole("button", { name: "Keep" }).click();
    await text("Rule saved. Every agent follows it from now on.");
    await go("/workspace/rules");
    await page.fill("#rule", "Always mention the free first clean");
    await btn("Add");
    await text("Always mention the free first clean");
    await shot("03b-house-rules");
  });

  await check("free customer check: upload a customer list", async () => {
    await go("/health-check");
    await page.fill("#f-name", "Dana Price"); await page.fill("#f-email", "dana@brightwork.example"); await page.fill("#f-company", "Brightwork Cleaning");
    await page.click("button[type=submit]");
    await text("Add your customer list");
    await page.setInputFiles("#f-file", csv);
    await page.click("button[type=submit]");
    await text("List received");
  });

  await check("booking: live slots, book one, confirmation shown", async () => {
    await go("/book-a-call");
    await page.locator(".days button").nth(1).click();
    await page.locator(".times button:not([disabled])").first().click();
    await page.fill("#f-name", "Dana Price"); await page.fill("#f-email", "dana@brightwork.example"); await page.fill("#f-company", "Brightwork Cleaning");
    await page.click("form button[type=submit]");
    await text("A calendar invitation has been sent");
  });

  await check("sign up at /start; the emailed link opens an empty workspace", async () => {
    await go("/start?agent=outreach");
    await text("Put outreach to work");
    await btn("Create my workspace");
    await text("Add your business name");
    await page.fill("#s-biz", "Brightwork Cleaning"); await page.fill("#s-name", "Dana Price"); await page.fill("#s-email", "dana@brightwork.example");
    await page.fill("#s-what", "Commercial and office cleaning on weekly contracts");
    await page.fill("#s-cust", "accountancy and law firms"); await page.fill("#s-area", "central Manchester");
    await btn("Create my workspace");
    await text("Check your email");
    const token = await tokenFor("dana@brightwork.example");
    await go("/sign-in?token=" + token);
    await page.waitForURL(/#\/workspace$/);
    await text("Hire your first agent");
    await page.locator(".hdr-right").getByText("Workspace", { exact: true }).waitFor();
    await shot("04-first-run");
  });

  await check("settings: business profile saved; a Teams channel added and tested", async () => {
    await go("/workspace/settings");
    ok((await page.inputValue("#p-customers")) === "accountancy and law firms", "profile from sign-up");
    await page.fill("#p-tone", "warm and plain"); await page.fill("#p-sign_off", "Dana, Brightwork");
    await btn("Save profile");
    await text("Saved. Agents use the new profile");
    await page.selectOption("#nc-kind", "teams");
    await page.fill("#nc-label", "#team"); await page.fill("#nc-target", MOCK + "/hooks/teams/team");
    await btn("Add channel");
    await text("Channel added");
    await page.getByRole("button", { name: "Send test" }).click();
    await text("Test message sent to #team");
    await shot("05-settings");
  });

  await check("outreach: hire, run now, watch the steps, edit and approve the email; the lead is contacted", async () => {
    const idx = ["CompanyName,CompanyNumber,CompanyStatus,IncorporationDate,RegAddress.PostCode,SICCode.SicText_1",
      "ASHWORTH HALE SOLICITORS LTD,09112783,Active,01/07/2014,M2 4WU,69102 - Solicitors",
      "PEEL STREET ACCOUNTANTS LTD,10284419,Active,15/07/2016,M3 1AA,69201 - Accounting and auditing activities"].join("\n");
    await admin("POST", "/company-index", idx, "text/csv");
    await hire("outreach", async () => {
      ok((await page.inputValue("#h-brief")).includes("accountancy and law firms"), "brief from the profile");
      await page.selectOption("#h-ch", { label: "#team" });
    });
    await shot("06-agent");
    await btn("Run now");
    await runUntil(/Needs you/);
    await text("What it drafted");
    await page.locator(".steps li").first().waitFor();
    await shot("07-run");
    await page.locator(".answer .need").first().click();
    await page.waitForURL(/#\/workspace\/approvals/);
    await page.locator("input[aria-label=Subject]").fill("Office cleaning for Ashworth Hale, Manchester");
    await shot("08-approvals");
    await btn("Approve and send");
    await text("with your edits");
    await waitFor(async () => (await admin("GET", "/outbox")).mail.find((m) => m.subject === "Office cleaning for Ashworth Hale, Manchester"), "approved email sent");
    await go("/workspace/leads");
    await text("Ashworth Hale");
    ok((await page.locator("select[aria-label^='Status for Ashworth' i]").inputValue()) === "contacted", "lead marked contacted");
    await shot("09-leads");
  });

  await check("credit control: invoices uploaded, a reminder drafted and approved", async () => {
    await hire("credit-control", async () => { await page.getByText("Ask me the first time", { exact: true }).click(); });
    await go("/workspace/invoices");
    await page.setInputFiles("#inv-file", invoices);
    await btn("Upload");
    await text("2 added, 0 updated");
    await text("days late");
    await shot("10-invoices");
    await go("/workspace/agents");
    await page.getByRole("link", { name: /Credit control/ }).first().click();
    await btn("Run now");
    await runUntil(/Needs you/);
    await page.locator(".answer .need").first().click();
    await btn("Approve and send");
    await text("Sent to accounts@quayside.example");
  });

  await check("inbox: an enquiry arrives by email; the drafted reply is reviewed and rejected", async () => {
    await hire("inbox");
    await go("/workspace/inbox");
    const to = (await page.locator(".addr b").innerText()).trim();
    const eml = ["From: facilities@quayside.example", `To: ${to}`, "Subject: Quote for weekly office clean", "Message-ID: <q1@quayside.example>", "Content-Type: text/plain", "", "Hi, could you quote for cleaning our 20-desk office twice a week?", ""].join("\r\n");
    ok((await fetch(`${API}/cdn-cgi/handler/email?from=facilities@quayside.example&to=${encodeURIComponent(to)}`, { method: "POST", body: eml })).ok, "inbound accepted");
    await waitFor(async () => { await page.reload(); await page.waitForTimeout(600); return page.getByText("Review the drafted reply").count(); }, "drafted reply", 60000);
    await text("Urgent");
    await shot("11-inbox");
    await page.getByRole("link", { name: "Review the drafted reply" }).click();
    await page.waitForURL(/#\/workspace\/approvals/);
    await btn("Reject");
    await text("Rejected. Nothing was sent.");
  });

  await check("research: ask from the overview; the answer comes with sources", async () => {
    await hire("research");
    await go("/workspace");
    await page.fill("#ask", "What do office cleaners in Manchester charge per hour?");
    await btn("Ask");
    await runUntil(/Done/);
    await text("Sources");
    await shot("12-research");
    await go("/workspace/activity");
    await text("Research");
  });

  await check("customer watch: hire, import customers, confirm the ambiguous row", async () => {
    await hire("customer-watch", async () => { await page.selectOption("#h-ch", { label: "#team" }); });
    await go("/workspace/import");
    await page.setInputFiles("#imp-file", csv);
    await btn("Upload and match");
    await text("Confirm these matches", 60000);
    await page.locator("fieldset.cand label.check").first().click();
    await page.getByRole("button", { name: /^Confirm 1 choice/ }).click();
    await text("1 company added");
    await text("Not found on the register");
    await go("/workspace/clients");
    await text("Tarnbrook");
    await shot("13-customers");
  });

  await check("alerts: a register change arrives; review, reopen and share it", async () => {
    // Wait until the watch has read each customer's register record, so the change has something to compare with.
    await waitFor(async () => { const r = await page.evaluate(() => fetch("/api/ws/clients?per=50").then((x) => x.json())); return r.clients.length >= 3 && r.clients.every((c) => c.status !== "Reading the register"); }, "register records read", 60000);
    await mock("POST", "/control/mutate", { number: "08812234", change: { status: "administration" } });
    await go("/workspace/alerts");
    await waitFor(async () => { await page.reload(); await page.waitForTimeout(700); return page.getByText("Administrators appointed").count(); }, "critical alert", 60000);
    await btn("Mark reviewed");
    await text("Marked reviewed");
    await btn("Move back to open");
    await text("Moved back to open");
    await page.selectOption("#share-to", { label: "#team" });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await text("Sent to #team");
    await shot("14-alerts");
  });

  await check("company check: ambiguous name, pick a candidate, brief completes", async () => {
    await go("/workspace/check");
    await page.fill("#ck-in", "Corriemoor Interiors");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await text("Needs your confirmation");
    await page.getByRole("button", { name: "This one" }).first().click();
    await page.locator(".sheet-sum").getByText("Flags").waitFor();
    await text("Recent briefs");
  });

  await check("the Floor: describe the business, spin up a swarm, brief me, pause an agent, see the board and companies", async () => {
    await go("/floor");
    await page.locator("#fh-desc").waitFor();
    await page.fill("#fh-desc", "We're a recruitment agency in Manchester placing accountants with growing firms.");
    await btn("Design my team");
    await text("Recruitment desk");
    await text("Job scout");
    await shot("15a-floor-preview");
    await btn("Spin it up");
    await page.waitForURL(/#\/floor\/swm_/);
    await page.getByRole("button", { name: /^Job scout:/ }).waitFor();
    await page.getByRole("button", { name: /^Outreach:/ }).waitFor();
    await page.locator(".fl-kpi").first().waitFor();
    await page.click("text=Brief me");
    await page.locator(".cmd-say.t-brief").waitFor();
    await page.fill("#fl-cmd", "pause inbox");
    await page.keyboard.press("Enter");
    await text("Pause Inbox? Confirm on screen.");
    await btn("Yes, pause");
    await waitFor(async () => page.getByRole("button", { name: /^Inbox: Paused/ }).count(), "Inbox paused on the Floor", 20000);
    await shot("15b-floor");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await page.locator(".bd-col").first().waitFor();
    await page.getByRole("button", { name: "Companies", exact: true }).click();
    await text("Ashworth Hale", 15000);
    await page.getByRole("button", { name: "Floor", exact: true }).click();
    await page.getByRole("button", { name: /^Inbox:/ }).click();
    await btn("Resume Inbox");
    await waitFor(async () => !(await page.getByRole("button", { name: /^Inbox: Paused/ }).count()), "Inbox resumed", 20000);
  });

  await check("business OS: open an app, add a record, ask its agent in #finance and see the answer", async () => {
    await go("/workspace/apps");
    await text("118 apps across 17 areas");
    await page.locator(".os-app", { hasText: "Payables" }).first().click();
    await page.getByRole("button", { name: "New entry" }).click();
    await page.fill("#nr-title", "Van lease, November");
    await page.fill("#nr-party", "Lex Vehicle Leasing");
    await page.fill("#nr-amount", "489");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator(".os-drawer").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".os-tr", { hasText: "Van lease, November" }).waitFor();
    await page.fill("#ask-bills-and-payables", "what's due this week?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.waitForURL(/#\/workspace\/messages\?c=/);
    await page.locator(".chat-main .msg-agent").first().waitFor({ timeout: 60000 });
    await text("so far.");
    await shot("17b-os-messages");
  });

  await check("usage and plan: actions counted; choosing Team goes to Stripe Checkout", async () => {
    await go("/workspace/usage");
    await text("Actions used");
    await text("14-day free trial");
    await shot("15-usage");
    await btn("Choose Team");
    await page.waitForURL(/checkout\.stripe\.example/);
  });

  await check("team: invite a viewer, sign out; the viewer can read but not approve or hire", async () => {
    await go("/workspace/settings");
    await page.fill("#inv-email", "sam@brightwork.example");
    await page.selectOption("#inv-role", "viewer");
    await btn("Send invitation");
    await text("Invitation sent to sam@brightwork.example");
    await page.locator("#account").getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(API + "/#/");
    await page.locator(".hdr-right").getByText("Sign in", { exact: true }).waitFor();
    const token = await tokenFor("sam@brightwork.example");
    await go("/sign-in?token=" + token);
    await page.waitForURL(/#\/workspace$/);
    await go("/workspace/approvals?f=all");
    await page.locator(".inbox-item").first().waitFor();
    await text("Sent");
    ok(!(await page.getByRole("button", { name: "Approve and send" }).count()), "no approve button for viewers");
    await go("/workspace/agents");
    await text("Outreach");
    ok(!(await page.getByRole("link", { name: "Hire an agent" }).count()), "no hiring for viewers");
  });

  let devKey;
  await check("developers: get a key, open the dashboard, publish a tool; the secret is shown once", async () => {
    await go("/developers");
    await page.fill("#k-email", "builder@example.dev");
    await btn("Email me a key");
    await text("Your key is on its way");
    devKey = await waitFor(async () => (await admin("GET", "/outbox")).mail.find((m) => m.to_addr === "builder@example.dev")?.body.match(/ah_live_[A-Za-z0-9_-]+/)?.[0], "key email");
    await go("/developers/dashboard");
    await page.fill("#dk", devKey);
    await btn("Open the dashboard");
    await text("Signed in as builder@example.dev");
    await page.fill("#t-slug", "uk-vat-check"); await page.fill("#t-name", "UK VAT number check");
    await page.fill("#t-desc", "Whether a UK VAT number is valid, and the registered business name.");
    await page.fill("#t-ep", MOCK + "/devtool/vat"); await page.fill("#t-price", "4");
    await btn("Send for review");
    await text("Signing secret for uk-vat-check");
    ok(/ahs_/.test(await page.locator(".secret-v").innerText()), "secret shown");
    await text("In review");
    await shot("16-dev-dashboard");
  });

  await check("operator: approve the customer check report and the developer tool", async () => {
    await go("/admin");
    await page.fill("#adm-t", vars.ADMIN_TOKEN); await btn("Continue");
    await text("uk-vat-check");
    await waitFor(async () => { await btn("Refresh"); await page.waitForTimeout(500); return page.getByRole("button", { name: "Approve and send" }).count(); }, "customer check ready", 60000);
    await page.getByRole("button", { name: "Approve and send" }).click();
    await text("Approved and sent");
    await page.fill("input[aria-label='Note for uk-vat-check']", "Looks good.");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await text("uk-vat-check is live");
    await shot("17-admin");
  });

  await check("for agents: the live catalogue includes the new tool; a call with a key reaches it", async () => {
    await go("/for-agents?s=catalogue");
    await text("UK VAT number check");
    await page.getByRole("button", { name: /UK VAT number check/ }).click();
    await text("Input schema");
    const r = await fetch(API + "/v1/tools/uk-vat-check", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + devKey }, body: JSON.stringify({ number: "GB123456789" }) });
    ok(r.status === 200, "tool call " + r.status);
    await go("/developers/dashboard");
    await text("Signed in as builder@example.dev");
    await text("Live");
  });

  await check("phone width: home, agents, workspace and for-agents fit without sideways scroll", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [h, n] of [["/", "18-phone-home"], ["/agents/outreach", "19-phone-agent"], ["/workspace/approvals", "20-phone-approvals"], ["/for-agents", "21-phone-for-agents"], ["/pricing", "22-phone-pricing"]]) {
      await go(h); await page.waitForTimeout(400);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(wide <= 1, `${h} scrolls sideways by ${wide}px`);
      await shot(n);
    }
  });

  ok(errors.length === 0, "Browser errors:\n" + errors.join("\n"));
  await browser.close();
}

main().then(() => { console.log(`\nAll ${results.length} browser flows passed. Screenshots in ${SHOTS}/`); stopAll(); process.exit(0); })
  .catch(async (e) => {
    console.error(`\nFAILED at: ${step}\n${e.stack || e}`);
    if (errors.length) console.error("Browser errors:\n" + errors.join("\n"));
    if (page) await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
    await sleep(1000);
    for (const p of procs) { const tail = p.logs.join("").split("\n").filter((l) => !/^\s*env\./.test(l)).slice(-30).join("\n"); console.error(`\n--- ${p.name} log (tail) ---\n${tail}`); }
    stopAll(); process.exit(1);
  });
