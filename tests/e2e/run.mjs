// End-to-end: starts the mocks, the API (wrangler dev, fresh local state) and the stream listener,
// then drives every flow the website's buttons rely on. Exits non-zero on the first failure.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
const require_fs = () => fs;
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto as wc, createHmac } from "node:crypto";
import { seedLocalStore, devVars } from "../../scripts/local-store.mjs";

const API = "http://127.0.0.1:8787", MOCK = "http://127.0.0.1:8788";
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").trim().split("\n").map((l) => { const i = l.indexOf("="); return [l.slice(0, i), JSON.parse(l.slice(i + 1))]; }));
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let step = "";

function start(cmd, args, env = {}, name) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.logs = [];
  p.stdout.on("data", (d) => p.logs.push(String(d)));
  p.stderr.on("data", (d) => p.logs.push(String(d)));
  p.name = name; procs.push(p); return p;
}
function stopAll() { for (const p of procs) try { process.kill(-p.pid, "SIGTERM"); } catch {} }
process.on("exit", stopAll);

async function waitFor(fn, what, ms = 60000, every = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(every); }
  throw new Error("Timed out waiting for " + what);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function check(name, fn) {
  step = name; const t0 = Date.now();
  await fn();
  results.push([name, Date.now() - t0]);
  console.log("  pass  " + name);
}

/* ---------- HTTP helpers ---------- */
let cookie = "";
async function call(method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.cookie !== false && (opts.cookie || cookie)) headers.Cookie = opts.cookie || cookie;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined && typeof body === "string") { payload = body; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const res = await fetch(API + path, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (m, p, b, h = {}) => call(m, "/api/admin" + p, b, { headers: { Authorization: "Bearer " + vars.ADMIN_TOKEN, ...h }, cookie: false });
const mock = async (m, p, b) => (await fetch(MOCK + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json();
const outbox = async () => (await admin("GET", "/outbox")).json.mail;
async function linkFor(email, kind = "sign-in") {
  const m = await waitFor(async () => (await outbox()).find((x) => x.to_addr === email && x.body.includes("#/sign-in?token=")), "sign-in email to " + email);
  return m.body.match(/token=([A-Za-z0-9_-]+)/)[1];
}
async function signIn(email) {
  const token = await linkFor(email);
  const r = await call("POST", "/api/auth/session", { token }, { cookie: false });
  ok(r.status === 200, "session failed: " + r.text);
  const sc = r.headers.get("set-cookie");
  ok(sc && sc.includes("HttpOnly"), "session cookie must be HttpOnly");
  return sc.split(";")[0];
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
async function stripeEvent(ev) {
  const payload = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
  const key = await wc.subtle.importKey("raw", new TextEncoder().encode(vars.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await wc.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`))).toString("hex");
  return call("POST", "/api/webhooks/stripe", payload, { cookie: false, headers: { "Stripe-Signature": `t=${t},v1=${sig}`, "Content-Type": "application/json" } });
}

/* ---------- Main ---------- */
async function main() {
  const persist = mkdtempSync(join(tmpdir(), "ah-e2e-"));
  for (const port of [8787, 8788]) { try { await fetch(`http://127.0.0.1:${port}/`); throw new Error(`Port ${port} is already in use. Stop the dev servers first.`); } catch (e) { if (String(e.message).startsWith("Port")) throw e; } }
  console.log("Starting mocks, API and stream listener…");
  start("node", ["mocks/server.mjs"], {}, "mocks");
  await waitFor(async () => (await fetch(MOCK + "/health")).ok, "mocks");
  await new Promise((ok2, bad) => { const p = spawn("npx", ["wrangler", "d1", "migrations", "apply", "agent-house", "--local", "--persist-to", persist], { stdio: "ignore" }); p.on("exit", (c) => (c === 0 ? ok2() : bad(new Error("migrations failed")))); });
  seedLocalStore(persist, devVars()); // Secrets Store bindings shadow .dev.vars locally
  start("npx", ["wrangler", "dev", "--local", "--port", "8787", "--ip", "127.0.0.1", "--test-scheduled", "--persist-to", persist], {}, "api");
  await waitFor(async () => (await fetch(API + "/api/health")).ok, "API", 90000);
  start("node", ["apps/stream-listener/listener.mjs"], { STREAM_BASE: MOCK + "/ch-stream", STREAM_KEY: "dev-key", API_URL: API, INGEST_SECRET: vars.INGEST_SECRET, STREAMS: "companies,officers,charges" }, "listener");

  const companies = (await mock("GET", "/control/companies")).companies;
  const seeded = companies.filter((c) => /^\d{8}$/.test(c.number) && !["08812234", "11420987", "06173520", "12207718", "13985402", "10833126", "12940577", "09112783"].includes(c.number));
  const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bLtd\b/, "Ltd");

  console.log("Flows:");
  /* 1. Health check, end to end, with the approval guardrail */
  let hcToken;
  await check("health check: upload, match, report held for approval, approve, email, report page", async () => {
    const rows = [["Client", "Postcode"], ["Ellacombe Print", ""], ["Tarnbrook Logistics", ""], ["Harlow Vale Studios", ""], ["Corriemoor Interiors", ""], ["Joe Bloggs Plumbing", ""], ...seeded.slice(0, 6).map((c) => [titleCase(c.name), c.postcode])];
    const fd = new FormData();
    fd.set("name", "Sam Owner"); fd.set("email", "sam@northgate.example"); fd.set("company", "Northgate IT Services");
    fd.set("file", new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }), "clients.csv");
    const r = await call("POST", "/api/public/health-checks", fd, { cookie: false });
    ok(r.status === 202, "upload: " + r.text);
    const hc = await waitFor(async () => (await admin("GET", "/health-checks")).json.health_checks.find((h) => h.id === r.json.id && h.status === "awaiting_approval"), "report ready", 90000);
    const s = JSON.parse(hc.summary);
    ok(s.sent === 11 && s.unmatched >= 1 && s.confirm >= 1 && s.flagged >= 1, "summary: " + hc.summary);
    const before = await outbox();
    ok(!before.some((m) => m.to_addr === "sam@northgate.example" && m.subject.startsWith("Your client book health check")), "report must not be sent before approval");
    const ap = await admin("POST", `/health-checks/${hc.id}/approve`);
    ok(ap.status === 200, "approve: " + ap.text);
    hcToken = ap.json.link.split("/r/")[1];
    const page = await call("GET", "/r/" + hcToken, undefined, { cookie: false });
    ok(page.status === 200 && page.text.includes("Accounts overdue") && page.text.includes("For you to confirm"), "report page content");
    ok(!/\bverified\b|\bsafe to\b/i.test(page.text), "report uses verdict words");
  });

  /* 2. Pilot org, sign-in, roles */
  await check("operator creates a pilot workspace; owner signs in with a magic link", async () => {
    const r = await admin("POST", "/orgs", { name: "Northgate IT Services", owner_email: "owner@northgate.example", owner_name: "Owner" });
    ok(r.status === 201, r.text);
    cookie = await signIn("owner@northgate.example");
    const me = await call("GET", "/api/ws/me");
    ok(me.status === 200 && me.json.role === "owner" && me.json.org.name === "Northgate IT Services", me.text);
    ok((await call("GET", "/api/ws/me", undefined, { cookie: false })).status === 401, "signed-out access must fail");
  });

  /* 3. Channels and agents */
  let teams, slack;
  await check("channels: add Teams, Slack and email; test message arrives; agent settings saved", async () => {
    teams = (await call("POST", "/api/ws/channels", { kind: "teams", label: "#client-health", target: MOCK + "/hooks/teams/client-health" })).json.id;
    slack = (await call("POST", "/api/ws/channels", { kind: "slack", label: "#accounts", target: MOCK + "/hooks/slack/accounts" })).json.id;
    const email = await call("POST", "/api/ws/channels", { kind: "email", label: "Finance", target: "finance@northgate.example" });
    ok(teams && slack && email.status === 201, "channels created");
    const t = await call("POST", `/api/ws/channels/${teams}/test`);
    ok(t.json.status === "sent", t.text);
    const cap = (await mock("GET", "/control/captured")).captured;
    ok(cap.some((c) => c.target === "/hooks/teams/client-health" && c.body.attachments?.[0]?.contentType === "application/vnd.microsoft.card.adaptive"), "Teams adaptive card captured");
    const a = await call("PATCH", "/api/ws/agents/watch", { channel_id: teams, digest: "daily" });
    ok(a.status === 200, a.text);
    const ag = (await call("GET", "/api/ws/agents")).json.agents.find((x) => x.key === "watch");
    ok(ag.channel_id === teams && ag.digest === "daily", "agent saved");
    const listed = (await call("GET", "/api/ws/channels")).json.channels;
    ok(listed.length === 3 && !JSON.stringify(listed).includes("/hooks/"), "webhook URLs must never be returned");
  });

  /* 4. Import and confirm */
  await check("client import: upload, match, confirm the uncertain one, clients listed", async () => {
    const rows = [["Client name", "Company number", "Monthly fee", "Next invoice date", "Users"],
      ["Ellacombe Print", "08812234", "1450", "2026-11-01", "18"], ["Tarnbrook Logistics", "", "900", "2026-11-01", "14"], ["Brackenvale Dental", "", "650", "", ""],
      ["Fenwright Motors", "12207718", "", "", ""], ["Corriemoor Interiors", "", "", "", ""], ["Joe Bloggs Plumbing", "", "", "", ""],
      ...seeded.slice(0, 20).map((c) => [titleCase(c.name), c.number, "", "", ""])];
    const fd = new FormData();
    fd.set("file", new Blob([rows.map((r) => r.join(",")).join("\n")]), "book.csv");
    const r = await call("POST", "/api/ws/imports", fd);
    ok(r.status === 202, r.text);
    const imp = await waitFor(async () => { const x = (await call("GET", "/api/ws/imports/" + r.json.id)).json; return x.status === "needs_confirmation" && x; }, "import matched", 90000);
    ok(imp.total === 26 && imp.to_confirm === 1 && imp.unmatched === 1, JSON.stringify(imp));
    const row = imp.rows.find((x) => x.confidence === "confirm");
    ok(row.candidates.length === 2, "two candidates for Corriemoor");
    const cf = await call("POST", `/api/ws/imports/${r.json.id}/confirm`, { choices: [{ row: row.row, number: "10833126" }] });
    ok(cf.status === 200 && cf.json.added === 1, cf.text);
    const bad = await call("POST", `/api/ws/imports/${r.json.id}/confirm`, { choices: [{ row: row.row, number: "99999999" }] });
    ok(bad.status === 400, "choosing a non-candidate must fail");
    const list = await call("GET", "/api/ws/clients?per=100");
    ok(list.json.total === 25, "25 clients: " + list.json.total);
    const s = await call("GET", "/api/ws/clients?q=tarn");
    ok(s.json.total === 1 && s.json.clients[0].number === "11420987", "search by name");
    await waitFor(async () => (await call("GET", "/api/ws/clients/08812234")).json.record, "baseline read of Ellacombe", 60000);
    await waitFor(async () => (await call("GET", "/api/ws/clients/06173520")).json.record && (await call("GET", "/api/ws/clients/12207718")).json.record, "baselines", 60000);
  });

  /* 5. Stream event to alert */
  let critical;
  await check("stream: administration event becomes a Critical alert, sent to Teams at once", async () => {
    await mock("POST", "/control/mutate", { number: "08812234", change: { status: "administration" } });
    critical = await waitFor(async () => (await call("GET", "/api/ws/alerts")).json.alerts.find((a) => a.number === "08812234" && a.check === "status"), "critical alert", 60000);
    ok(critical.severity === "Critical" && critical.title === "Administrators appointed", JSON.stringify(critical));
    ok(critical.facts.some(([k, v]) => k === "Next invoice" && v.includes("£1,450")), "invoice fact from the import");
    await waitFor(async () => (await mock("GET", "/control/captured")).captured.some((c) => c.target === "/hooks/teams/client-health" && JSON.stringify(c.body).includes("Administrators appointed")), "Teams card for the alert", 30000);
  });

  await check("Gazette poller: insolvency notice becomes a second Critical alert", async () => {
    await mock("POST", "/control/mutate", { number: "08812234", change: { gazette: { category: "Corporate insolvency: appointment of administrators", title: "Appointment of administrators" } } });
    const r = await admin("POST", "/run/gazette");
    ok(r.json.result === 1, "one notice ingested: " + r.text);
    await waitFor(async () => (await call("GET", "/api/ws/alerts")).json.alerts.find((a) => a.check === "insolvency"), "insolvency alert", 60000);
  });

  await check("Review alerts wait for the digest; the digest goes to Teams", async () => {
    await mock("POST", "/control/mutate", { number: "06173520", change: { officer_resigned: true, officer_appointed: "JONES, Pat" } });
    await mock("POST", "/control/mutate", { number: "12207718", change: { charge: "Northern Bank plc" } });
    await waitFor(async () => { const a = (await call("GET", "/api/ws/alerts")).json.alerts; return a.some((x) => x.check === "officers") && a.some((x) => x.check === "charges"); }, "review alerts", 60000);
    const cap1 = (await mock("GET", "/control/captured")).captured;
    ok(!cap1.some((c) => JSON.stringify(c.body).includes("Director changed")), "review alerts must not be sent at once");
    await admin("POST", "/run/digests");
    await waitFor(async () => (await mock("GET", "/control/captured")).captured.some((c) => c.target === "/hooks/teams/client-health" && JSON.stringify(c.body).includes("changes to review")), "digest", 30000);
  });

  await check("reconciliation re-reads every watched company and finds nothing new", async () => {
    const before = (await call("GET", "/api/ws/alerts?state=all")).json.counts.all;
    const r = await admin("POST", "/run/reconcile?all=1");
    ok(r.json.result === 25, "25 watched: " + r.text);
    await sleep(6000);
    const after = (await call("GET", "/api/ws/alerts?state=all")).json.counts.all;
    ok(after === before, `reconcile must not duplicate alerts (${before} -> ${after})`);
  });

  /* 6. Alert actions */
  await check("alerts: mark reviewed and reopen; counts follow; share to Slack", async () => {
    const r = await call("PATCH", `/api/ws/alerts/${critical.id}`, { state: "reviewed" });
    ok(r.status === 200, r.text);
    const c = (await call("GET", "/api/ws/alerts")).json.counts;
    ok(c.reviewed === 1, JSON.stringify(c));
    ok((await call("GET", "/api/ws/alerts?state=reviewed")).json.alerts[0].reviewed_by === "owner@northgate.example", "reviewer recorded");
    await call("PATCH", `/api/ws/alerts/${critical.id}`, { state: "open" });
    ok((await call("GET", "/api/ws/alerts")).json.counts.reviewed === 0, "reopened");
    const sh = await call("POST", `/api/ws/alerts/${critical.id}/share`, { channel_id: slack });
    ok(sh.status === 202, sh.text);
    await waitFor(async () => (await mock("GET", "/control/captured")).captured.some((c) => c.target === "/hooks/slack/accounts" && c.body.blocks), "Slack message", 30000);
  });

  /* 7. Client record */
  await check("client record: register history with alerts, pause and resume watching", async () => {
    const r = (await call("GET", "/api/ws/clients/08812234")).json;
    ok(r.record.status === "In administration" && r.record.fields.status.source === "Companies House" && r.record.fields.status.retrieved_at, "sourced record");
    ok(r.history.some((h) => h.alert?.title === "Administrators appointed"), "history links alert");
    ok(r.client.monthly_fee === 1450 && r.client.next_invoice === "2026-11-01", "relationship facts from import");
    await call("PATCH", "/api/ws/clients/08812234", { watching: false });
    ok((await call("GET", "/api/ws/clients?q=ellacombe")).json.clients[0].watching === false, "paused");
    await call("PATCH", "/api/ws/clients/08812234", { watching: true });
  });

  /* 8. Briefs */
  await check("new-client brief: clean company, flagged company, and an ambiguous name", async () => {
    const ra = await call("POST", "/api/ws/briefs", { input: "Harlow Vale Studios" });
    ok(ra.status === 201, "brief: " + ra.text);
    const a = ra.json.brief;
    ok(a.status === "matched" && a.flags.length === 0 && a.rows.length === 9 && a.signature.startsWith("ed25519:"), JSON.stringify(a).slice(0, 200));
    const b = (await call("POST", "/api/ws/briefs", { input: "Tarnbrook Logistics, invoice INV-2207" })).json.brief;
    ok(b.status === "matched" && b.flags.some((f) => f.text === "Accounts overdue"), "flagged brief");
    const c = (await call("POST", "/api/ws/briefs", { input: "Corriemoor Interiors" })).json.brief;
    ok(c.status === "needs_human_confirmation" && c.candidates.length === 2, "ambiguous brief");
    ok((await call("GET", "/api/ws/briefs")).json.briefs.length === 3, "briefs stored");
  });

  /* 9. Usage */
  await check("usage: totals, per-client cost share, rebilling markup, CSV export", async () => {
    await call("PATCH", "/api/ws/org", { markup_pct: 100 });
    const u = (await call("GET", "/api/ws/usage")).json;
    ok(u.clients === 25 && u.cost_pence === 19900 && u.rebill_pence === 39800 && u.alerts >= 4 && u.briefs === 3, JSON.stringify({ ...u, per_client: undefined, weeks: undefined }));
    const csv = await call("GET", "/api/ws/usage/export");
    ok(csv.status === 200 && csv.headers.get("content-type").includes("text/csv") && csv.text.startsWith("Client,Company no.,Alerts"), csv.text.slice(0, 80));
    ok(csv.text.includes("Ellacombe"), "CSV rows");
  });

  await check("client book: add one client by number; duplicates and unknown numbers refused", async () => {
    const extra = seeded[30];
    const r = await call("POST", "/api/ws/clients", { number: extra.number });
    ok(r.status === 201 && r.json.name, r.text);
    ok((await call("GET", "/api/ws/clients?q=" + extra.number)).json.total === 1, "listed");
    ok((await call("POST", "/api/ws/clients", { number: "12207718" })).status === 409, "duplicate refused");
    ok((await call("POST", "/api/ws/clients", { number: "99999999" })).status === 404, "unknown number refused");
    ok((await call("POST", "/api/ws/clients", { number: "12" })).status === 400, "bad number refused");
    const cfg = await call("GET", "/api/public/config", undefined, { cookie: false });
    ok(cfg.status === 200 && "turnstile_site_key" in cfg.json, "site config");
    const orgs = await admin("GET", "/orgs");
    ok(orgs.json.orgs.some((o) => o.clients >= 1), "operator sees workspaces");
  });

  /* 10. Roles and tenant isolation */
  await check("roles: a viewer can read but not change; another MSP can't see this book", async () => {
    await call("POST", "/api/ws/users", { email: "viewer@northgate.example", role: "viewer" });
    const viewer = await signIn("viewer@northgate.example");
    ok((await call("GET", "/api/ws/alerts", undefined, { cookie: viewer })).status === 200, "viewer reads");
    ok((await call("PATCH", `/api/ws/alerts/${critical.id}`, { state: "reviewed" }, { cookie: viewer })).status === 403, "viewer can't review");
    await admin("POST", "/orgs", { name: "Other MSP", owner_email: "owner@other.example" });
    const other = await signIn("owner@other.example");
    ok((await call("GET", "/api/ws/clients/08812234", undefined, { cookie: other })).status === 404, "other org can't read client");
    ok((await call("GET", `/api/ws/alerts/${critical.id}`, undefined, { cookie: other })).status === 404, "other org can't read alert");
    ok((await call("PATCH", `/api/ws/alerts/${critical.id}`, { state: "reviewed" }, { cookie: other })).status === 404, "other org can't change alert");
    ok((await call("GET", "/api/ws/clients", undefined, { cookie: other })).json.total === 0, "other org sees an empty book");
    const a = (await call("GET", "/api/ws/alerts?state=all", undefined, { cookie: other })).json;
    ok(a.alerts.length === 0, "other org sees no alerts");
  });

  /* 11. Truth API: x402, keys, signature */
  await check("Truth API: 402 with requirements, x402 payment settles, signature verifies", async () => {
    const r = await call("POST", "/v1/check", { input: "Tarnbrook Logistics, INV-2207" }, { cookie: false });
    ok(r.status === 402 && r.headers.get("payment-required"), "402 with PAYMENT-REQUIRED");
    const req = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
    const accept = req.accepts[0];
    ok(accept.scheme === "exact" && accept.network === "eip155:8453" && accept.amount, JSON.stringify(accept));
    const badPay = await call("POST", "/v1/check", { input: "Tarnbrook Logistics" }, { cookie: false, headers: { "PAYMENT-SIGNATURE": b64({ x402Version: 2, payload: { signature: "forged", authorization: { from: "0xabc", to: accept.payTo, value: accept.amount } } }) } });
    ok(badPay.status === 402, "forged payment refused");
    const pay = { x402Version: 2, scheme: "exact", network: accept.network, payload: { signature: "valid", authorization: { from: "0xA9e1", to: accept.payTo, value: accept.amount } } };
    const paid = await call("POST", "/v1/check", { input: "Tarnbrook Logistics, INV-2207" }, { cookie: false, headers: { "PAYMENT-SIGNATURE": b64(pay) } });
    ok(paid.status === 200 && paid.headers.get("payment-response"), "paid: " + paid.text.slice(0, 200));
    ok(paid.json.flags.some((f) => f.text === "Accounts overdue"), "flags in paid answer");
    const keys = (await call("GET", "/.well-known/agent-house-key", undefined, { cookie: false })).json.keys;
    const vk = await wc.subtle.importKey("jwk", { kty: keys[0].kty, crv: keys[0].crv, x: keys[0].x }, { name: "Ed25519" }, false, ["verify"]);
    const { signature, ...rest } = paid.json;
    const canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    const okSig = await wc.subtle.verify({ name: "Ed25519" }, vk, Buffer.from(signature.slice(8), "base64url"), new TextEncoder().encode(canonical(rest)));
    ok(okSig, "signature verifies against the published key");
    const tampered = await wc.subtle.verify({ name: "Ed25519" }, vk, Buffer.from(signature.slice(8), "base64url"), new TextEncoder().encode(canonical({ ...rest, input: "changed" })));
    ok(!tampered, "tampering detected");
  });

  let devKey, devKeyId;
  await check("Truth API: developer key by email, free calls, profile with provenance on every field", async () => {
    const r = await call("POST", "/api/public/api-keys", { email: "dev@builder.example" }, { cookie: false });
    ok(r.status === 201, r.text);
    devKey = (await waitFor(async () => (await outbox()).find((m) => m.to_addr === "dev@builder.example"), "key email")).body.match(/ah_live_[A-Za-z0-9_-]+/)[0];
    devKeyId = r.json.id;
    const p = await call("GET", "/v1/companies/13985402", undefined, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(p.status === 200, p.text);
    const fields = Object.entries(p.json).filter(([k]) => !["response_id", "signature", "key_id"].includes(k));
    ok(fields.length >= 10 && fields.every(([, v]) => v.source && v.retrieved_at && v.licence), "every field sourced");
    ok(!JSON.stringify(p.json.officers).match(/date_of_birth|address/), "officers are names and roles only");
    const bad = await call("GET", "/v1/companies/13985402", undefined, { cookie: false, headers: { Authorization: "Bearer ah_live_wrong" } });
    ok(bad.status === 401, "unknown key refused");
    const res = await call("POST", "/v1/resolve", { input: "Corriemoor Interiors" }, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(res.json.confidence === "confirm" && res.json.candidates.length === 2, "resolve never guesses");
  });

  await check("MCP server: tools listed, check called with the API key, no key refused", async () => {
    const rpc = (method, params, key) => call("POST", "/mcp", { jsonrpc: "2.0", id: 1, method, params }, { cookie: false, headers: key ? { Authorization: "Bearer " + key } : {} });
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    ok(init.json.result.serverInfo.name === "agent-house" && init.json.result.capabilities.tools, JSON.stringify(init.json));
    const list = await rpc("tools/list", {});
    const names = list.json.result.tools.map((t) => t.name);
    ok(["uk-resolve", "uk-profile", "uk-check", "uk-watch", "web-research", "read-page", "company-research", "find-companies"].every((n) => names.includes(n)), "catalogue tools: " + names.join());
    const noKey = await rpc("tools/call", { name: "check", arguments: { input: "Tarnbrook Logistics" } });
    ok(noKey.json.result.isError && /API key/.test(noKey.json.result.content[0].text), "no key refused");
    const chk = await rpc("tools/call", { name: "check", arguments: { input: "Tarnbrook Logistics, INV-2207" } }, devKey);
    ok(!chk.json.result.isError && chk.json.result.structuredContent.result.flags.some((f) => f.text === "Accounts overdue") && chk.json.result.structuredContent.signature, JSON.stringify(chk.json).slice(0, 200));
    const prof = await rpc("tools/call", { name: "profile", arguments: { number: "99999999" } }, devKey);
    ok(prof.json.result.isError && /not found/.test(prof.json.result.content[0].text), "unknown company is a tool error, not a crash");
  });

  await check("Truth API: watch sends a signed webhook when a watched company changes", async () => {
    // Watching isn't one of the free calls: refused until the key has credit, then bought by card.
    const free = await call("POST", "/v1/watch", { numbers: ["13985402"], webhook: MOCK + "/devhook/builder" }, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(free.status === 402 && free.json.error.code === "credits_exhausted", free.text);
    ok((await stripeEvent({ id: "evt_credits_1", type: "checkout.session.completed", data: { object: { id: "cs_credits_1", mode: "payment", payment_status: "paid", amount_total: 1000, metadata: { key_id: devKeyId } } } })).status === 200, "credits bought");
    const w = await call("POST", "/v1/watch", { numbers: ["13985402"], webhook: MOCK + "/devhook/builder" }, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(w.status === 201, w.text);
    await sleep(3000);
    await mock("POST", "/control/mutate", { number: "13985402", change: { charge: "Lender plc" } });
    const hook = await waitFor(async () => (await mock("GET", "/control/captured")).captured.find((c) => c.target === "/devhook/builder"), "developer webhook", 60000);
    ok(hook.body.changes[0].check === "charges" && hook.body.signature.startsWith("ed25519:"), JSON.stringify(hook.body).slice(0, 200));
  });

  /* 12. Booking */
  await check("booking: slots listed, booking confirmed with calendar entry, double booking refused", async () => {
    const s = (await call("GET", "/api/public/slots", undefined, { cookie: false })).json;
    ok(s.days.length === 10 && s.days[0].times.length === 4, "10 days of slots");
    const slot = { date: s.days[1].date, time: "11:00", name: "Sam", email: "sam@northgate.example", company: "Northgate IT" };
    const b = await call("POST", "/api/public/bookings", slot, { cookie: false });
    ok(b.status === 201, b.text);
    ok((await call("POST", "/api/public/bookings", { ...slot, email: "x@y.example" }, { cookie: false })).status === 409, "double booking refused");
    ok((await call("GET", "/api/public/slots", undefined, { cookie: false })).json.days[1].times.find((t) => t.time === "11:00").available === false, "slot now taken");
    ok((await outbox()).some((m) => m.to_addr === "sam@northgate.example" && m.body.includes("BEGIN:VCALENDAR")), "calendar entry emailed");
  });

  /* 13. Billing */
  await check("billing: Stripe checkout; signed webhook activates the plan; bad and replayed webhooks handled", async () => {
    const co = await call("POST", "/api/ws/billing/checkout", { plan: "growth" });
    ok(co.status === 200 && co.json.url, co.text);
    const cap = (await mock("GET", "/control/captured")).captured.find((c) => c.target === "stripe/v1/checkout/sessions" && c.body.mode === "subscription");
    ok(cap.body["line_items[0][price]"] === "price_growth" && !cap.body["line_items[1][price]"] && cap.body["metadata[plan]"] === "growth", "one plan price, no metered extras");
    const orgId = cap.body.client_reference_id;
    const ev = { id: "evt_1", type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: orgId, customer: "cus_1", subscription: "sub_1" } } };
    const payload = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
    const key = await wc.subtle.importKey("raw", new TextEncoder().encode(vars.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Buffer.from(await wc.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`))).toString("hex");
    const bad = await call("POST", "/api/webhooks/stripe", payload, { cookie: false, headers: { "Stripe-Signature": `t=${t},v1=deadbeef`, "Content-Type": "application/json" } });
    ok(bad.status === 400, "bad signature refused");
    const good = await call("POST", "/api/webhooks/stripe", payload, { cookie: false, headers: { "Stripe-Signature": `t=${t},v1=${sig}`, "Content-Type": "application/json" } });
    ok(good.status === 200 && !good.json.duplicate, good.text);
    const again = await call("POST", "/api/webhooks/stripe", payload, { cookie: false, headers: { "Stripe-Signature": `t=${t},v1=${sig}`, "Content-Type": "application/json" } });
    ok(again.json.duplicate === true, "replay ignored");
    ok((await call("GET", "/api/ws/me")).json.subscription.status === "active", "plan active");
    const portal = await call("POST", "/api/ws/billing/portal");
    ok(portal.status === 200 && portal.json.url, portal.text);
  });

  /* 14. Inbound email */
  await check("inbound email: a workspace user emails a company name and gets a brief back", async () => {
    const eml = ["From: owner@northgate.example", "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=owner@northgate.example", "To: check@northgate.agenthouse.example", "Subject: check Harlow Vale Studios", "Message-ID: <e2e@northgate.example>", "Content-Type: text/plain", "", "Please check this one before we sign.", ""].join("\r\n");
    const r = await fetch(`${API}/cdn-cgi/handler/email?from=owner@northgate.example&to=check@northgate.agenthouse.example`, { method: "POST", body: eml });
    ok(r.ok, "email handler status " + r.status);
    await waitFor(async () => (await outbox()).find((m) => m.to_addr === "owner@northgate.example" && m.subject.startsWith("Brief: HARLOW VALE STUDIOS")), "brief reply", 30000);
    const stranger = ["From: someone@else.example", "To: check@northgate.agenthouse.example", "Subject: check Tarnbrook", "Message-ID: <x@else.example>", "", "hi", ""].join("\r\n");
    await fetch(`${API}/cdn-cgi/handler/email?from=someone@else.example&to=check@northgate.agenthouse.example`, { method: "POST", body: stranger });
    await sleep(1500);
    ok(!(await outbox()).some((m) => m.to_addr === "someone@else.example"), "strangers get no reply");
  });

  /* 15. Prospects */
  await check("prospect finder: index loaded, filters applied, monthly list built and downloadable", async () => {
    const csv = ["CompanyName,CompanyNumber,CompanyStatus,IncorporationDate,RegAddress.PostCode,SICCode.SicText_1",
      "ASHWORTH HALE SOLICITORS LTD,09112783,Active,01/07/2014,M2 4WU,69102 - Solicitors",
      "PEEL STREET ACCOUNTANTS LTD,10284419,Active,15/07/2016,M3 1AA,69201 - Accounting and auditing activities",
      "NEW START CONSULTING LTD,15000001,Active,01/01/2025,M2 1AA,70229 - Management consultancy",
      "CASTLEFIELD STRUCTURAL LTD,08760034,Active,11/11/2013,M15 4PS,71122 - Engineering",
      "DISSOLVED LEGAL LTD,07000001,Dissolved,01/01/2010,M2 2AA,69102 - Solicitors",
      "OUT OF AREA LTD,07000002,Active,01/01/2010,LS1 1AA,69102 - Solicitors"].join("\n");
    const r = await admin("POST", "/company-index", csv, { "Content-Type": "text/csv" });
    ok(r.json.loaded === 6, r.text);
    await call("PATCH", "/api/ws/org", { prospect_districts: ["M2", "M3", "M15"], prospect_sic: ["69", "70", "71"], prospect_min_age: 3 });
    const p = (await call("GET", "/api/ws/prospects/preview")).json;
    ok(p.rows.length === 3 && p.rows.every((x) => x.name !== "NEW START CONSULTING LTD" && x.name !== "DISSOLVED LEGAL LTD"), JSON.stringify(p.rows));
    await call("PATCH", "/api/ws/agents/prospect", { on: true });
    const m = await admin("POST", "/run/monthly");
    ok(m.json.result === 1, "one prospect build queued: " + m.text);
    const f = await waitFor(async () => { const r = await call("GET", "/api/ws/prospects/file"); return r.status === 200 && r; }, "prospect list built", 30000);
    ok(f.text.includes("ASHWORTH HALE SOLICITORS LTD"), f.text.slice(0, 120));
  });

  /* 17. Agents for every business */
  let biz, agents = {};
  const waitRun = (id, c, want = ["done", "waiting", "failed"]) => waitFor(async () => { const r = (await call("GET", "/api/ws/runs/" + id, undefined, { cookie: c })).json?.run; return r && want.includes(r.status) && r; }, "agent run " + id, 60000);
  await check("business sign-up: self-serve workspace, profile, catalogue, hire agents", async () => {
    const r = await call("POST", "/api/public/signup", { business: "Brightwork Cleaning", name: "Dana", email: "dana@brightwork.example", what: "Commercial office cleaning in Manchester" }, { cookie: false });
    ok(r.status === 201, r.text);
    biz = await signIn("dana@brightwork.example");
    const me = (await call("GET", "/api/ws/me", undefined, { cookie: biz })).json;
    ok(me.org.name === "Brightwork Cleaning" && me.org.profile.what.includes("office cleaning") && /@in\.agenthouse\.test$/.test(me.org.inbox_address), JSON.stringify(me.org));
    const again = await call("POST", "/api/public/signup", { business: "Brightwork Again", email: "dana@brightwork.example" }, { cookie: false });
    ok(again.status === 201 && /link to your workspace/.test(again.json.message), "second sign-up sends a sign-in link instead");
    ok((await call("PATCH", "/api/ws/org", { profile: { customers: "accountancy and law firms", area: "central Manchester", tone: "warm and plain", sign_off: "Dana, Brightwork" } }, { cookie: biz })).status === 200, "profile saved");
    const t = (await call("GET", "/api/ws/templates", undefined, { cookie: biz })).json.templates;
    ok(t.length === 12 && t.filter((x) => x.status === "live").length === 8, "catalogue of 12, 8 live");
    ok(t.find((x) => x.key === "outreach").default_brief.includes("accountancy and law firms"), "brief pre-filled from the profile");
    const no = await call("POST", "/api/ws/my-agents", { template: "bookings" }, { cookie: biz });
    ok(no.status === 409 && /isn't available yet/.test(no.json.error.message), "next agents can't be hired");
    for (const k of ["outreach", "inbox", "credit-control", "research", "briefing"]) {
      const h = await call("POST", "/api/ws/my-agents", { template: k }, { cookie: biz });
      ok(h.status === 201, k + ": " + h.text);
      agents[k] = h.json.id;
    }
    const mine = (await call("GET", "/api/ws/my-agents", undefined, { cookie: biz })).json.agents;
    ok(mine.length === 5 && mine.find((a) => a.template === "outreach").next_run_at && !mine.find((a) => a.template === "inbox").next_run_at, "scheduled agents have a next run; event agents don't");
  });

  await check("outreach agent: finds a company, reads its site, saves a lead, drafts an email; approval sends it", async () => {
    await call("PATCH", "/api/ws/org", { prospect_districts: ["M2", "M3"], prospect_sic: ["69"] }, { cookie: biz });
    const r = await call("POST", `/api/ws/my-agents/${agents.outreach}/run`, {}, { cookie: biz });
    ok(r.status === 202, r.text);
    const run = await waitRun(r.json.run_id, biz);
    ok(run.status === "waiting" && run.tool_calls === 6, JSON.stringify(run));
    const detail = (await call("GET", "/api/ws/runs/" + run.id, undefined, { cookie: biz })).json;
    ok(detail.steps.map((x) => x.tool).join() === "business-profile,find-companies,company-research,read-page,save-lead,propose-email", detail.steps.map((x) => x.tool).join());
    const leads = (await call("GET", "/api/ws/leads", undefined, { cookie: biz })).json.leads;
    ok(leads.length === 1 && leads[0].company === "ASHWORTH HALE SOLICITORS LTD" && leads[0].email === "hello@ashworth-hale-solicitors.example" && leads[0].status === "new", JSON.stringify(leads));
    const acts = (await call("GET", "/api/ws/actions", undefined, { cookie: biz })).json;
    ok(acts.counts.proposed === 1 && acts.actions[0].payload.to === leads[0].email, JSON.stringify(acts).slice(0, 300));
    ok(!(await outbox()).some((m) => m.to_addr === leads[0].email), "nothing sent before approval");
    const ap = await call("POST", `/api/ws/actions/${acts.actions[0].id}/approve`, { subject: "Office cleaning for Ashworth Hale" }, { cookie: biz });
    ok(ap.status === 200 && ap.json.status === "sent", ap.text);
    const sent = await waitFor(async () => (await outbox()).find((m) => m.to_addr === leads[0].email), "outreach email");
    ok(sent.subject === "Office cleaning for Ashworth Hale" && /unsubscribe here: .*#\/unsubscribe\?e=hello%40ashworth[^&\s]*&t=[\w-]{20,}/.test(sent.body), sent.body);
    ok((await call("POST", `/api/ws/actions/${acts.actions[0].id}/approve`, {}, { cookie: biz })).status === 409, "can't send twice");
    ok((await call("GET", "/api/ws/leads", undefined, { cookie: biz })).json.leads.find((l) => l.id === leads[0].id).status === "contacted", "lead marked contacted");
    const again = await waitRun((await call("POST", `/api/ws/my-agents/${agents.outreach}/run`, {}, { cookie: biz })).json.run_id, biz);
    ok(again.status === "waiting" && /PEEL STREET/.test(again.summary), "the next run finds the next company, not the same one: " + again.summary);
    const third = await waitRun((await call("POST", `/api/ws/my-agents/${agents.outreach}/run`, {}, { cookie: biz })).json.run_id, biz);
    ok(third.status === "done" && /No new companies/.test(third.summary), "nobody is contacted twice: " + third.summary);
  });

  await check("inbox agent: an enquiry arrives by email, is triaged, and a reply is drafted; a STOP reply suppresses", async () => {
    const me = (await call("GET", "/api/ws/me", undefined, { cookie: biz })).json;
    const to = me.org.inbox_address;
    const eml = ["From: facilities@quayside.example", "Authentication-Results: mx.cloudflare.net; dmarc=pass header.from=quayside.example", `To: ${to}`, "Subject: Quote for weekly office clean", "Message-ID: <q1@quayside.example>", "Content-Type: text/plain", "", "Hi, could you quote for cleaning our 20-desk office twice a week?", ""].join("\r\n");
    ok((await fetch(`${API}/cdn-cgi/handler/email?from=facilities@quayside.example&to=${encodeURIComponent(to)}`, { method: "POST", body: eml })).ok, "inbound accepted");
    const runs = await waitFor(async () => { const r = (await call("GET", `/api/ws/runs?agent=${agents.inbox}`, undefined, { cookie: biz })).json.runs; return r.length && ["waiting", "done", "failed"].includes(r[0].status) && r; }, "inbox run", 60000);
    ok(runs[0].trigger === "event" && runs[0].status === "waiting", JSON.stringify(runs[0]));
    const inbox = (await call("GET", "/api/ws/inbox", undefined, { cookie: biz })).json;
    ok(inbox.messages[0].urgency === "high" && inbox.messages[0].category === "quote", JSON.stringify(inbox.messages[0]));
    const act = (await call("GET", "/api/ws/actions", undefined, { cookie: biz })).json.actions.find((a) => a.payload.message_id);
    ok(act && act.payload.to === "facilities@quayside.example" && act.payload.subject.startsWith("Re: "), JSON.stringify(act));
    ok((await call("POST", `/api/ws/actions/${act.id}/reject`, {}, { cookie: biz })).status === 200, "reject");
    ok((await call("GET", "/api/ws/actions?status=rejected", undefined, { cookie: biz })).json.actions.some((a) => a.id === act.id), "rejected listed");
    // A forged STOP (no authentication results for the sender's domain) is kept but changes nothing.
    const forged = ["From: hello@ashworth-hale-solicitors.example", `To: ${to}`, "Subject: Re: Office cleaning", "Message-ID: <f1@forger.example>", "", "STOP", ""].join("\r\n");
    await fetch(`${API}/cdn-cgi/handler/email?from=hello@ashworth-hale-solicitors.example&to=${encodeURIComponent(to)}`, { method: "POST", body: forged });
    ok((await call("GET", "/api/ws/leads", undefined, { cookie: biz })).json.leads.find((l) => l.email === "hello@ashworth-hale-solicitors.example").status !== "unsubscribed", "a forged STOP changes nothing");
    const stop = ["From: hello@ashworth-hale-solicitors.example", "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=hello@ashworth-hale-solicitors.example", `To: ${to}`, "Subject: Re: Office cleaning", "Message-ID: <s1@ashworth.example>", "", "STOP", ""].join("\r\n");
    await fetch(`${API}/cdn-cgi/handler/email?from=hello@ashworth-hale-solicitors.example&to=${encodeURIComponent(to)}`, { method: "POST", body: stop });
    await waitFor(async () => (await call("GET", "/api/ws/leads", undefined, { cookie: biz })).json.leads.find((l) => l.email === "hello@ashworth-hale-solicitors.example").status === "unsubscribed", "lead unsubscribed");
  });

  await check("credit control: invoices imported, a reminder drafted and approved; with approve-first the next goes on its own", async () => {
    const csv = ["Invoice,Customer,Email,Amount,Due date", "INV-1001,Quayside Lettings,accounts@quayside.example,£480.00,2026-09-01", "INV-1002,Peel Street Accountants,pay@peelstreet.example,1200,2099-01-01", "BAD,,,,"].join("\n");
    const fd = new FormData(); fd.append("file", new Blob([csv], { type: "text/csv" }), "invoices.csv");
    const imp = await call("POST", "/api/ws/invoices/import", fd, { cookie: biz });
    ok(imp.status === 201 && imp.json.imported === 2 && imp.json.skipped_rows.length === 1, imp.text);
    const run1 = await waitRun((await call("POST", `/api/ws/my-agents/${agents["credit-control"]}/run`, {}, { cookie: biz })).json.run_id, biz);
    ok(run1.status === "waiting", JSON.stringify(run1));
    const act = (await call("GET", "/api/ws/actions", undefined, { cookie: biz })).json.actions.find((a) => a.payload.invoice_id);
    ok(act.payload.to === "accounts@quayside.example" && /INV-1001/.test(act.payload.subject), JSON.stringify(act.payload));
    ok((await call("POST", `/api/ws/actions/${act.id}/approve`, {}, { cookie: biz })).json.status === "sent", "reminder sent");
    const inv = (await call("GET", "/api/ws/invoices", undefined, { cookie: biz })).json.invoices.find((i) => i.ref === "INV-1001");
    ok(inv.reminders === 1 && inv.days_overdue > 0, JSON.stringify(inv));
    await call("PATCH", `/api/ws/my-agents/${agents["credit-control"]}`, { autonomy: "approve_first" }, { cookie: biz });
    const run2 = await waitRun((await call("POST", `/api/ws/my-agents/${agents["credit-control"]}/run`, {}, { cookie: biz })).json.run_id, biz);
    ok(run2.status === "done", "second reminder needed no approval: " + JSON.stringify(run2));
    ok((await call("GET", "/api/ws/invoices", undefined, { cookie: biz })).json.invoices.find((i) => i.ref === "INV-1001").reminders === 2, "second reminder went out");
    ok((await call("PATCH", `/api/ws/invoices/${inv.id}`, { status: "paid" }, { cookie: biz })).status === 200, "marked paid");
  });

  await check("research and briefing agents; the scheduler runs what's due", async () => {
    ok((await call("POST", `/api/ws/my-agents/${agents.research}/run`, {}, { cookie: biz })).status === 400, "research needs a question");
    await mock("POST", "/control/claude-fail", { n: 2 }); // Claude is overloaded for the next two calls: the run retries and carries on
    const rr = await waitRun((await call("POST", `/api/ws/my-agents/${agents.research}/run`, { input: "Who are Quayside Lettings?" }, { cookie: biz })).json.run_id, biz);
    ok(rr.status === "done" && /Sources:\n- http/.test(rr.summary), rr.summary);
    ok((await mock("GET", "/control/captured")).captured.filter((c) => c.target === "/anthropic" && c.body.overloaded).length === 2, "two overloaded responses were retried");
    const br = await waitRun((await call("POST", `/api/ws/my-agents/${agents.briefing}/run`, {}, { cookie: biz })).json.run_id, biz);
    ok(br.status === "done", JSON.stringify(br));
    await waitFor(async () => (await outbox()).find((m) => m.to_addr === "dana@brightwork.example" && /Weekly briefing: note/.test(m.subject) && /Needs you/.test(m.body)), "briefing email to the owner");
    const before = (await call("GET", "/api/ws/runs", undefined, { cookie: biz })).json.runs.length;
    const r = await admin("POST", "/run/agents?at=" + new Date(Date.now() + 9 * 864e5).toISOString());
    ok(r.status === 200 && r.json.result >= 2, "due agents queued: " + r.text);
    await waitFor(async () => (await call("GET", "/api/ws/runs", undefined, { cookie: biz })).json.runs.length >= before + 2, "scheduled runs", 60000);
    const ov = (await call("GET", "/api/ws/overview", undefined, { cookie: biz })).json;
    ok(ov.agents_running === 5 && ov.leads === 2 && ov.activity.length > 0, JSON.stringify(ov).slice(0, 300));
  });

  await check("agents are private to their business: another business can't see or approve them", async () => {
    await call("POST", "/api/auth/magic-link", { email: "owner@other.example" }, { cookie: false });
    const other = await signIn("owner@other.example");
    ok((await call("GET", `/api/ws/my-agents/${agents.outreach}`, undefined, { cookie: other })).status === 404, "can't read the agent");
    ok((await call("GET", "/api/ws/actions?status=all", undefined, { cookie: other })).json.actions.length === 0, "sees no actions");
    ok((await call("GET", "/api/ws/leads", undefined, { cookie: other })).json.leads.length === 0, "sees no leads");
    const someAct = (await call("GET", "/api/ws/actions?status=all", undefined, { cookie: biz })).json.actions[0];
    ok((await call("POST", `/api/ws/actions/${someAct.id}/approve`, {}, { cookie: other })).status === 404, "can't approve another business's action");
    ok((await call("POST", `/api/ws/my-agents/${agents.outreach}/run`, {}, { cookie: other })).status === 404, "can't run another business's agent");
  });

  /* 17b. Swarms, the Floor, the CRM and voice */
  let hb, swarm, sw = {};
  await check("swarms: presets listed; a description becomes a blueprint (with a correction round, or the nearest preset)", async () => {
    ok((await call("POST", "/api/public/signup", { business: "Harbour Facilities", name: "Kit", email: "kit@harbour.example", what: "Office cleaning and facilities for professional firms in Manchester" }, { cookie: false })).status === 201, "sign-up");
    hb = await signIn("kit@harbour.example");
    await call("PATCH", "/api/ws/org", { prospect_districts: ["M2", "M3"], prospect_sic: ["69"], profile: { customers: "law and accountancy firms", sign_off: "Kit, Harbour" } }, { cookie: hb });
    const pr = (await call("GET", "/api/ws/swarm-presets", undefined, { cookie: hb })).json;
    ok(pr.presets.length === 3 && pr.presets.find((p) => p.key === "markets-desk").locked && pr.voice === true, JSON.stringify(pr).slice(0, 300));
    const g = (await call("POST", "/api/ws/swarms/plan", { description: "We're a recruitment agency in Manchester placing accountants with growing firms." }, { cookie: hb })).json;
    ok(g.source === "generated" && g.blueprint.name === "Recruitment desk" && g.blueprint.agents[0].template === "custom" && g.preview.fits && g.preview.new_agents === 3, JSON.stringify(g).slice(0, 300));
    const fixed = (await call("POST", "/api/ws/swarms/plan", { description: "Recruitment agency, needs a retry to get this right." }, { cookie: hb })).json;
    ok(fixed.source === "generated" && !fixed.blueprint.agents[0].tools.includes("linkedin-scrape"), "the correction round fixed the unknown tool");
    const fb = (await call("POST", "/api/ws/swarms/plan", { description: "Something unusable about chasing unpaid invoices." }, { cookie: hb })).json;
    ok(fb.source === "preset" && fb.preset === "back-office" && /closest preset/.test(fb.note), JSON.stringify(fb).slice(0, 200));
    ok((await call("POST", "/api/ws/swarms/plan", { description: "short" }, { cookie: hb })).status === 400, "too-short description refused");
    sw.recruit = g.blueprint;
  });

  await check("swarms: spin up the sales floor; locked presets and broken blueprints are refused and leave nothing behind", async () => {
    const lk = await call("POST", "/api/ws/swarms", { preset: "markets-desk" }, { cookie: hb });
    ok(lk.status === 409 && lk.json.error.code === "needs_connection", lk.text);
    const bad = await call("POST", "/api/ws/swarms", { blueprint: { ...sw.recruit, agents: sw.recruit.agents.map((a, i) => (i ? a : { ...a, tools: ["send-money"] })) } }, { cookie: hb });
    ok(bad.status === 400 && bad.json.error.code === "invalid_blueprint", bad.text);
    const r = await call("POST", "/api/ws/swarms", { preset: "sales-floor" }, { cookie: hb });
    ok(r.status === 201 && r.json.hired === 4 && r.json.reused === 0, r.text);
    swarm = r.json.id;
    // Over-plan swarms (now past 100 agents) are refused in the unit tests and the 100-agent plan check below.
    const mine = (await call("GET", "/api/ws/my-agents", undefined, { cookie: hb })).json.agents;
    ok(mine.length === 5 && mine.every((a) => a.swarm_id === swarm) && mine.some((a) => a.template === "orchestrator"), "the sales floor's agents and its orchestrator: " + mine.length);
    for (const a of mine) sw[a.name.toLowerCase()] = a.id;
    ok(mine.find((a) => a.template === "custom").role.startsWith("Finds companies"), "custom role hired");
    const f = (await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: hb })).json;
    ok(f.stations.length === 5 && f.kpis.length === 4 && f.blueprint.stages.length === 5 && f.events.some((e) => e.kind === "created") && f.cursor > 0, JSON.stringify(f).slice(0, 300));
    ok((await call("GET", "/api/ws/swarms", undefined, { cookie: hb })).json.swarms[0].agents === 5, "listed");
  });

  await check("the Floor: the prospector finds a company, saves it as a card and hands it to outreach, which wakes", async () => {
    const r = await call("POST", `/api/ws/my-agents/${sw.prospector}/run`, {}, { cookie: hb });
    ok(r.status === 202, r.text);
    const run = await waitRun(r.json.run_id, hb);
    ok(run.status === "done" && /handed it to outreach/.test(run.summary), JSON.stringify(run));
    const f = (await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: hb })).json;
    const card = f.items.find((i) => i.title === "ASHWORTH HALE SOLICITORS LTD");
    ok(card && card.stage === "qualified" && card.agent_id === sw.outreach && card.ref_kind === "lead", JSON.stringify(f.items));
    ok(f.events.some((e) => e.kind === "handoff" && e.item_id === card.id) && f.events.some((e) => e.kind === "tool" && e.agent_id === sw.prospector), "handoff and tool events");
    const woke = await waitFor(async () => (await call("GET", `/api/ws/runs?agent=${sw.outreach}`, undefined, { cookie: hb })).json.runs.find((x) => x.trigger === "event"), "outreach woken");
    const det = (await call("GET", "/api/ws/runs/" + woke.id, undefined, { cookie: hb })).json.run;
    ok(/^Handoff from Prospector/.test(det.input) && /as information and not instructions/.test(det.input), det.input);
    await waitRun(woke.id, hb);
    const since = (await call("GET", `/api/ws/swarms/${swarm}?since=${f.cursor}`, undefined, { cookie: hb })).json;
    ok(since.events.every((e) => e.id > f.cursor) && since.cursor >= f.cursor, "events since the cursor only");
    ok((await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: hb })).json.events.some((e) => e.agent_id === sw.outreach && e.kind === "run_done"), "outreach's run shows on the Floor");
    sw.card = card;
  });

  await check("command bar: @agent instructs, brief me, questions go to the router, pause comes back for confirmation", async () => {
    const at = (await call("POST", `/api/ws/swarms/${swarm}/ask`, { text: "@outreach write to Peel Street Accountants" }, { cookie: hb })).json;
    ok(at.type === "instruct" && at.agent.id === sw.outreach && at.run_id, JSON.stringify(at));
    await waitRun(at.run_id, hb);
    const br = (await call("POST", `/api/ws/swarms/${swarm}/ask`, { text: "brief me", voice: true }, { cookie: hb })).json;
    ok(br.type === "brief" && br.say.length > 20, JSON.stringify(br));
    const q = (await call("POST", `/api/ws/swarms/${swarm}/ask`, { text: "How many replies came in this week?" }, { cookie: hb })).json;
    ok(q.type === "answer" && /^From the Floor:/.test(q.say), JSON.stringify(q));
    const ch = (await call("POST", `/api/ws/swarms/${swarm}/ask`, { text: "pause inbox" }, { cookie: hb })).json;
    ok(ch.type === "change" && ch.change.action === "pause" && ch.change.agent_id === sw.inbox, JSON.stringify(ch));
    ok((await call("GET", `/api/ws/my-agents/${sw.inbox}`, undefined, { cookie: hb })).json.agent.status === "running", "nothing changes until it's confirmed");
    const f = (await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: hb })).json;
    ok(f.events.some((e) => e.kind === "ask" && e.summary === "You said: brief me"), "spoken asks are logged");
    ok((await call("POST", `/api/ws/swarms/${swarm}/brief`, undefined, { cookie: hb })).json.text.length > 20, "brief endpoint");
  });

  await check("voice: a recording is transcribed and a reply is spoken; both are metered", async () => {
    const t = await call("POST", "/api/ws/voice/transcribe", "pause outreach", { cookie: hb, headers: { "Content-Type": "audio/webm" } });
    ok(t.status === 200 && t.json.text === "pause outreach", t.text);
    const fd = new FormData(); fd.set("audio", new Blob(["brief me"], { type: "audio/webm" }), "a.webm");
    ok((await call("POST", "/api/ws/voice/transcribe", fd, { cookie: hb })).json.text === "brief me", "multipart upload");
    const res = await fetch(API + "/api/ws/voice/speak", { method: "POST", headers: { Cookie: hb, "Content-Type": "application/json" }, body: JSON.stringify({ text: "Two emails are waiting for you." }) });
    const buf = Buffer.from(await res.arrayBuffer());
    ok(res.status === 200 && res.headers.get("content-type") === "audio/mpeg" && buf.subarray(0, 3).toString() === "ID3", "audio back");
    ok((await call("POST", "/api/ws/voice/speak", { text: "" }, { cookie: hb })).status === 400, "empty text refused");
    ok((await mock("GET", "/control/captured")).captured.some((c) => c.target === "/voice/speak" && c.body.text === "Two emails are waiting for you."), "speech requested");
  });

  await check("CRM: contacts, a deal won, notes and a timeline; moving a card moves its lead", async () => {
    const cos = (await call("GET", "/api/ws/crm/companies", undefined, { cookie: hb })).json.companies;
    const co = cos.find((c) => c.company === "ASHWORTH HALE SOLICITORS LTD");
    ok(co, JSON.stringify(cos).slice(0, 200));
    const ct = await call("POST", "/api/ws/crm/contacts", { lead_id: co.id, name: "Priya Hale", role: "Practice manager", email: "priya@ashworth-hale-solicitors.example" }, { cookie: hb });
    ok(ct.status === 201 && ct.json.created, ct.text);
    ok((await call("POST", "/api/ws/crm/contacts", { lead_id: co.id, name: "Priya Hale" }, { cookie: hb })).json.created === false, "contacts dedupe");
    const mv = await call("PATCH", "/api/ws/work-items/" + sw.card.id, { stage: "replied" }, { cookie: hb });
    ok(mv.status === 200, mv.text);
    ok((await call("GET", "/api/ws/leads", undefined, { cookie: hb })).json.leads.find((l) => l.id === co.id).status === "replied", "lead follows the card");
    const d = await call("POST", "/api/ws/crm/deals", { lead_id: co.id, title: "Nightly office clean", value_pence: 180000 }, { cookie: hb });
    ok(d.status === 201 && d.json.status === "open", d.text);
    ok((await call("PATCH", "/api/ws/crm/deals/" + d.json.deal_id, { status: "won" }, { cookie: hb })).json.status === "won", "deal won");
    ok((await call("POST", "/api/ws/crm/notes", { lead_id: co.id, summary: "Walk-round booked for Thursday", kind: "call" }, { cookie: hb })).status === 201, "note");
    const v = (await call("GET", "/api/ws/crm/companies/" + co.id, undefined, { cookie: hb })).json;
    ok(v.company.status === "won" && v.contacts.length === 1 && v.deals[0].status === "won", JSON.stringify(v).slice(0, 300));
    const kinds = v.timeline.map((t) => t.kind);
    for (const k of ["lead", "note", "deal", "won", "call", "stage"]) ok(kinds.includes(k), "timeline has " + k + ": " + kinds.join());
    const f = (await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: hb })).json;
    ok(f.items.find((i) => i.id === sw.card.id).stage === "won" && f.kpis.find((k) => k.key === "won_month").value === 1, "the card is won on the Floor");
    ok((await call("POST", "/api/ws/crm/notes", { lead_id: "lead_nope", summary: "x" }, { cookie: hb })).status === 404, "unknown company");
  });

  await check("org chart: badges and reporting lines saved; the orchestrator assigns work; goals and owner tasks", async () => {
    const o = (await call("GET", `/api/ws/swarms/${swarm}/org`, undefined, { cookie: hb })).json;
    ok(o.root && o.agents.length === 5 && o.agents.filter((a) => a.reports_to === o.root).length === 4 && o.limits.agents_used === 4, JSON.stringify(o).slice(0, 300));
    const bad = await call("PATCH", `/api/ws/swarms/${swarm}/org`, { changes: [{ op: "skill", agent: sw.outreach, value: "planning" }] }, { cookie: hb });
    ok(bad.status === 409 && /Planning is for the orchestrator and Lead/.test(bad.json.error.message), bad.text);
    const r = await call("PATCH", `/api/ws/swarms/${swarm}/org`, { changes: [
      { op: "skill", agent: sw.outreach, value: "registers" },
      { op: "hire", id: "new-1", role: "analyst", name: "Researcher" },
      { op: "reports_to", agent: "new-1", value: sw.prospector },
      { op: "autonomy", agent: sw.inbox, value: "approve_first" },
    ] }, { cookie: hb });
    ok(r.status === 200 && r.json.applied.length === 4, r.text);
    const researcher = r.json.agents.find((a) => a.name === "Researcher");
    ok(researcher && researcher.reports_to === sw.prospector && r.json.agents.find((a) => a.id === sw.prospector).role === "lead", JSON.stringify(r.json.agents).slice(0, 400));
    const outRow = (await call("GET", `/api/ws/my-agents/${sw.outreach}`, undefined, { cookie: hb })).json.agent;
    ok(outRow.template === "custom" && outRow.name === "Outreach", "outreach keeps its name as a custom role");
    ok((await call("PATCH", `/api/ws/swarms/${swarm}/org`, { changes: [{ op: "role", agent: sw.inbox, value: "writer" }] }, { cookie: false })).status === 401, "needs a session");
    // The orchestrator plans: one task to a free agent, which runs it and reports back.
    const run = await waitRun((await call("POST", `/api/ws/my-agents/${o.root}/run`, {}, { cookie: hb })).json.run_id, hb);
    ok(run.status === "done" && /Assigned/.test(run.summary), JSON.stringify(run));
    const tasks = await waitFor(async () => { const t = (await call("GET", `/api/ws/swarms/${swarm}/org`, undefined, { cookie: hb })).json.tasks; return t.length && t.every((x) => x.status !== "doing") && t; }, "task settled", 60000);
    ok(tasks[0].from === "Orchestrator" && tasks[0].status === "done", JSON.stringify(tasks));
    // Owner task to the new custom role: it reports back with finish-task.
    const ot = await call("POST", `/api/ws/swarms/${swarm}/tasks`, { agent_id: researcher.id, title: "Who are Peel Street's partners?" }, { cookie: hb });
    ok(ot.status === 201 && ot.json.run_id, ot.text);
    await waitRun(ot.json.run_id, hb);
    const done = (await call("GET", `/api/ws/swarms/${swarm}/org`, undefined, { cookie: hb })).json.tasks.find((t) => t.id === ot.json.task_id);
    ok(done.status === "done" && done.result === "Done: drafted what was asked." && done.from === "You", JSON.stringify(done));
    // The owner can drop an agent's task; owner to-dos keep their own route.
    const extra = (await call("POST", `/api/ws/swarms/${swarm}/tasks`, { agent_id: researcher.id, title: "Find Peel Street's office manager" }, { cookie: hb })).json;
    await waitRun(extra.run_id, hb);
    const drop = await call("PATCH", `/api/ws/agent-tasks/${extra.task_id}`, { status: "dropped" }, { cookie: hb });
    ok(drop.status === 200, drop.text);
    ok((await call("GET", `/api/ws/swarms/${swarm}/org`, undefined, { cookie: hb })).json.tasks.find((t) => t.id === extra.task_id).status === "dropped", "task dropped");
    ok((await call("PATCH", `/api/ws/agent-tasks/${extra.task_id}`, { status: "dropped" }, { cookie: false })).status === 401, "needs a session");
    // A goal from the command bar wakes the orchestrator.
    const g = (await call("POST", `/api/ws/swarms/${swarm}/ask`, { text: "goal: five law firms talking to us by December" }, { cookie: hb })).json;
    ok(g.type === "instruct" && g.agent.name === "Orchestrator" && g.run_id, JSON.stringify(g));
    await waitRun(g.run_id, hb);
    ok((await call("GET", `/api/ws/swarms/${swarm}/org`, undefined, { cookie: hb })).json.swarm.goals.includes("five law firms talking to us by December"), "goal kept");
    const ev = (await call("GET", `/api/ws/swarms/${swarm}/events`, undefined, { cookie: hb })).json.events;
    ok(ev.some((e) => e.kind === "org") && ev.some((e) => e.kind === "task") && ev.some((e) => e.kind === "goal"), "org, task and goal events on the Floor");
    await call("POST", "/api/auth/magic-link", { email: "owner@other.example" }, { cookie: false });
    const other = await signIn("owner@other.example");
    ok((await call("GET", `/api/ws/swarms/${swarm}/org`, undefined, { cookie: other })).status === 404, "another business can't see the team");
  });

  await check("swarms are private, viewers can't drive them, and removing one removes its agents", async () => {
    await call("POST", "/api/auth/magic-link", { email: "owner@other.example" }, { cookie: false });
    const other = await signIn("owner@other.example");
    ok((await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: other })).status === 404, "other business can't see the Floor");
    ok((await call("POST", `/api/ws/swarms/${swarm}/ask`, { text: "brief me" }, { cookie: other })).status === 404, "or ask it anything");
    ok((await call("PATCH", "/api/ws/work-items/" + sw.card.id, { stage: "found" }, { cookie: other })).status === 404, "or move its cards");
    ok((await call("GET", "/api/ws/crm/companies", undefined, { cookie: other })).json.companies.every((c) => c.company !== "ASHWORTH HALE SOLICITORS LTD"), "CRM scoped");
    await call("POST", "/api/ws/users", { email: "viewer@harbour.example", role: "viewer" }, { cookie: hb });
    const viewer = await signIn("viewer@harbour.example");
    ok((await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: viewer })).status === 200, "viewer watches the Floor");
    ok((await call("POST", `/api/ws/swarms/${swarm}/ask`, { text: "brief me" }, { cookie: viewer })).status === 403, "viewer can't instruct");
    ok((await call("PATCH", "/api/ws/swarms/" + swarm, { status: "paused" }, { cookie: hb })).status === 200, "pause all");
    ok((await call("GET", "/api/ws/my-agents", undefined, { cookie: hb })).json.agents.every((a) => a.status === "paused"), "every agent paused");
    ok((await call("DELETE", "/api/ws/swarms/" + swarm, undefined, { cookie: hb })).status === 200, "removed");
    ok((await call("GET", "/api/ws/my-agents", undefined, { cookie: hb })).json.agents.length === 0 && (await call("GET", "/api/ws/swarms/" + swarm, undefined, { cookie: hb })).status === 404, "agents and Floor gone");
    ok((await call("GET", "/api/ws/leads", undefined, { cookie: hb })).json.leads.length >= 1, "the CRM keeps its records");
  });

  /* 17b. The business OS: every module, channels, and agents asked in a conversation */
  await check("business OS: every module takes records; a manager adds, a viewer reads", async () => {
    const cat = (await call("GET", "/api/ws/os/catalogue", undefined, { cookie: hb })).json;
    ok(cat.modules.length >= 118 && cat.totals.modules === cat.modules.length, `catalogue lists ${cat.modules.length} modules, totals say ${cat.totals.modules}`);
    for (const m of cat.modules) {
      const r = await call("POST", `/api/ws/os/m/${m.key}/records`, { title: `First ${m.app} record` }, { cookie: hb });
      ok(r.status === 201 && r.json.record.module === m.key, m.key + ": " + r.text);
    }
    const bill = await call("POST", "/api/ws/os/m/bills-and-payables/records", { title: "Office rent", fields: { party: "Landlord", amount: "1250", due_date: "2026-11-01" } }, { cookie: hb });
    ok(bill.json.record.amount_pence === 125000, bill.text);
    ok((await call("PATCH", `/api/ws/os/records/${bill.json.record.id}`, { status: "paid" }, { cookie: hb })).json.record.status === "paid", "status moves");
    const after = (await call("GET", "/api/ws/os/catalogue", undefined, { cookie: hb })).json;
    ok(after.totals.records === cat.modules.length + 1 && after.modules.every((m) => m.records >= 1), "every module counted");
    await call("POST", "/api/auth/magic-link", { email: "viewer@harbour.example" }, { cookie: false });
    const viewer = await signIn("viewer@harbour.example");
    ok((await call("GET", "/api/ws/os/m/bills-and-payables/records", undefined, { cookie: viewer })).json.records.length === 2, "viewer reads");
    ok((await call("POST", "/api/ws/os/m/bills-and-payables/records", { title: "x" }, { cookie: viewer })).status === 403, "viewer can't add");
  });

  await check("business OS: @mention an agent in #general and its answer comes back to the channel", async () => {
    const chans = (await call("GET", "/api/ws/os/channels", undefined, { cookie: hb })).json.channels;
    const general = chans.find((c) => c.name === "general");
    ok(general && chans.length >= 5, JSON.stringify(chans));
    const said = await call("POST", `/api/ws/os/channels/${general.id}/messages`, { body: "@Payables agent what's due this week?" }, { cookie: hb });
    ok(said.status === 201 && said.json.asked[0]?.run_id, said.text);
    const reply = await waitFor(async () => (await call("GET", `/api/ws/os/channels/${general.id}/messages`, undefined, { cookie: hb })).json.messages.find((m) => m.author_kind === "agent"), "the agent's reply", 60000);
    ok(reply.author_name === "Payables agent" && /records so far/.test(reply.body), JSON.stringify(reply));
    const pay = (await call("GET", "/api/ws/os/m/bills-and-payables/records", undefined, { cookie: hb })).json.records;
    ok(pay.some((r) => /^Follow up/.test(r.title) && r.created_by === "Payables agent"), "the agent saved a record in its own module");
    const { json: rec } = await call("GET", "/api/ws/os/m/complaints/records", undefined, { cookie: hb });
    const thread = await call("POST", `/api/ws/os/records/${rec.records[0].id}/messages`, { body: "Customer called again, logging it here" }, { cookie: hb });
    ok(thread.status === 201 && thread.json.asked.length === 0, thread.text);
    ok((await call("GET", `/api/ws/os/records/${rec.records[0].id}/messages`, undefined, { cookie: hb })).json.messages.length === 1, "record thread");
  });

  /* 18. Tools for agents and developers */
  await check("tool gateway: catalogue and discovery; x402 or a key; every answer signed", async () => {
    const cat = (await call("GET", "/v1/tools", undefined, { cookie: false })).json;
    ok(cat.tools.length === 8 && cat.tools.find((t) => t.slug === "web-research").price.pence === 3 && cat.agents_run.price.per_step_pence === 12, JSON.stringify(cat).slice(0, 200));
    const llms = await call("GET", "/llms.txt", undefined, { cookie: false });
    ok(llms.status === 200 && llms.text.startsWith("# Agent House") && llms.text.includes("company-research"), llms.text.slice(0, 80));
    const wk = (await call("GET", "/.well-known/agent-house.json", undefined, { cookie: false })).json;
    ok(wk.mcp.endsWith("/mcp") && wk.tools.endsWith("/v1/tools"), JSON.stringify(wk));
    const q = await call("POST", "/v1/tools/web-research", { query: "Quayside Lettings Manchester" }, { cookie: false });
    ok(q.status === 402 && JSON.parse(Buffer.from(q.headers.get("payment-required"), "base64")).accepts[0].amount === "37500", "402 priced per tool");
    const accept = JSON.parse(Buffer.from(q.headers.get("payment-required"), "base64")).accepts[0];
    const paid = await call("POST", "/v1/tools/web-research", { query: "Quayside Lettings Manchester" }, { cookie: false, headers: { "PAYMENT-SIGNATURE": b64({ x402Version: 2, payload: { signature: "valid", authorization: { from: "0xA9e1", to: accept.payTo, value: accept.amount } } }) } });
    ok(paid.status === 200 && paid.json.result.results.length === 3 && paid.json.signature.startsWith("ed25519:") && paid.headers.get("payment-response"), paid.text.slice(0, 200));
    const page = await call("POST", "/v1/tools/read-page", { url: paid.json.result.results[0].url }, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(page.status === 200 && page.json.result.emails_on_page[0] === "hello@quayside-lettings-manchester.example" && !page.json.result.text.includes("var a=1"), page.text.slice(0, 300));
    ok((await call("POST", "/v1/tools/propose-email", { to: "x@y.example", subject: "s", body: "b" }, { cookie: false, headers: { Authorization: "Bearer " + devKey } })).status === 404, "business-only tools aren't public");
    const legacy = await call("POST", "/v1/tools/check", { input: "Tarnbrook Logistics, INV-2207" }, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(legacy.status === 200 && legacy.json.tool === "uk-check" && legacy.json.result.flags.some((f) => f.text === "Accounts overdue"), "legacy names still work");
  });

  await check("Agents API: priced per step, not free, paid before it runs; one call runs an agent with catalogue tools, signed", async () => {
    const spec = { instructions: "You check UK companies before payment.", input: "Tarnbrook Logistics, INV-2207", tools: ["uk-check"] };
    const tl = (await call("GET", "/v1/tools", undefined, { cookie: false })).json.agents_run;
    ok(tl.price.per_step_pence === 12 && tl.price.default_steps === 4 && tl.free_calls === false, JSON.stringify(tl));
    // The developer key still has free calls left, but agent runs aren't covered by them: this key bought credit
    // to watch companies, so the run (4 steps x 12p) comes out of that credit.
    const credit = async () => (await call("GET", "/api/dev/me", undefined, { cookie: false, headers: { Authorization: "Bearer " + devKey } })).json.credit_pence;
    const before = await credit();
    const paid = await call("POST", "/v1/agents/run", spec, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(paid.status === 200 && paid.json.price.pence === 48, paid.text.slice(0, 200));
    ok(before - (await credit()) === 48, "a run is charged to credit, never to the free calls");
    const quote = await call("POST", "/v1/agents/run", { ...spec, max_steps: 3 }, { cookie: false });
    const accept = JSON.parse(Buffer.from(quote.headers.get("payment-required"), "base64")).accepts[0];
    ok(quote.status === 402 && accept.amount === "450000", "3 steps x 12p = 36p = 0.45 USDC: " + accept.amount);
    const short = await call("POST", "/v1/agents/run", { ...spec, max_steps: 3 }, { cookie: false, headers: { "PAYMENT-SIGNATURE": b64({ x402Version: 2, payload: { signature: "valid", authorization: { from: "0xA9e1", to: accept.payTo, value: "100" } } }) } });
    ok(short.status === 402, "underpayment refused: " + short.text);
    const sent = (await mock("GET", "/control/captured")).captured.filter((c) => c.target === "/anthropic").length;
    const r = await call("POST", "/v1/agents/run", { ...spec, max_steps: 3 }, { cookie: false, headers: { "PAYMENT-SIGNATURE": b64({ x402Version: 2, payload: { signature: "valid", authorization: { from: "0xA9e1", to: accept.payTo, value: accept.amount } } }) } });
    ok(r.status === 200 && r.headers.get("payment-response") && r.json.steps[0].tool === "uk-check" && r.json.steps[0].ok && r.json.output.startsWith("Answer:") && r.json.signature && r.json.price.pence === 36, r.text.slice(0, 300));
    const calls = (await mock("GET", "/control/captured")).captured.filter((c) => c.target === "/anthropic").slice(sent);
    ok(calls.length >= 2 && calls.every((c) => c.body.cached), "every model call marks the prompt for caching");
    const bad = await call("POST", "/v1/agents/run", { instructions: "You check UK companies before payment.", input: "x", tools: ["propose-email"] }, { cookie: false, headers: { Authorization: "Bearer " + devKey } });
    ok(bad.status === 400, "only first-party public tools: " + bad.text);
    ok((await call("POST", "/v1/agents/run", { instructions: "You check UK companies before payment.", input: "x", tools: ["uk-check"] }, { cookie: false })).status === 402, "unpaid runs get 402");
  });

  let toolSecret;
  await check("developer publishes a tool: review, then live in the catalogue and MCP; callers pay, publisher earns 80%", async () => {
    const dk = { Authorization: "Bearer " + devKey };
    ok((await call("GET", "/api/dev/me", undefined, { cookie: false })).status === 401, "dashboard needs a key");
    const me = (await call("GET", "/api/dev/me", undefined, { cookie: false, headers: dk })).json;
    ok(me.email === "dev@builder.example" && me.calls_this_month > 0, JSON.stringify(me));
    const spec = { slug: "uk-vat-check", name: "UK VAT number check", description: "Checks a UK VAT number and returns the registered trading name.", input_schema: { type: "object", properties: { vat: { type: "string" } }, required: ["vat"] }, endpoint: MOCK + "/devtool/vat", price_pence: 4 };
    ok((await call("POST", "/api/dev/tools", { ...spec, slug: "web-research" }, { cookie: false, headers: dk })).status === 409, "first-party names are taken");
    const pub = await call("POST", "/api/dev/tools", spec, { cookie: false, headers: dk });
    ok(pub.status === 201 && pub.json.status === "review" && pub.json.signing_secret.startsWith("ahs_"), pub.text);
    toolSecret = pub.json.signing_secret;
    ok(!(await call("GET", "/v1/tools", undefined, { cookie: false })).json.tools.some((t) => t.slug === "uk-vat-check"), "not listed before review");
    ok((await call("POST", "/v1/tools/uk-vat-check", { vat: "GB1" }, { cookie: false, headers: dk })).status === 404, "not callable before review");
    const rv = (await admin("GET", "/tools")).json.tools.find((t) => t.slug === "uk-vat-check");
    ok(rv.status === "review" && rv.owner_email === "dev@builder.example", JSON.stringify(rv));
    ok((await admin("POST", "/tools/uk-vat-check/approve", {})).json.status === "live", "approved");
    await waitFor(async () => (await outbox()).find((m) => m.to_addr === "dev@builder.example" && /is live on Agent House/.test(m.subject)), "publisher told");
    const cat = (await call("GET", "/v1/tools", undefined, { cookie: false })).json.tools.find((t) => t.slug === "uk-vat-check");
    ok(cat && cat.publisher === "Developer" && cat.price.usdc_atomic === "50000", JSON.stringify(cat));
    const mcpList = (await call("POST", "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }, { cookie: false })).json.result.tools;
    ok(mcpList.some((t) => t.name === "uk-vat-check"), "listed on MCP");
    const q = await call("POST", "/v1/tools/uk-vat-check", { vat: "GB987654321" }, { cookie: false });
    const accept = JSON.parse(Buffer.from(q.headers.get("payment-required"), "base64")).accepts[0];
    const paid = await call("POST", "/v1/tools/uk-vat-check", { vat: "GB987654321" }, { cookie: false, headers: { "PAYMENT-SIGNATURE": b64({ x402Version: 2, payload: { signature: "valid", authorization: { from: "0xBEEF", to: accept.payTo, value: accept.amount } } }) } });
    ok(paid.status === 200 && paid.json.result.vat_number === "GB987654321" && paid.json.signature, paid.text.slice(0, 200));
    const hit = (await mock("GET", "/control/captured")).captured.filter((c) => c.target === "/devtool/vat").pop();
    const mac = createHmac("sha256", toolSecret).update(`${hit.headers.ts}.${JSON.stringify(hit.body)}`).digest("hex");
    ok(hit.headers.sig === "v1=" + mac, "the publisher can verify the request came from us");
    const me2 = (await call("GET", "/api/dev/me", undefined, { cookie: false, headers: dk })).json;
    ok(me2.earnings_pence === 3, "80% of 4p: " + JSON.stringify(me2));
    const mcpCall = await call("POST", "/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "uk-vat-check", arguments: { vat: "GB1" } } }, { cookie: false, headers: dk });
    ok(!mcpCall.json.result.isError && mcpCall.json.result.structuredContent.result.valid === true, JSON.stringify(mcpCall.json).slice(0, 200));
    await call("POST", "/api/dev/tools", { ...spec, slug: "broken-tool", endpoint: MOCK + "/devtool/broken" }, { cookie: false, headers: dk });
    await admin("POST", "/tools/broken-tool/approve", {});
    const before = (await call("GET", "/api/dev/me", undefined, { cookie: false, headers: dk })).json.calls_this_month;
    const br = await call("POST", "/v1/tools/broken-tool", { vat: "x" }, { cookie: false, headers: dk });
    ok(br.status === 502 && /not been charged/.test(br.json.error.message), br.text);
    ok((await call("GET", "/api/dev/me", undefined, { cookie: false, headers: dk })).json.calls_this_month === before, "a failed tool call isn't counted");
    ok((await call("PATCH", "/api/dev/tools/broken-tool", { status: "retired" }, { cookie: false, headers: dk })).json.status === "retired", "retired");
  });

  /* 16. Retention and audit */
  await check("plan limits: the trial allows 100 agents; usage shows the allowance", async () => {
    let n = (await call("GET", "/api/ws/my-agents", undefined, { cookie: biz })).json.agents.length;
    while (n < 100) { const h = await call("POST", "/api/ws/my-agents", { template: "research", name: "Research " + n }, { cookie: biz }); ok(h.status === 201, h.text); n++; }
    const over = await call("POST", "/api/ws/my-agents", { template: "outreach" }, { cookie: biz });
    ok(over.status === 409 && over.json.error.code === "plan_limit", over.text);
    const u = (await call("GET", "/api/ws/usage", undefined, { cookie: biz })).json;
    ok(u.plan === "trial" && u.plan_actions === 1500 && u.plan_agents === 100 && u.actions > 0 && u.by_agent.length >= 6, JSON.stringify(u).slice(0, 300));
  });

  await check("billing state: plan changes follow Stripe; past-due and cancelled workspaces stop their agents", async () => {
    const me = (await call("GET", "/api/ws/me")).json;
    const sub = (status, price = "price_scale") => stripeEvent({ id: "evt_" + Math.random().toString(36).slice(2), type: "customer.subscription.updated", data: { object: { id: "sub_1", status, items: { data: [{ price: { id: price } }] } } } });
    ok((await sub("active")).status === 200, "update accepted");
    ok((await call("GET", "/api/ws/me")).json.org.plan === "scale", "portal plan change reaches the workspace");
    ok((await call("POST", "/api/ws/my-agents", { template: "research", name: "Scale research" })).status === 201, "active plan can hire");
    ok((await sub("unpaid")).status === 200, "unpaid accepted");
    const blocked = await call("POST", "/api/ws/my-agents", { template: "research", name: "Unpaid research" });
    ok(blocked.status === 402 && blocked.json.error.code === "plan_inactive", blocked.text);
    ok((await stripeEvent({ id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled" } } })).status === 200, "deletion accepted");
    ok((await sub("active")).status === 200 && (await call("GET", "/api/ws/me")).json.subscription.status === "cancelled", "a late update doesn't revive a cancelled plan");
    const mine = (await call("GET", "/api/ws/my-agents")).json.agents.find((a) => a.name === "Scale research");
    const run = await call("POST", `/api/ws/my-agents/${mine.id}/run`, { input: "Anything?" });
    ok(run.status === 402 && /cancelled/.test(run.json.error.message), run.text);
    ok(me.org.id, "workspace still readable after cancellation");
  });

  await check("audit log records actions; retention job runs", async () => {
    const a = (await call("GET", "/api/ws/audit")).json.entries.map((e) => e.action);
    for (const x of ["sign_in", "channel_added", "import_started", "matches_confirmed", "alert_reviewed", "alert_shared", "client_paused", "usage_exported"]) ok(a.includes(x), "audit has " + x);
    const r = await admin("POST", "/run/retention");
    ok(r.status === 200 && r.json.result.health_checks === 0, r.text);
  });

}

main().then(() => {
  console.log(`\nAll ${results.length} end-to-end flows passed.`);
  stopAll(); process.exit(0);
}).catch(async (e) => {
  console.error(`\nFAILED at: ${step}\n${e.stack || e}`);
  await sleep(1500); // let the servers flush their logs
  for (const p of procs) {
    const all = p.logs.join("");
    if (process.env.E2E_LOG_DIR) require_fs().writeFileSync(`${process.env.E2E_LOG_DIR}/${p.name}.log`, all);
    const tail = all.split("\n").filter((l) => !/^\s*env\./.test(l)).slice(-25).join("\n");
    console.error(`\n--- ${p.name} log (tail) ---\n${tail}`);
  }
  stopAll(); process.exit(1);
});
