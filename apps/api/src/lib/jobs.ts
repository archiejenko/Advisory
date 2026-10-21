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
import { runAgent, dueAgents } from "./agents";

export type Job =
  | { type: "import"; id: string; org_id: string; step: "split" | "match"; from?: number }
  | { type: "health_check"; id: string; step: "split" | "match" | "report"; from?: number }
  | { type: "company"; number: string; event_id: string; baseline?: boolean }
  | { type: "deliver"; alert_id: string; channel_id: string; kind: "alert" | "share" }
  | { type: "webhook"; url: string; body: unknown }
  | { type: "digest"; org_id: string }
  | { type: "agent_run"; run_id: string };

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
      const res = await fetch(job.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job.body) });
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
      return;
    }
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

/** Weekly: re-read every watched company to catch anything the stream missed. */
export async function reconcile(env: Env) {
  const nums = await all<{ number: string }>(env, "SELECT DISTINCT number FROM client WHERE watch_on = 1");
  const day = nowIso().slice(0, 10);
  for (const { number } of nums) {
    const id = newId("evt");
    const r = await run(env, "INSERT INTO register_event (id, number, kind, occurred_at, source, source_id) VALUES (?,?,?,?,?,?) ON CONFLICT(source, source_id) DO NOTHING",
      id, number, "reconcile", nowIso(), "reconcile", `${day}:${number}`);
    if (r.meta.changes) await env.JOBS.send({ type: "company", number, event_id: id });
  }
  return nums.length;
}

/** Daily at 07:00: digests for orgs on daily, and on Mondays for orgs on weekly. */
export async function digests(env: Env, now = new Date()) {
  const monday = now.getUTCDay() === 1;
  const orgs = await all<any>(env, "SELECT org_id, digest FROM agent_config WHERE agent = 'watch' AND on_ = 1");
  for (const o of orgs) if (o.digest === "daily" || monday) await env.JOBS.send({ type: "digest", org_id: o.org_id });
  return orgs.length;
}

/** Monthly: prospect lists for orgs running the prospect finder, and extra-client usage to Stripe. */
export async function monthly(env: Env, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const orgs = await all<any>(env, "SELECT o.*, a.channel_id FROM org o JOIN agent_config a ON a.org_id = o.id AND a.agent = 'prospect' AND a.on_ = 1 WHERE o.cancelled_at IS NULL");
  for (const o of orgs) {
    const rows = await prospectRows(env, o, 5000);
    await env.FILES.put(`prospects/${o.id}/${month}.csv`, toCsv([["Company", "Company no.", "District", "SIC", "Incorporated"], ...rows.map((r) => [r.name, r.number, r.district, r.sic, r.incorporated])]), { httpMetadata: { contentType: "text/csv" } });
    await run(env, "INSERT INTO usage_event (id, org_id, kind, units, cost_pence, payment, at) VALUES (?,?,?,?,0,'plan',?)", newId("use"), o.id, "prospect_build", rows.length, nowIso());
    const owner = await one<any>(env, "SELECT u.email FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1", o.id);
    if (owner) await sendMail(env, { to: owner.email, subject: `Your prospect list for ${month}`, text: `${rows.length} active companies match your districts and industries.\nDownload it from the workspace: ${env.APP_URL}#/workspace/prospects` });
  }
  return orgs.length;
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
  const gone = await all<any>(env, "SELECT id FROM org WHERE cancelled_at IS NOT NULL AND cancelled_at < ?", cutoff);
  for (const o of gone) {
    await env.DB.batch(["client", "import_row", "import", "agent_config", "channel", "alert", "delivery", "brief", "membership"].map((t) =>
      env.DB.prepare(`DELETE FROM ${t} WHERE org_id = ?`).bind(o.id)));
  }
  const imports = await all<any>(env, "SELECT id, file_key FROM import WHERE org_id != 'hc' AND created_at < ?", cutoff);
  for (const i of imports) await env.FILES.delete(i.file_key);
  await run(env, "INSERT INTO audit_log (id, org_id, actor, action, detail, at) VALUES (?,?,?,?,?,?)", newId("aud"), null, "system", "retention",
    JSON.stringify({ health_checks: old.length, orgs: gone.length, import_files: imports.length }), nowIso());
  await run(env, "DELETE FROM rate_window WHERE bucket < ?", "ch:" + Math.floor(Date.now() / 300000 - 12));
  return { health_checks: old.length, orgs: gone.length };
}

export async function onScheduled(controller: ScheduledController, env: Env) {
  const cron = controller.cron;
  if (cron === "*/30 * * * *") return pollGazette(env);
  if (cron === "*/15 * * * *") return dueAgents(env, new Date(controller.scheduledTime));
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
