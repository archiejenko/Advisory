// From a register change to an alert in every watching MSP's inbox.
import { runChecks, type CompanyRecord } from "../../../../packages/core/checks";
import { canonical, newId, nowIso } from "../../../../packages/core/util";
import { signBody } from "../../../../packages/core/sign";
import { type Env, one, all, run } from "./db";
import { fetchCompany, storeCompany, storedCompany } from "./registers";
import { signingKey } from "./crypto";

export type IncomingEvent = { source: string; source_id: string; number: string; kind: string; occurred_at?: string; timepoint?: number; payload?: unknown };

export async function isWatched(env: Env, number: string) {
  const c = await one(env, "SELECT 1 AS x FROM client WHERE number = ? AND watch_on = 1 LIMIT 1", number);
  if (c) return true;
  const w = await one(env, "SELECT 1 AS x FROM watch_number n JOIN watch_subscription s ON s.id = n.watch_id JOIN api_key k ON k.id = s.key_id WHERE n.number = ? AND s.deleted_at IS NULL AND k.revoked_at IS NULL LIMIT 1", number);
  return !!w;
}

/** Store an event if anyone watches the company, and queue it. Returns whether it was queued. */
export async function ingestEvent(env: Env, e: IncomingEvent): Promise<"queued" | "duplicate" | "not_watched"> {
  if (!(await isWatched(env, e.number))) return "not_watched";
  const id = newId("evt");
  const r = await run(env, `INSERT INTO register_event (id, number, kind, occurred_at, source, source_id, payload, stream_timepoint) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(source, source_id) DO NOTHING`, id, e.number, e.kind, e.occurred_at || nowIso(), e.source, e.source_id, e.payload ? JSON.stringify(e.payload).slice(0, 4000) : null, e.timepoint ?? null);
  if (!r.meta.changes) return "duplicate";
  await env.JOBS.send({ type: "company", number: e.number, event_id: id });
  return "queued";
}

/**
 * Re-read the company, compare with what we stored, and raise alerts for every watcher.
 * Idempotent: alerts are unique per (org, event, check), so a retried message creates nothing new.
 */
export async function processCompany(env: Env, number: string, eventId: string, opts: { baselineOnly?: boolean } = {}) {
  const prev = await storedCompany(env, number);
  const next = await fetchCompany(env, number);
  if (!next) return { findings: 0, alerts: 0 };
  await storeCompany(env, next);
  await run(env, "UPDATE register_event SET processed_at = ? WHERE id = ?", nowIso(), eventId);
  if (!prev || opts.baselineOnly) return { findings: 0, alerts: 0, baseline: true };

  const watchers = await all<any>(env, `SELECT c.*, a.on_ AS agent_on, a.channel_id FROM client c
    JOIN agent_config a ON a.org_id = c.org_id AND a.agent = 'watch'
    JOIN org o ON o.id = c.org_id AND o.cancelled_at IS NULL
    WHERE c.number = ? AND c.watch_on = 1`, number);
  let alerts = 0, findingsCount = 0;
  for (const w of watchers) {
    if (!w.agent_on) continue;
    const findings = runChecks(prev, next, { nextInvoice: w.next_invoice, monthlyFee: w.monthly_fee, since: w.since, users: w.users });
    findingsCount = findings.length;
    for (const f of findings) {
      const id = newId("al");
      const ins = await run(env, `INSERT INTO alert (id, org_id, number, event_id, agent, check_key, severity, title, summary, facts, next_step, created_at)
        VALUES (?,?,?,?, 'watch', ?,?,?,?,?,?,?) ON CONFLICT(org_id, event_id, check_key) DO NOTHING`,
        id, w.org_id, number, eventId, f.check, f.severity, f.title, f.summary, JSON.stringify(f.facts), f.next, nowIso());
      if (!ins.meta.changes) continue;
      alerts++;
      // Critical alerts go at once; Review alerts wait for the digest.
      if (f.severity === "Critical" && w.channel_id) await env.JOBS.send({ type: "deliver", alert_id: id, channel_id: w.channel_id, kind: "alert" });
    }
    await run(env, "INSERT INTO usage_event (id, org_id, kind, number, units, cost_pence, payment, at) VALUES (?,?,?,?,1,0,'plan',?)", newId("use"), w.org_id, "watch_run", number, nowIso());
  }
  await notifyWatchSubscribers(env, prev, next, eventId);
  return { findings: findingsCount, alerts };
}

/** Developers watching through the Truth API get a signed webhook per change. */
/** Live watches on a company, from keys that haven't been revoked. */
export function watchersOf(env: Env, number: string) {
  return all<any>(env, `SELECT s.* FROM watch_number n JOIN watch_subscription s ON s.id = n.watch_id JOIN api_key k ON k.id = s.key_id
    WHERE n.number = ? AND s.deleted_at IS NULL AND k.revoked_at IS NULL`, number);
}

async function notifyWatchSubscribers(env: Env, prev: CompanyRecord, next: CompanyRecord, eventId: string) {
  const subs = await watchersOf(env, next.number);
  if (!subs.length) return;
  const findings = runChecks(prev, next);
  if (!findings.length) return;
  const key = await signingKey(env);
  for (const s of subs) {
    const body = await signBody({ response_id: newId("wev"), watch_id: s.id, event_id: eventId, number: next.number, name: next.name,
      changes: findings.map((f) => ({ check: f.check, severity: f.severity, text: f.title, detail: f.summary, source: f.facts[0]?.[2] })), checked_at: next.retrieved_at }, key, env.SIGNING_KID);
    await env.JOBS.send({ type: "webhook", url: s.webhook, body });
  }
}

export const sameRecord = (a?: CompanyRecord, b?: CompanyRecord) => !!a && !!b && canonical({ ...a, retrieved_at: 0 }) === canonical({ ...b, retrieved_at: 0 });
