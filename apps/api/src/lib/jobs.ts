// The job runner: one queue consumer and the scheduled tasks. Every step is safe to retry.
import { newId, nowIso, longDate } from "../../../../packages/core/util";
import { fetchT } from "./fetch";
import { toCsv } from "../../../../packages/core/csv";
import { type Env, one, all, run } from "./db";
import { RateLimited, withLane } from "./registers";
import { ingestEvent, processCompany } from "./process";
import { deliverAlert, deliverDigest } from "./delivery";
import { splitRows, matchChunk, finishImport, summarise } from "./imports";
import { renderReport } from "./report";
import { sendMail } from "./mail";
import { pruneRateWindows, hit } from "./limits";
import { runAgent, dueAgents, sweepRuns, startDue } from "./agents";
import { safeOutboundUrl } from "./web";
import { logError } from "./log";
import { TRIAL_DAYS } from "./billing";

export type Job =
  | { type: "import"; id: string; org_id: string; step: "split" | "match"; from?: number }
  | { type: "health_check"; id: string; step: "split" | "match" | "report"; from?: number }
  | { type: "company"; number: string; event_id: string; baseline?: boolean; lane?: "alert" | "bulk" }
  | { type: "deliver"; alert_id: string; channel_id: string; kind: "alert" | "share" }
  | { type: "webhook"; url: string; body: unknown }
  | { type: "digest"; org_id: string }
  | { type: "agent_run"; run_id: string }
  | { type: "agent_start"; agent_id: string; org_id: string; due: string }
  | { type: "reconcile_batch"; numbers: string[]; day: string }
  | { type: "prospect_build"; org_id: string; month: string }
  | { type: "purge_org"; org_id: string };

/** Set on a message that was put back on the queue to wait for register budget, so the wait is counted. */
type Waits = { _waits?: number };

/** Queue many jobs at once (the Queues API takes at most 100 messages per call). */
export async function sendMany(q: Queue<any>, jobs: Job[]) {
  for (let i = 0; i < jobs.length; i += 100) await q.sendBatch(jobs.slice(i, i + 100).map((body) => ({ body })));
}

/** Work that can wait for the register budget: it draws on the bulk lane, so it never crowds out alerts or live checks. */
const BULK = new Set(["import", "health_check", "reconcile_batch", "prospect_build"]);

export async function handleJob(rawEnv: Env, job: Job) {
  const env = job.type === "company" ? withLane(rawEnv, job.lane || (job.baseline ? "bulk" : "alert")) : BULK.has(job.type) ? withLane(rawEnv, "bulk") : rawEnv;
  switch (job.type) {
    case "company":
      return processCompany(env, job.number, job.event_id, { baselineOnly: job.baseline });
    case "agent_start":
      return startDue(env, job.org_id, job.agent_id, job.due);
    case "deliver":
      return deliverAlert(env, job.alert_id, job.channel_id, job.kind);
    case "digest":
      return deliverDigest(env, job.org_id);
    case "agent_run":
      return runAgent(env, job.run_id);
    case "webhook": {
      // Checked again at send time, and redirects are not followed: a webhook can't be pointed at a private address.
      let url: URL;
      try { url = safeOutboundUrl(env, job.url, env.ALLOW_ANY_WEBHOOK_HOST === "true"); } catch (e: any) { console.error("webhook refused", job.url, e?.message); return; }
      const res = await fetchT(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body), redirect: "manual" });
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
      return;
    }
    case "reconcile_batch":
      return reconcileBatch(env, job.numbers, job.day);
    case "prospect_build":
      return buildProspects(env, job.org_id, job.month);
    case "purge_org":
      return purgeOrg(env, job.org_id);
    case "import": {
      const imp = await one<any>(env, "SELECT * FROM import WHERE id = ? AND org_id = ?", job.id, job.org_id);
      if (!imp) return;
      if (job.step === "split") {
        await splitRows(env, job.id, job.org_id, imp.file_key);
        return env.JOBS.send({ ...job, step: "match", from: 0 });
      }
      const next = await matchChunk(env, job.id, job.from || 0, false);
      if (next !== null) { await summarise(env, job.id); return env.JOBS.send({ ...job, from: next }); }
      return finishImport(env, job.id, job.org_id);
    }
    case "health_check": {
      const hc = await one<any>(env, "SELECT * FROM health_check WHERE id = ?", job.id);
      if (!hc) return;
      if (job.step === "split") {
        await run(env, "INSERT OR IGNORE INTO import (id, org_id, file_key, status, created_at) VALUES (?,?,?,?,?)", hc.id, "hc", hc.file_key, "queued", nowIso());
        await run(env, "UPDATE health_check SET status = 'running' WHERE id = ?", hc.id);
        await splitRows(env, hc.id, "hc", hc.file_key);
        return env.JOBS.send({ ...job, step: "match", from: 0 });
      }
      if (job.step === "match") {
        const next = await matchChunk(env, hc.id, job.from || 0, true);
        if (next !== null) return env.JOBS.send({ ...job, from: next });
        return env.JOBS.send({ ...job, step: "report" });
      }
      const rows = await all<any>(env, "SELECT * FROM import_row WHERE import_id = ? ORDER BY row", hc.id);
      const { html, summary } = renderReport(hc, rows);
      const key = `reports/${hc.token}.html`;
      await env.FILES.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
      await run(env, "UPDATE health_check SET status = 'awaiting_approval', summary = ?, report_key = ? WHERE id = ?", JSON.stringify(summary), key, hc.id);
      // Tell the operator there is a report to approve. The customer hears nothing until approval.
      if (env.OPERATOR_EMAIL) await sendMail(env, { kind: "transactional", to: env.OPERATOR_EMAIL, subject: `Health check ready to approve: ${hc.company}`, text: `${summary.sent} clients, ${summary.flagged} flagged.\nApprove it in the admin queue: ${env.APP_URL}#/admin` });
      return;
    }
  }
}

/** Most waits for register budget before a message falls back to ordinary retries: about four hours. */
export const MAX_WAITS = 48;

/** Everything that ran out of retries lands here. Record it, tell the operator once an hour, and let it go. */
export async function onDeadLetters(batch: MessageBatch<any>, env: Env) {
  const at = nowIso();
  for (let i = 0; i < batch.messages.length; i += 50) {
    await env.DB.batch(batch.messages.slice(i, i + 50).map((m) => env.DB.prepare("INSERT OR IGNORE INTO dead_job (id, queue, type, body, attempts, at) VALUES (?,?,?,?,?,?)")
      .bind(m.id || newId("dead"), batch.queue, m.body?.type ?? null, JSON.stringify(m.body).slice(0, 8000), m.attempts ?? null, at)));
  }
  for (const m of batch.messages) m.ack();
  if (env.OPERATOR_EMAIL && (await hit(env, "dead_alert", "all", 1))) {
    const types = [...new Set(batch.messages.map((m) => m.body?.type || "unknown"))].join(", ");
    await sendMail(env, { kind: "transactional", to: env.OPERATOR_EMAIL, subject: `${batch.messages.length} jobs failed for good`, text: `Types: ${types}.\nThey are recorded in dead_job. See the admin queue: ${env.APP_URL}#/admin` });
  }
}

export async function onQueue(batch: MessageBatch<Job>, env: Env) {
  if (/dead/.test(batch.queue || "")) return onDeadLetters(batch, env);
  for (const msg of batch.messages) {
    try {
      await handleJob(env, msg.body);
      msg.ack();
    } catch (e: any) {
      const waits = (msg.body as Waits)._waits || 0;
      if (e instanceof RateLimited && waits < MAX_WAITS) {
        // Waiting for budget isn't a failure: put it back with a delay instead of spending one of its retries.
        try {
          await env.JOBS.send({ ...msg.body, _waits: waits + 1 }, { delaySeconds: e.retryAfterSec });
          msg.ack();
        } catch { msg.retry({ delaySeconds: e.retryAfterSec }); }
      } else {
        const b: any = msg.body;
        logError("job_failed", { type: b.type, attempts: msg.attempts, org: b.org_id ?? null, run: b.run_id ?? null, id: b.id ?? b.alert_id ?? b.number ?? null }, e);
        msg.retry({ delaySeconds: Math.min(600, 15 * 2 ** Math.min(msg.attempts, 5)) });
      }
    }
  }
}

/* ---------------- Scheduled ---------------- */

/** Gazette poller: new insolvency and strike-off notices since the last poll, matched to watched companies. */
export async function pollGazette(env: Env) {
  if (!env.GAZETTE_BASE) return 0;
  const since = (await env.CACHE.get("gazette:since")) || new Date(Date.now() - 864e5).toISOString();
  let newest = since;
  const res = await fetchT(`${env.GAZETTE_BASE.replace(/\/$/, "")}/notice/latest.json?since=${encodeURIComponent(since)}`);
  if (!res.ok) return 0;
  const j: any = await res.json();
  let n = 0;
  for (const notice of j.notices || []) {
    if (!notice.company_number) continue;
    if (notice.published && notice.published > newest) newest = notice.published;
    const r = await ingestEvent(env, { source: "gazette", source_id: String(notice.id), number: notice.company_number, kind: "gazette", occurred_at: notice.published, payload: { title: notice.title } });
    if (r === "queued") n++;
  }
  // Resume from the newest notice seen, not from "now": notices published while this poll ran aren't skipped.
  // Duplicates are harmless (events are unique by source id).
  await env.CACHE.put("gazette:since", newest);
  return n;
}

/**
 * Daily: re-read a seventh of the watched companies, so each is re-checked once a week to catch anything the stream
 * missed, without one huge Monday that would use the whole register budget. Fanned out to the queue in batches.
 */
export async function reconcile(env: Env, now = new Date(), opts: { all?: boolean } = {}) {
  // The operator can re-check everything at once (admin run with ?all=1); the cron takes one seventh a day.
  const nums = opts.all
    ? await all<{ number: string }>(env, "SELECT DISTINCT c.number FROM client c JOIN org o ON o.id = c.org_id WHERE c.watch_on = 1 AND o.cancelled_at IS NULL")
    : await all<{ number: string }>(env, `SELECT DISTINCT c.number FROM client c JOIN org o ON o.id = c.org_id
    WHERE c.watch_on = 1 AND o.cancelled_at IS NULL AND CAST(substr(c.number, 7, 2) AS INTEGER) % 7 = ?`, now.getUTCDay());
  const day = now.toISOString().slice(0, 10), jobs: Job[] = [];
  for (let i = 0; i < nums.length; i += 50) jobs.push({ type: "reconcile_batch", numbers: nums.slice(i, i + 50).map((n) => n.number), day });
  await sendMany(env.JOBS, jobs);
  return nums.length;
}

async function reconcileBatch(env: Env, numbers: string[], day: string) {
  const out: Job[] = [];
  for (const number of numbers) {
    const id = newId("evt");
    const r = await run(env, "INSERT INTO register_event (id, number, kind, occurred_at, source, source_id) VALUES (?,?,?,?,?,?) ON CONFLICT(source, source_id) DO NOTHING",
      id, number, "reconcile", nowIso(), "reconcile", `${day}:${number}`);
    if (r.meta.changes) out.push({ type: "company", number, event_id: id, lane: "bulk" });
  }
  await sendMany(env.JOBS, out);
}

/** Daily at 07:00: digests for orgs on daily, and on Mondays for orgs on weekly. */
export async function digests(env: Env, now = new Date()) {
  const monday = now.getUTCDay() === 1;
  const orgs = await all<any>(env, "SELECT a.org_id, a.digest FROM agent_config a JOIN org o ON o.id = a.org_id WHERE a.agent = 'watch' AND a.on_ = 1 AND o.cancelled_at IS NULL");
  const due = orgs.filter((o) => o.digest === "daily" || monday);
  await sendMany(env.JOBS, due.map((o) => ({ type: "digest", org_id: o.org_id })));
  return orgs.length;
}

/** Monthly: prospect lists for orgs running the prospect finder. One queued job per business. */
export async function monthly(env: Env, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const orgs = await all<any>(env, "SELECT o.id FROM org o JOIN agent_config a ON a.org_id = o.id AND a.agent = 'prospect' AND a.on_ = 1 WHERE o.cancelled_at IS NULL");
  await sendMany(env.JOBS, orgs.map((o) => ({ type: "prospect_build", org_id: o.id, month })));
  return orgs.length;
}

async function buildProspects(env: Env, orgId: string, month: string) {
  const o = await one<any>(env, "SELECT * FROM org WHERE id = ? AND cancelled_at IS NULL", orgId);
  if (!o) return;
  const key = `prospects/${o.id}/${month}.csv`;
  if (await env.FILES.head(key)) return; // already built this month: a retried message does nothing
  const rows = await prospectRows(env, o, 5000);
  await env.FILES.put(key, toCsv([["Company", "Company no.", "District", "SIC", "Incorporated"], ...rows.map((r) => [r.name, r.number, r.district, r.sic, r.incorporated])]), { httpMetadata: { contentType: "text/csv" } });
  await run(env, "INSERT INTO usage_event (id, org_id, kind, units, cost_pence, payment, at) VALUES (?,?,?,?,0,'plan',?)", newId("use"), o.id, "prospect_build", rows.length, nowIso());
  const owner = await one<any>(env, "SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1", o.id);
  if (owner) await sendMail(env, { kind: "transactional", to: owner.email, subject: `Your prospect list for ${month}`, text: `${rows.length} active companies match your districts and industries.\nDownload it from the workspace: ${env.APP_URL}#/workspace/prospects` });
}

export async function prospectRows(env: Env, o: any, limit: number) {
  const districts: string[] = JSON.parse(o.prospect_districts || "[]");
  const sic: string[] = JSON.parse(o.prospect_sic || "[]");
  if (!districts.length || !sic.length) return [];
  const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(o.prospect_min_age || 0));
  // The lists go in as two JSON parameters: D1 allows 100 bound parameters a query, and a wide area has more.
  return all<any>(env, `SELECT * FROM company_index WHERE status = 'Active'
    AND district IN (SELECT value FROM json_each(?)) AND substr(sic,1,2) IN (SELECT value FROM json_each(?)) AND incorporated <= ?
    AND number NOT IN (SELECT number FROM client WHERE org_id = ?) ORDER BY district, name LIMIT ?`,
    JSON.stringify(districts), JSON.stringify(sic), cutoff.toISOString().slice(0, 10), o.id, limit);
}

/** Tables holding a business's own data. Deleted in full 30 days after cancellation. */
export const ORG_TABLES = [
  "client", "import_row", "import", "agent_config", "channel", "alert", "delivery", "brief",
  "agent", "agent_run", "agent_action", "lead", "task", "invoice", "inbox_message",
  "usage_event", "api_key", "session", "membership",
  "swarm", "work_item", "swarm_event", "contact", "deal", "activity", "agent_task", "house_rule",
  "os_record", "os_channel", "os_message",
  "org_os", "org_module", "custom_field", "custom_app", "os_change", "org_layout",
] as const;

/** Rows deleted per statement, and statements per invocation, so a big workspace never meets D1's time or query limits. */
const CHUNK = 2000, MAX_STATEMENTS = 300;

async function deletePrefix(env: Env, prefix: string) {
  let cursor: string | undefined, n = 0;
  do {
    const l = await env.FILES.list({ prefix, cursor, limit: 1000 });
    const keys = l.objects.map((o) => o.key);
    if (keys.length) await env.FILES.delete(keys);
    n += keys.length;
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return n;
}

/**
 * Delete everything a cancelled business left with us: every workspace table, agent transcripts, prospect
 * lists and uploaded files. People who belong to no other workspace are removed too. The audit log keeps
 * what happened, with targets and details cleared. Deletes go in chunks; a large workspace takes several
 * passes, each queued as its own job. Safe to retry.
 */
export async function purgeOrg(env: Env, orgId: string): Promise<{ skipped?: boolean; more?: boolean; files?: number; people?: number }> {
  const org = await one<any>(env, "SELECT id, cancelled_at, purged_at FROM org WHERE id = ?", orgId);
  if (!org || !org.cancelled_at || org.purged_at) return { skipped: true };
  const files = (await deletePrefix(env, `runs/${orgId}/`)) + (await deletePrefix(env, `prospects/${orgId}/`)) + (await deletePrefix(env, `imports/${orgId}/`));
  let statements = 0;
  for (const t of ORG_TABLES) {
    if (t === "membership") continue; // last, below: it says who else to remove
    for (;;) {
      if (statements++ >= MAX_STATEMENTS) { await env.JOBS.send({ type: "purge_org", org_id: orgId }); return { more: true, files }; }
      const r = await run(env, `DELETE FROM ${t} WHERE rowid IN (SELECT rowid FROM ${t} WHERE org_id = ? LIMIT ${CHUNK})`, orgId);
      if ((r.meta.changes || 0) < CHUNK) break;
    }
  }
  const members = await all<any>(env, "SELECT user_id FROM membership WHERE org_id = ?", orgId);
  await run(env, "DELETE FROM membership WHERE org_id = ?", orgId);
  for (const m of members) {
    const elsewhere = await one(env, "SELECT 1 AS x FROM membership WHERE user_id = ? LIMIT 1", m.user_id);
    if (elsewhere) continue;
    const u = await one<any>(env, "SELECT email FROM user WHERE id = ?", m.user_id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(m.user_id),
      env.DB.prepare("DELETE FROM magic_link WHERE email = ?").bind(u?.email ?? ""),
      env.DB.prepare("DELETE FROM user WHERE id = ?").bind(m.user_id),
    ]);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE audit_log SET target = NULL, detail = NULL WHERE org_id = ?").bind(orgId),
    env.DB.prepare("UPDATE org SET name = 'Deleted workspace', profile = '{}', prospect_districts = '[]', inbox_alias = NULL, purged_at = ? WHERE id = ?").bind(nowIso(), orgId),
  ]);
  await run(env, "INSERT INTO audit_log (id, org_id, actor, action, detail, at) VALUES (?,?,?,?,?,?)", newId("aud"), orgId, "system", "org_purged", JSON.stringify({ files, people: members.length }), nowIso());
  return { files, people: members.length };
}

/** Repeat a chunked statement until it touches fewer rows than a chunk, within a statement budget. Returns rows touched. */
async function chunked(env: Env, sql: string, args: any[], budget = 50) {
  let total = 0;
  for (let i = 0; i < budget; i++) {
    const n = (await run(env, sql, ...args)).meta.changes || 0;
    total += n;
    if (n < CHUNK) break;
  }
  return total;
}

const DAY_MS = 864e5;
const isoAgo = (days: number, now: number) => new Date(now - days * DAY_MS).toISOString();
const REMOVED = "(Removed after 90 days.)";

/**
 * Daily: delete what we promised to delete, and trim what grows without limit. Each step runs on its own, in
 * chunks, so one slow step can't stop the rest. Counts go to the audit log, never contents.
 */
export async function retention(env: Env, nowMs = Date.now()) {
  // Bodies are cleared from 90 days back to a year: wide enough to catch up after missed days, narrow enough to stay small.
  const cutoff = isoAgo(30, nowMs), d90 = isoAgo(90, nowMs), yearBack = isoAgo(455, nowMs);
  const done: Record<string, number | string> = {};
  const step = async (name: string, f: () => Promise<number>) => {
    try { done[name] = await f(); } catch (e: any) { done[name] = "failed: " + String(e?.message || e).slice(0, 120); console.error("retention step failed", name, e); }
  };
  await step("health_checks", async () => {
    const old = await all<any>(env, "SELECT * FROM health_check WHERE created_at < ? LIMIT 100", cutoff);
    for (const h of old) {
      await env.FILES.delete(h.file_key); if (h.report_key) await env.FILES.delete(h.report_key);
      await chunked(env, `DELETE FROM import_row WHERE rowid IN (SELECT rowid FROM import_row WHERE import_id = ? LIMIT ${CHUNK})`, [h.id], 10);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM import WHERE id = ?").bind(h.id),
        env.DB.prepare("DELETE FROM health_check WHERE id = ?").bind(h.id),
      ]);
    }
    return old.length;
  });
  // A trial that ended without a plan is closed 30 days after it ended (so it's purged with the cancelled ones below),
  // and its owner is warned a week before.
  await step("trials", async () => {
    const warnFrom = isoAgo(TRIAL_DAYS + 24, nowMs), warnTo = isoAgo(TRIAL_DAYS + 23, nowMs);
    const warn = await all<any>(env, "SELECT id, name FROM org WHERE plan = 'trial' AND cancelled_at IS NULL AND created_at >= ? AND created_at < ?", warnFrom, warnTo);
    for (const o of warn) {
      const owner = await one<any>(env, "SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1", o.id);
      if (owner) await sendMail(env, { kind: "transactional", to: owner.email, subject: `Your Agent House workspace for ${o.name} will be deleted in 7 days`, text: `Your free trial ended over three weeks ago. In 7 days we'll delete the workspace and everything in it.
To keep it, choose a plan: ${env.APP_URL}#/workspace/usage
To take a copy first, export it from the same page.` });
    }
    const ended = await all<any>(env, "SELECT id, created_at FROM org WHERE plan = 'trial' AND cancelled_at IS NULL AND created_at < ? LIMIT 500", isoAgo(TRIAL_DAYS + 30, nowMs));
    for (const o of ended) await run(env, "UPDATE org SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL", new Date(Date.parse(o.created_at) + TRIAL_DAYS * DAY_MS).toISOString(), o.id);
    return ended.length;
  });
  // Each cancelled business is purged by its own queued job, so one large workspace can't stall the rest.
  await step("orgs", async () => {
    const gone = await all<any>(env, "SELECT id FROM org WHERE cancelled_at IS NOT NULL AND cancelled_at < ? AND purged_at IS NULL", cutoff);
    await sendMany(env.JOBS, gone.map((o) => ({ type: "purge_org", org_id: o.id })));
    return gone.length;
  });
  await step("import_files", async () => {
    const imports = await all<any>(env, "SELECT id, file_key FROM import WHERE created_at < ? AND created_at >= ? AND org_id != 'hc' LIMIT 500", cutoff, isoAgo(37, nowMs));
    for (const i of imports) await env.FILES.delete(i.file_key);
    return imports.length;
  });
  await step("rate_windows", async () => {
    await run(env, "DELETE FROM rate_window WHERE bucket >= 'ch:' AND bucket < ?", "ch:" + Math.floor(nowMs / 300000 - 12));
    await pruneRateWindows(env, new Date(nowMs));
    return 1;
  });
  await step("x402_payments", () => chunked(env, `DELETE FROM x402_payment WHERE rowid IN (SELECT rowid FROM x402_payment WHERE at < ? LIMIT ${CHUNK})`, [isoAgo(1, nowMs)]));
  await step("magic_links", () => chunked(env, `DELETE FROM magic_link WHERE rowid IN (SELECT rowid FROM magic_link WHERE expires_at < ? LIMIT ${CHUNK})`, [cutoff]));
  await step("sessions", () => chunked(env, `DELETE FROM session WHERE rowid IN (SELECT rowid FROM session WHERE expires_at < ? LIMIT ${CHUNK})`, [new Date(nowMs).toISOString()]));
  // The Floor's log is kept 30 days. Ids rise with time, so find the first id to keep and delete below it by id.
  await step("swarm_events", async () => {
    const keep = await one<any>(env, "SELECT id FROM swarm_event WHERE at >= ? ORDER BY id LIMIT 1", cutoff);
    const below = keep?.id ?? ((await one<any>(env, "SELECT MAX(id) AS id FROM swarm_event"))?.id ?? 0) + 1;
    return chunked(env, `DELETE FROM swarm_event WHERE id IN (SELECT id FROM swarm_event WHERE id < ? ORDER BY id LIMIT ${CHUNK})`, [below]);
  });
  await step("register_events", () => chunked(env, `DELETE FROM register_event WHERE rowid IN (SELECT rowid FROM register_event WHERE processed_at < ? LIMIT ${CHUNK})`, [d90]));
  // Message and draft bodies are cleared after 90 days; the rows stay, so history and counts still add up.
  // Only the year past the line is looked at each day, so the scan stays bounded however old the workspace.
  await step("inbox_bodies", () => chunked(env, `UPDATE inbox_message SET body = NULL WHERE rowid IN (SELECT rowid FROM inbox_message WHERE received_at < ? AND received_at >= ? AND body IS NOT NULL LIMIT ${CHUNK})`, [d90, yearBack]));
  await step("draft_bodies", () => chunked(env, `UPDATE agent_action SET payload = json_set(payload, '$.body', '${REMOVED}') WHERE rowid IN (SELECT rowid FROM agent_action
    WHERE decided_at < ? AND decided_at >= ? AND status != 'proposed' AND json_extract(payload, '$.body') IS NOT NULL AND json_extract(payload, '$.body') != '${REMOVED}' LIMIT ${CHUNK})`, [d90, yearBack]));
  await run(env, "INSERT INTO audit_log (id, org_id, actor, action, detail, at) VALUES (?,?,?,?,?,?)", newId("aud"), null, "system", "retention", JSON.stringify(done), nowIso());
  return done;
}

/**
 * Each cron and how often it runs, in minutes (the monthly one is checked as if daily, since it fires on the 1st to
 * 3rd). Every run leaves a heartbeat in KV, and /api/health reports a cron as overdue at twice its interval, so a
 * cron that was never attached, or stopped, is visible instead of silent.
 */
export const CRON_EVERY_MIN: Record<string, number> = { "*/15 * * * *": 15, "*/30 * * * *": 30, "0 6 * * *": 1440, "0 7 * * *": 1440, "0 8 1-3 * *": 1440 * 31, "0 3 * * *": 1440 };

export async function cronHealth(env: Env, now = Date.now()) {
  const out: Record<string, { last: string | null; overdue: boolean }> = {};
  for (const [cron, every] of Object.entries(CRON_EVERY_MIN)) {
    const last = await env.CACHE.get("cron:" + cron);
    out[cron] = { last, overdue: !!last && now - Date.parse(last) > 2 * every * 60000 };
  }
  return out;
}

export async function onScheduled(controller: ScheduledController, env: Env) {
  try { return await runScheduled(controller, env); }
  finally { await env.CACHE.put("cron:" + controller.cron, nowIso()).catch((e: any) => console.error("cron heartbeat not saved", e)); }
}

async function runScheduled(controller: ScheduledController, env: Env) {
  const cron = controller.cron;
  if (cron === "*/30 * * * *") return pollGazette(env);
  if (cron === "*/15 * * * *") {
    await sweepRuns(env, new Date(controller.scheduledTime));
    return dueAgents(env, new Date(controller.scheduledTime));
  }
  if (cron === "0 6 * * *") return reconcile(env, new Date(controller.scheduledTime));
  if (cron === "0 7 * * *") return digests(env, new Date(controller.scheduledTime));
  if (cron === "0 8 1-3 * *") {
    // Runs on the first working day of the month: the 1st, or the Monday after a weekend 1st.
    const d = new Date(controller.scheduledTime);
    let first = 1;
    while ([0, 6].includes(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), first)).getUTCDay())) first++;
    if (d.getUTCDate() === first) return monthly(env, d);
    return;
  }
  if (cron === "0 3 * * *") return retention(env);
}
