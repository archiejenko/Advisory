// The job runner: one queue consumer and the scheduled tasks. Every step is safe to retry.
import { newId, nowIso, longDate } from "../../../../packages/core/util";
import { toCsv } from "../../../../packages/core/csv";
import { type Env, one, all, run } from "./db";
import { RateLimited } from "./registers";
import { ingestEvent, processCompany } from "./process";
import { deliverAlert, deliverDigest } from "./delivery";
import { splitRows, matchChunk, finishImport, summarise } from "./imports";
import { renderReport } from "./report";
import { sendMail } from "./mail";
import { pruneRateWindows } from "./limits";
import { runAgent, dueAgents, sweepRuns } from "./agents";
import { safeOutboundUrl } from "./web";

export type Job =
  | { type: "import"; id: string; org_id: string; step: "split" | "match"; from?: number }
  | { type: "health_check"; id: string; step: "split" | "match" | "report"; from?: number }
  | { type: "company"; number: string; event_id: string; baseline?: boolean }
  | { type: "deliver"; alert_id: string; channel_id: string; kind: "alert" | "share" }
  | { type: "webhook"; url: string; body: unknown }
  | { type: "digest"; org_id: string }
  | { type: "agent_run"; run_id: string }
  | { type: "reconcile_batch"; numbers: string[]; day: string }
  | { type: "prospect_build"; org_id: string; month: string }
  | { type: "purge_org"; org_id: string };

/** Queue many jobs at once (the Queues API takes at most 100 messages per call). */
export async function sendMany(q: Queue<any>, jobs: Job[]) {
  for (let i = 0; i < jobs.length; i += 100) await q.sendBatch(jobs.slice(i, i + 100).map((body) => ({ body })));
}

export async function handleJob(env: Env, job: Job) {
  switch (job.type) {
    case "company":
      return processCompany(env, job.number, job.event_id, { baselineOnly: job.baseline });
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
      const res = await fetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body), redirect: "manual" });
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
      if (env.OPERATOR_EMAIL) await sendMail(env, { to: env.OPERATOR_EMAIL, subject: `Health check ready to approve: ${hc.company}`, text: `${summary.sent} clients, ${summary.flagged} flagged.\nApprove it in the admin queue: ${env.APP_URL}#/admin` });
      return;
    }
  }
}

export async function onQueue(batch: MessageBatch<Job>, env: Env) {
  for (const msg of batch.messages) {
    try {
      await handleJob(env, msg.body);
      msg.ack();
    } catch (e: any) {
      if (e instanceof RateLimited) msg.retry({ delaySeconds: e.retryAfterSec });
      else {
        console.error("job failed", msg.body.type, e?.message);
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
  const res = await fetch(`${env.GAZETTE_BASE.replace(/\/$/, "")}/notice/latest.json?since=${encodeURIComponent(since)}`);
  if (!res.ok) return 0;
  const j: any = await res.json();
  let n = 0;
  for (const notice of j.notices || []) {
    if (!notice.company_number) continue;
    const r = await ingestEvent(env, { source: "gazette", source_id: String(notice.id), number: notice.company_number, kind: "gazette", occurred_at: notice.published, payload: { title: notice.title } });
    if (r === "queued") n++;
  }
  await env.CACHE.put("gazette:since", nowIso());
  return n;
}

/** Weekly: re-read every watched company to catch anything the stream missed. Fanned out to the queue in batches. */
export async function reconcile(env: Env) {
  const nums = await all<{ number: string }>(env, "SELECT DISTINCT c.number FROM client c JOIN org o ON o.id = c.org_id WHERE c.watch_on = 1 AND o.cancelled_at IS NULL");
  const day = nowIso().slice(0, 10), jobs: Job[] = [];
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
    if (r.meta.changes) out.push({ type: "company", number, event_id: id });
  }
  await sendMany(env.JOBS, out);
}

/** Daily at 07:00: digests for orgs on daily, and on Mondays for orgs on weekly. */
export async function digests(env: Env, now = new Date()) {
  const monday = now.getUTCDay() === 1;
  const orgs = await all<any>(env, "SELECT a.org_id, a.digest FROM agent_config a JOIN org o ON o.id = a.org_id WHERE a.agent = 'watch' AND a.on_ = 1 AND o.cancelled_at IS NULL");
  for (const o of orgs) if (o.digest === "daily" || monday) await env.JOBS.send({ type: "digest", org_id: o.org_id });
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
  if (owner) await sendMail(env, { to: owner.email, subject: `Your prospect list for ${month}`, text: `${rows.length} active companies match your districts and industries.\nDownload it from the workspace: ${env.APP_URL}#/workspace/prospects` });
}

export async function prospectRows(env: Env, o: any, limit: number) {
  const districts: string[] = JSON.parse(o.prospect_districts || "[]");
  const sic: string[] = JSON.parse(o.prospect_sic || "[]");
  if (!districts.length || !sic.length) return [];
  const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(o.prospect_min_age || 0));
  const dq = districts.map(() => "?").join(","), sq = sic.map(() => "substr(sic,1,2) = ?").join(" OR ");
  return all<any>(env, `SELECT * FROM company_index WHERE status = 'Active' AND district IN (${dq}) AND (${sq}) AND incorporated <= ?
    AND number NOT IN (SELECT number FROM client WHERE org_id = ?) ORDER BY district, name LIMIT ?`,
    ...districts, ...sic, cutoff.toISOString().slice(0, 10), o.id, limit);
}

/** Tables holding a business's own data. Deleted in full 30 days after cancellation. */
export const ORG_TABLES = [
  "client", "import_row", "import", "agent_config", "channel", "alert", "delivery", "brief",
  "agent", "agent_run", "agent_action", "lead", "task", "invoice", "inbox_message",
  "usage_event", "api_key", "session", "membership",
  "swarm", "work_item", "swarm_event", "contact", "deal", "activity", "agent_task",
] as const;

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
 * what happened, with targets and details cleared. Safe to retry.
 */
export async function purgeOrg(env: Env, orgId: string) {
  const org = await one<any>(env, "SELECT id, cancelled_at, purged_at FROM org WHERE id = ?", orgId);
  if (!org || !org.cancelled_at || org.purged_at) return { skipped: true };
  const files = (await deletePrefix(env, `runs/${orgId}/`)) + (await deletePrefix(env, `prospects/${orgId}/`)) + (await deletePrefix(env, `imports/${orgId}/`));
  const members = await all<any>(env, "SELECT user_id FROM membership WHERE org_id = ?", orgId);
  await env.DB.batch(ORG_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE org_id = ?`).bind(orgId)));
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

/** Daily: delete what we promised to delete. Counts go to the audit log, never contents. */
export async function retention(env: Env) {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const old = await all<any>(env, "SELECT * FROM health_check WHERE created_at < ?", cutoff);
  for (const h of old) {
    await env.FILES.delete(h.file_key); if (h.report_key) await env.FILES.delete(h.report_key);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM import_row WHERE import_id = ?").bind(h.id),
      env.DB.prepare("DELETE FROM import WHERE id = ?").bind(h.id),
      env.DB.prepare("DELETE FROM health_check WHERE id = ?").bind(h.id),
    ]);
  }
  // Each cancelled business is purged by its own queued job, so one large workspace can't stall the rest.
  const gone = await all<any>(env, "SELECT id FROM org WHERE cancelled_at IS NOT NULL AND cancelled_at < ? AND purged_at IS NULL", cutoff);
  await sendMany(env.JOBS, gone.map((o) => ({ type: "purge_org", org_id: o.id })));
  const imports = await all<any>(env, "SELECT id, file_key FROM import WHERE org_id != 'hc' AND created_at < ?", cutoff);
  for (const i of imports) await env.FILES.delete(i.file_key);
  await run(env, "INSERT INTO audit_log (id, org_id, actor, action, detail, at) VALUES (?,?,?,?,?,?)", newId("aud"), null, "system", "retention",
    JSON.stringify({ health_checks: old.length, orgs: gone.length, import_files: imports.length }), nowIso());
  await run(env, "DELETE FROM rate_window WHERE bucket < ?", "ch:" + Math.floor(Date.now() / 300000 - 12));
  await pruneRateWindows(env);
  await run(env, "DELETE FROM magic_link WHERE expires_at < ?", cutoff);
  await run(env, "DELETE FROM swarm_event WHERE at < ?", cutoff); // the Floor's log is kept 30 days
  await run(env, "DELETE FROM session WHERE expires_at < ?", nowIso());
  return { health_checks: old.length, orgs: gone.length };
}

export async function onScheduled(controller: ScheduledController, env: Env) {
  const cron = controller.cron;
  if (cron === "*/30 * * * *") return pollGazette(env);
  if (cron === "*/15 * * * *") {
    await sweepRuns(env, new Date(controller.scheduledTime));
    return dueAgents(env, new Date(controller.scheduledTime));
  }
  if (cron === "0 6 * * 1") return reconcile(env);
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
