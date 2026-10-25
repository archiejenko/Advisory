// Adapters for the three public registers. Each returns facts with their source and retrieval time.
// Companies House calls go through a shared rate limiter (600 requests per 5 minutes by default).
import type { CompanyRecord } from "../../../../packages/core/checks";
import { fetchT } from "./fetch";
import { nowIso } from "../../../../packages/core/util";
import { type Env, one, run } from "./db";

export class RateLimited extends Error {
  constructor(public retryAfterSec: number) { super("Companies House rate limit reached"); }
}
export class UpstreamError extends Error {
  constructor(public source: string, public status: number, message: string) { super(message); }
}

/**
 * The Companies House budget is shared by everything, so it is split into lanes. Bulk work (the weekly re-check,
 * imports, first reads) may use 60% of a five-minute window, alerts from the stream 85%, and live checks (a person
 * or an agent waiting on the answer) the rest. A busy Monday can no longer lock out a live check or a liquidation alert.
 */
export type Lane = "live" | "alert" | "bulk" | "api";
/**
 * Outside callers (the Truth API, MCP, the tool gateway) have the smallest lane: anyone can get a key, so their
 * traffic may never crowd out a customer's alerts or a person waiting on a check.
 */
export const LANE_SHARE: Record<Lane, number> = { api: 0.35, bulk: 0.6, alert: 0.85, live: 0.97 };
/** The same env, with register calls counted against another lane. */
export const withLane = <E extends Env>(env: E, lane: Lane): E => ({ ...env, REG_LANE: lane });

async function takeToken(env: Env, cost = 1) {
  const limit = Number(env.CH_RATE_LIMIT || 600);
  const lane: Lane = (env.REG_LANE as Lane) || "live";
  const now = new Date();
  const slot = Math.floor(now.getTime() / 300000);
  const retryAfter = Math.max(5, Math.ceil(((slot + 1) * 300000 - now.getTime()) / 1000));
  // Take the token only while this lane has room, so a refused call doesn't use up the window for anyone else.
  const row = await one<{ count: number }>(env,
    `INSERT INTO rate_window (bucket, count) VALUES (?, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + excluded.count
     WHERE rate_window.count + excluded.count <= ? RETURNING count`, "ch:" + slot, cost, Math.floor(limit * LANE_SHARE[lane]));
  if (!row) throw new RateLimited(retryAfter);
}

async function ch(env: Env, path: string): Promise<any | null> {
  await takeToken(env);
  const res = await fetchT(env.CH_API_BASE.replace(/\/$/, "") + path, {
    headers: { Authorization: "Basic " + btoa(env.CH_API_KEY + ":"), Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new RateLimited(300);
  if (!res.ok) throw new UpstreamError("Companies House", res.status, `Companies House returned ${res.status} for ${path}`);
  return res.json();
}

export async function searchCompanies(env: Env, q: string) {
  const r = await ch(env, `/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`);
  return (r?.items || []).map((i: any) => ({
    number: i.company_number, name: i.title, status: i.company_status,
    postcode: i.address?.postal_code, locality: i.address?.locality,
  }));
}

// Stable ids: the appointment's own link where given, else the officer id inside the appointments link.
const idFrom = (links: any, fallback: string) => {
  if (links?.self) return String(links.self).split("/").filter(Boolean).pop() || fallback;
  const m = String(links?.officer?.appointments || "").match(/\/officers\/([^/]+)/);
  return m ? m[1] : fallback;
};

/** Full company record: profile, officers, people with significant control, charges, Gazette, FCA. */
export async function fetchCompany(env: Env, number: string): Promise<CompanyRecord | null> {
  const p = await ch(env, `/company/${number}`);
  if (!p) return null;
  const [off, psc, chg] = await Promise.all([
    ch(env, `/company/${number}/officers?items_per_page=100`),
    ch(env, `/company/${number}/persons-with-significant-control?items_per_page=100`),
    ch(env, `/company/${number}/charges?items_per_page=100`),
  ]);
  const [gazette, fca] = await Promise.all([gazetteNotices(env, number), fcaStatus(env, number)]);
  const ro = p.registered_office_address || {};
  return {
    number: p.company_number,
    name: p.company_name,
    status: p.company_status,
    incorporated: p.date_of_creation,
    sic: p.sic_codes || [],
    office: { line: ro.address_line_1, locality: ro.locality, postcode: ro.postal_code },
    accounts: { next_due: p.accounts?.next_due, last_made_up: p.accounts?.last_accounts?.made_up_to, overdue: !!p.accounts?.overdue },
    cs: { next_due: p.confirmation_statement?.next_due, overdue: !!p.confirmation_statement?.overdue },
    officers: (off?.items || []).map((o: any, i: number) => ({ id: idFrom(o.links, "o" + i + o.name), name: o.name, role: o.officer_role, appointed: o.appointed_on, resigned: o.resigned_on })),
    psc: (psc?.items || []).map((x: any, i: number) => ({ id: idFrom(x.links, "p" + i + x.name), name: x.name, kind: x.kind, notified: x.notified_on, ceased: x.ceased_on })),
    charges: (chg?.items || []).map((x: any) => ({ id: x.id || x.charge_code, created: x.created_on, status: x.status, lender: x.persons_entitled?.[0]?.name })),
    gazette,
    fca,
    retrieved_at: nowIso(),
  };
}

/**
 * The Gazette. ADAPTER TO CONFIRM: the live service is a linked-data API (JSON-LD, XML) and SPARQL.
 * This expects a JSON list of notices for a company number and maps notice categories to our two types.
 */
export async function gazetteNotices(env: Env, number: string): Promise<NonNullable<CompanyRecord["gazette"]>> {
  if (!env.GAZETTE_BASE) return [];
  try {
    const res = await fetchT(`${env.GAZETTE_BASE.replace(/\/$/, "")}/notice/data.json?company-number=${number}`);
    if (!res.ok) return [];
    const j: any = await res.json();
    return (j.notices || []).map((n: any) => ({
      id: String(n.id), title: n.title, published: n.published,
      type: /insolven|administrat|liquidat|winding/i.test(n.category + " " + n.title) ? "insolvency" : /strike|struck/i.test(n.category + " " + n.title) ? "strike-off" : "other",
    }));
  } catch { return []; }
}

/** FCA register. Free API with no uptime guarantee: failures return null and the brief says "unavailable". */
export async function fcaStatus(env: Env, number: string): Promise<{ status: string | null; frn: string | null; unavailable?: boolean }> {
  if (!env.FCA_BASE) return { status: null, frn: null, unavailable: true };
  try {
    const res = await fetchT(`${env.FCA_BASE.replace(/\/$/, "")}/Firm/search?companyNumber=${number}`, {
      headers: { "X-Auth-Email": env.FCA_EMAIL || "", "X-Auth-Key": env.FCA_KEY || "" },
    });
    if (!res.ok) return { status: null, frn: null, unavailable: true };
    const j: any = await res.json();
    const f = j.Data?.[0];
    return { status: f?.Status || null, frn: f?.FRN || null };
  } catch { return { status: null, frn: null, unavailable: true }; }
}

/** Cached read for interactive checks: one hour in KV. Event processing always reads fresh. */
export async function companyCached(env: Env, number: string): Promise<CompanyRecord | null> {
  const k = "co:" + number;
  const hit = await env.CACHE.get(k, "json");
  if (hit) return hit as CompanyRecord;
  const rec = await fetchCompany(env, number);
  if (rec) await env.CACHE.put(k, JSON.stringify(rec), { expirationTtl: 3600 });
  return rec;
}

/** Persist the latest record: the comparison snapshot plus one provenance row per field. */
export async function storeCompany(env: Env, rec: CompanyRecord) {
  await run(env, `INSERT INTO company (number, name, status, incorporated, sic, office_locality, office_postcode, accounts_next_due, accounts_last_made_up, cs_next_due, fca_status, snapshot, refreshed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(number) DO UPDATE SET name=excluded.name, status=excluded.status, incorporated=excluded.incorporated, sic=excluded.sic,
      office_locality=excluded.office_locality, office_postcode=excluded.office_postcode, accounts_next_due=excluded.accounts_next_due,
      accounts_last_made_up=excluded.accounts_last_made_up, cs_next_due=excluded.cs_next_due, fca_status=excluded.fca_status,
      snapshot=excluded.snapshot, refreshed_at=excluded.refreshed_at`,
    rec.number, rec.name, rec.status, rec.incorporated ?? null, (rec.sic || []).join(","), rec.office?.locality ?? null, rec.office?.postcode ?? null,
    rec.accounts?.next_due ?? null, rec.accounts?.last_made_up ?? null, rec.cs?.next_due ?? null, rec.fca?.status ?? null, JSON.stringify(rec), rec.retrieved_at);
  const at = rec.retrieved_at || nowIso();
  const fields: [string, unknown, string, string][] = [
    ["name", rec.name, "Companies House", "OGL v3"], ["status", rec.status, "Companies House", "OGL v3"],
    ["incorporated", rec.incorporated, "Companies House", "OGL v3"], ["accounts_next_due", rec.accounts?.next_due, "Companies House", "OGL v3"],
    ["accounts_overdue", rec.accounts?.overdue, "Companies House", "OGL v3"], ["cs_next_due", rec.cs?.next_due, "Companies House", "OGL v3"],
    ["officers_active", (rec.officers || []).filter((o) => !o.resigned).length, "Companies House", "OGL v3"],
    ["psc_active", (rec.psc || []).filter((o) => !o.ceased).length, "Companies House", "OGL v3"],
    ["charges", (rec.charges || []).length, "Companies House", "OGL v3"],
    ["gazette_notices", (rec.gazette || []).filter((g) => g.type !== "other").length, "The Gazette", "OGL v3"],
    ["fca_status", rec.fca?.status ?? "not listed", "FCA register", "FCA register terms"],
  ];
  await env.DB.batch(fields.map(([f, v, s, l]) => env.DB.prepare(
    "INSERT INTO register_field (number, field, value, source, retrieved_at, licence) VALUES (?,?,?,?,?,?) ON CONFLICT(number, field) DO UPDATE SET value=excluded.value, retrieved_at=excluded.retrieved_at")
    .bind(rec.number, f, v == null ? null : String(v), s, at, l)));
  // Officers and controllers: names and roles only.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM officer WHERE number = ?").bind(rec.number),
    env.DB.prepare("DELETE FROM psc WHERE number = ?").bind(rec.number),
    ...(rec.officers || []).map((o) => env.DB.prepare("INSERT OR REPLACE INTO officer (number, officer_id, name, role, appointed, ceased) VALUES (?,?,?,?,?,?)").bind(rec.number, o.id, o.name, o.role, o.appointed ?? null, o.resigned ?? null)),
    ...(rec.psc || []).map((o) => env.DB.prepare("INSERT OR REPLACE INTO psc (number, psc_id, name, kind, notified, ceased) VALUES (?,?,?,?,?,?)").bind(rec.number, o.id, o.name, o.kind ?? null, o.notified ?? null, o.ceased ?? null)),
  ]);
  await env.CACHE.put("co:" + rec.number, JSON.stringify(rec), { expirationTtl: 3600 });
}

export async function storedCompany(env: Env, number: string): Promise<CompanyRecord | undefined> {
  const r = await one<{ snapshot: string }>(env, "SELECT snapshot FROM company WHERE number = ?", number);
  return r?.snapshot ? JSON.parse(r.snapshot) : undefined;
}
