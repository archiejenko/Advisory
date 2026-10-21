// The source of truth: resolve messy input, build sourced profiles, and the one-call check.
import { decide, findCompanyNumber, findPostcode, nameFromInput, scoreCandidates, type MatchResult } from "../../../../packages/core/match";
import { runChecks, statusLabel, type CompanyRecord } from "../../../../packages/core/checks";
import { signBody } from "../../../../packages/core/sign";
import { longDate, newId, nowIso } from "../../../../packages/core/util";
import { companyCached, searchCompanies } from "./registers";
import { signingKey } from "./crypto";
import type { Env } from "./db";

export async function resolveInput(env: Env, input: string, hint: { postcode?: string | null } = {}): Promise<MatchResult> {
  const num = findCompanyNumber(input);
  if (num) {
    const rec = await companyCached(env, num);
    if (rec) {
      return { confidence: "high", chosen: num, candidates: [{ number: num, name: rec.name, status: rec.status, postcode: rec.office?.postcode, locality: rec.office?.locality, score: 1, reasons: ["company number"] }] };
    }
  }
  const q = nameFromInput(input) || input;
  const cands = await searchCompanies(env, q);
  return decide(input, scoreCandidates(input, cands, { postcode: hint.postcode || findPostcode(input) }));
}

type Field = { value: unknown; source: string; retrieved_at: string; licence: string };
const f = (value: unknown, source: string, at: string): Field => ({
  value, source, retrieved_at: at, licence: source === "FCA register" ? "FCA register terms" : "Open Government Licence v3.0",
});

/** Every field carries its source, retrieval time and licence. Names and roles only for people. */
export function profileFields(rec: CompanyRecord) {
  const at = rec.retrieved_at || nowIso();
  const lastNotice = (rec.gazette || []).filter((g) => g.type !== "other").sort((a, b) => (a.published < b.published ? 1 : -1));
  return {
    name: f(rec.name, "Companies House", at),
    number: f(rec.number, "Companies House", at),
    status: f(rec.status, "Companies House", at),
    incorporated: f(rec.incorporated ?? null, "Companies House", at),
    sic_codes: f(rec.sic || [], "Companies House", at),
    registered_office: f({ locality: rec.office?.locality ?? null, postcode: rec.office?.postcode ?? null }, "Companies House", at),
    accounts_next_due: f(rec.accounts?.next_due ?? null, "Companies House", at),
    accounts_overdue: f(!!rec.accounts?.overdue, "Companies House", at),
    confirmation_statement_next_due: f(rec.cs?.next_due ?? null, "Companies House", at),
    confirmation_statement_overdue: f(!!rec.cs?.overdue, "Companies House", at),
    officers: f((rec.officers || []).filter((o) => !o.resigned).map((o) => ({ name: o.name, role: o.role })), "Companies House", at),
    persons_with_significant_control: f((rec.psc || []).filter((p) => !p.ceased).map((p) => ({ name: p.name })), "Companies House", at),
    charges_outstanding: f((rec.charges || []).filter((c) => c.status !== "satisfied").length, "Companies House", at),
    insolvency_notices: f(lastNotice.map((g) => ({ title: g.title, published: g.published, type: g.type })), "The Gazette", at),
    fca_status: f(rec.fca?.status ?? null, "FCA register", at),
  };
}

/** The brief's human rows: label, plain-English value, footnote number (1 CH, 2 Gazette, 3 FCA). */
export function briefRows(rec: CompanyRecord): [string, string, number][] {
  const act = (rec.officers || []).filter((o) => !o.resigned).length;
  const notices = (rec.gazette || []).filter((g) => g.type !== "other");
  return [
    ["Status", statusLabel(rec.status), 1],
    ["Incorporated", rec.incorporated ? longDate(rec.incorporated) : "Not recorded", 1],
    ["Accounts", rec.accounts?.overdue ? `Overdue; were due ${longDate(rec.accounts.next_due!)}` : rec.accounts?.next_due ? `Filed to date; next due ${longDate(rec.accounts.next_due)}` : "Not recorded", 1],
    ["Confirmation statement", rec.cs?.overdue ? `Overdue; was due ${longDate(rec.cs.next_due!)}` : "Filed to date", 1],
    ["Officers", `${act} ${act === 1 ? "director" : "directors"}`, 1],
    ["People with significant control", String((rec.psc || []).filter((p) => !p.ceased).length), 1],
    ["Charges", (rec.charges || []).length ? `${(rec.charges || []).length} registered` : "None registered", 1],
    ["Insolvency notices", notices.length ? notices.map((n) => `${n.title}, ${longDate(n.published)}`).join("; ") : "None in the last 12 months", 2],
    ["FCA register", rec.fca?.unavailable ? "FCA register unavailable at the time of this check" : rec.fca?.status || "Not listed", 3],
  ];
}

/** The must-check call: resolve, profile and flag in one signed response. */
export async function checkInput(env: Env, input: string) {
  const match = await resolveInput(env, input);
  const responseId = newId("chk");
  const key = await signingKey(env);
  if (match.confidence !== "high" || !match.chosen) {
    return signBody({
      response_id: responseId, status: "needs_human_confirmation", input,
      message: match.confidence === "none" ? "No registered company matches this input. It may be a sole trader or partnership." : "More than one company could match. Choose one and check again by company number.",
      candidates: match.candidates.map((c) => ({ name: c.name, number: c.number, status: c.status, postcode: c.postcode, score: c.score, reasons: c.reasons })),
      checked_at: nowIso(),
    }, key, env.SIGNING_KID);
  }
  const rec = await companyCached(env, match.chosen);
  if (!rec) throw new Error("Matched company disappeared from the register");
  const findings = runChecks(undefined, rec);
  return signBody({
    response_id: responseId, status: "matched", input,
    match: { name: rec.name, number: rec.number, confidence: "high", reasons: match.candidates[0]?.reasons || [] },
    flags: findings.map((x) => ({ check: x.check, severity: x.severity, text: x.title, detail: x.summary, source: x.facts[0]?.[2] })),
    rows: briefRows(rec),
    fields: profileFields(rec),
    checked_at: rec.retrieved_at || nowIso(),
  }, key, env.SIGNING_KID);
}
