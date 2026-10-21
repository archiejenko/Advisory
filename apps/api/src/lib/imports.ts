// Client lists, for workspace imports and for public health checks. Processed in chunks so a
// 500-row list survives the Companies House rate limit: a chunk that hits the limit is retried later.
import { mapClientColumns, parseCsv } from "../../../../packages/core/csv";
import { readXlsx } from "../../../../packages/core/xlsx";
import { runChecks } from "../../../../packages/core/checks";
import { findPostcode } from "../../../../packages/core/match";
import { newId, nowIso } from "../../../../packages/core/util";
import { type Env, one, all, run } from "./db";
import { resolveInput } from "./truth";
import { companyCached, storeCompany } from "./registers";

const CHUNK = 20;
const MAX_ROWS = 2000;

export async function readTable(env: Env, key: string): Promise<string[][]> {
  const obj = await env.FILES.get(key);
  if (!obj) throw new Error("Uploaded file not found");
  const buf = await obj.arrayBuffer();
  if (/\.xlsx$/i.test(key)) return readXlsx(buf);
  if (/\.xls$/i.test(key)) throw new Error("Old .xls files aren't supported. Save it as .xlsx or CSV.");
  return parseCsv(new TextDecoder().decode(buf));
}

/** First step: split the file into rows. Accepts a list with or without a header row. */
export async function splitRows(env: Env, importId: string, orgId: string, fileKey: string) {
  const table = await readTable(env, fileKey);
  if (!table.length) throw new Error("The file has no rows.");
  let cols = mapClientColumns(table[0]);
  let rows = table.slice(1);
  if (cols.name < 0 && cols.number < 0) { cols = { ...cols, name: 0 }; rows = table; } // no header: first column is the name
  rows = rows.slice(0, MAX_ROWS);
  const get = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  const stmts = rows.map((r, i) => {
    const input = [get(r, cols.name), get(r, cols.number), get(r, cols.postcode)].filter(Boolean).join(", ");
    const extra = { name: get(r, cols.name), since: get(r, cols.since) || null, users: Number(get(r, cols.users)) || null, fee: Number(get(r, cols.fee).replace(/[£,]/g, "")) || null, next_invoice: get(r, cols.nextInvoice) || null };
    return env.DB.prepare("INSERT OR IGNORE INTO import_row (import_id, org_id, row, input, extra) VALUES (?,?,?,?,?)").bind(importId, orgId, i, input, JSON.stringify(extra));
  }).filter((_, i) => true);
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await run(env, "UPDATE import SET rows_total = ?, status = 'matching' WHERE id = ?", rows.length, importId);
  return rows.length;
}

/** Match a chunk of rows. Throws RateLimited to be retried. Returns the next offset, or null when done. */
export async function matchChunk(env: Env, importId: string, from: number, withChecks: boolean): Promise<number | null> {
  const rows = await all<any>(env, "SELECT * FROM import_row WHERE import_id = ? AND row >= ? AND row < ? ORDER BY row", importId, from, from + CHUNK);
  if (!rows.length) return null;
  for (const r of rows) {
    if (r.confidence) continue; // already done in an earlier attempt
    if (!r.input.trim()) { await run(env, "UPDATE import_row SET confidence='none', candidates='[]' WHERE import_id=? AND row=?", importId, r.row); continue; }
    const m = await resolveInput(env, r.input, { postcode: findPostcode(r.input) });
    const extra = JSON.parse(r.extra || "{}");
    if (withChecks && m.confidence === "high" && m.chosen) {
      const rec = await companyCached(env, m.chosen);
      if (rec) {
        extra.findings = runChecks(undefined, rec).map((f) => ({ check: f.check, severity: f.severity, title: f.title, summary: f.summary, source: f.facts[0]?.[2] }));
        extra.registered_name = rec.name;
        extra.status = rec.status;
      }
    }
    await run(env, "UPDATE import_row SET confidence = ?, candidates = ?, chosen_number = ?, extra = ? WHERE import_id = ? AND row = ?",
      m.confidence, JSON.stringify(m.candidates.slice(0, 5).map(({ number, name, status, postcode, locality, score, reasons }) => ({ number, name, status, postcode, locality, score, reasons }))),
      m.chosen ?? null, JSON.stringify(extra), importId, r.row);
  }
  return rows.length < CHUNK ? null : from + CHUNK; // a short chunk is the last one
}

export async function summarise(env: Env, importId: string) {
  const s = await one<any>(env, `SELECT COUNT(*) AS total, SUM(confidence='high') AS high, SUM(confidence='confirm') AS confirm, SUM(confidence='none') AS none FROM import_row WHERE import_id = ?`, importId);
  await run(env, "UPDATE import SET rows_matched = ?, rows_confirm = ?, rows_unmatched = ? WHERE id = ?", s.high || 0, s.confirm || 0, s.none || 0, importId);
  return { total: s.total || 0, matched: s.high || 0, confirm: s.confirm || 0, unmatched: s.none || 0 };
}

/** Add a confirmed company to the org's book and queue its baseline read. */
export async function addClient(env: Env, orgId: string, number: string, extra: any, actor?: string) {
  const name = extra?.registered_name || extra?.name || number;
  const ins = await run(env, `INSERT INTO client (org_id, number, display_name, since, users, monthly_fee, next_invoice, watch_on, added_at)
    VALUES (?,?,?,?,?,?,?,1,?) ON CONFLICT(org_id, number) DO NOTHING`,
    orgId, number, name, extra?.since ?? null, extra?.users ?? null, extra?.fee ?? null, extra?.next_invoice ?? null, nowIso());
  if (ins.meta.changes) {
    const known = await one(env, "SELECT 1 AS x FROM company WHERE number = ?", number);
    if (!known) {
      const id = newId("evt");
      await run(env, "INSERT INTO register_event (id, number, kind, occurred_at, source, source_id) VALUES (?,?,?,?,?,?)", id, number, "baseline", nowIso(), "agent-house", "baseline:" + number);
      await env.JOBS.send({ type: "company", number, event_id: id, baseline: true });
    }
  }
  return !!ins.meta.changes;
}

export async function finishImport(env: Env, importId: string, orgId: string) {
  const rows = await all<any>(env, "SELECT * FROM import_row WHERE import_id = ? AND confidence = 'high'", importId);
  for (const r of rows) await addClient(env, orgId, r.chosen_number, JSON.parse(r.extra || "{}"));
  const s = await summarise(env, importId);
  await run(env, "UPDATE import SET status = ? WHERE id = ?", s.confirm ? "needs_confirmation" : "done", importId);
  return s;
}
