import { describe, it, expect } from "vitest";
import { normaliseName, findCompanyNumber, nameFromInput, scoreCandidates, decide } from "../../packages/core/match";
import { runChecks, CHECKS, bannedWords, type CompanyRecord } from "../../packages/core/checks";
import { parseCsv, toCsv, mapClientColumns } from "../../packages/core/csv";
import { generateSigningJwk, importSigningKey, importVerifyKey, signBody, verifyBody } from "../../packages/core/sign";
import { canonical } from "../../packages/core/util";

const base: CompanyRecord = {
  number: "11420987", name: "TARNBROOK LOGISTICS LTD", status: "active", incorporated: "2018-06-18",
  office: { line: "Unit 7", locality: "Manchester", postcode: "M17 1AA" },
  accounts: { next_due: "2026-09-30", overdue: false }, cs: { next_due: "2027-01-01", overdue: false },
  officers: [{ id: "o1", name: "SMITH, Alex", role: "director" }], psc: [{ id: "p1", name: "Alex Smith" }], charges: [], gazette: [], fca: { status: null },
  retrieved_at: "2026-10-20T07:00:00Z",
};

describe("matching", () => {
  it("normalises names and strips suffixes", () => {
    expect(normaliseName("Tarnbrook Logistics Limited")).toBe("tarnbrook logistics");
    expect(normaliseName("The Brindle & Co. Dental Ltd")).toBe("brindle and dental");
  });
  it("finds company numbers, including prefixed ones", () => {
    expect(findCompanyNumber("Invoice for 11420987")).toBe("11420987");
    expect(findCompanyNumber("sc123456 ltd")).toBe("SC123456");
    expect(findCompanyNumber("no number here 1234")).toBeNull();
  });
  it("strips invoice noise from input", () => {
    expect(nameFromInput("Tarnbrook Logistics, invoice INV-2207")).toBe("Tarnbrook Logistics");
  });
  it("matches an exact name with high confidence", () => {
    const s = scoreCandidates("Harlow Vale Studios", [{ number: "13985402", name: "HARLOW VALE STUDIOS LTD", status: "active" }, { number: "1", name: "VALE STUDIO SUPPLIES LTD", status: "active" }]);
    expect(decide("Harlow Vale Studios", s)).toMatchObject({ confidence: "high", chosen: "13985402" });
  });
  it("never guesses between two close matches", () => {
    const s = scoreCandidates("Corriemoor Interiors", [{ number: "10833126", name: "CORRIEMOOR INTERIORS LTD" }, { number: "12940577", name: "CORRIEMOOR INTERIORS (NORTH) LTD" }]);
    const d = decide("Corriemoor Interiors", s);
    expect(d.confidence).toBe("confirm");
    expect(d.chosen).toBeUndefined();
    expect(d.candidates.map((c) => c.number).sort()).toEqual(["10833126", "12940577"]);
  });
  it("uses the registered postcode to break a tie", () => {
    const s = scoreCandidates("Corriemoor Interiors, SK4 1AA", [{ number: "10833126", name: "CORRIEMOOR INTERIORS LTD", postcode: "SK4 1AA" }, { number: "12940577", name: "CORRIEMOOR INTERIORS (NORTH) LTD", postcode: "BL1 1RU" }]);
    expect(decide("Corriemoor Interiors, SK4 1AA", s)).toMatchObject({ confidence: "high", chosen: "10833126" });
  });
  it("reports no match rather than a weak guess", () => {
    const s = scoreCandidates("Joe Bloggs Plumbing", [{ number: "1", name: "ASHDOWN JOINERY LTD" }]);
    expect(decide("Joe Bloggs Plumbing", s).confidence).toBe("none");
  });
});

describe("the ten checks", () => {
  it("covers ten checks across three registers", () => {
    expect(CHECKS).toHaveLength(10);
    expect(new Set(CHECKS.map((c) => c.source))).toEqual(new Set(["Companies House", "The Gazette", "FCA register"]));
  });
  it("raises nothing when nothing changed", () => {
    expect(runChecks(base, { ...base })).toEqual([]);
  });
  it("raises a critical alert on administration, with the invoice in the facts", () => {
    const f = runChecks(base, { ...base, status: "administration" }, { nextInvoice: "2026-11-01", monthlyFee: 1450 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ check: "status", severity: "Critical", title: "Administrators appointed" });
    expect(f[0].facts.some(([k, v]) => k === "Next invoice" && v.includes("£1,450"))).toBe(true);
  });
  it("raises insolvency and strike-off notices from The Gazette", () => {
    const f = runChecks(base, { ...base, gazette: [{ id: "g1", type: "insolvency", title: "Appointment of administrators", published: "2026-10-17" }, { id: "g2", type: "strike-off", title: "First Gazette notice for compulsory strike-off", published: "2026-10-18" }] });
    expect(f.map((x) => x.check).sort()).toEqual(["insolvency", "strike_off"]);
    expect(f.every((x) => x.severity === "Critical")).toBe(true);
  });
  it("raises overdue accounts once, not every week", () => {
    const overdue = { ...base, accounts: { next_due: "2026-09-30", overdue: true } };
    expect(runChecks(base, overdue).map((x) => x.check)).toEqual(["accounts"]);
    expect(runChecks(overdue, overdue)).toEqual([]);
  });
  it("raises officer, controller, office and charge changes", () => {
    const next = { ...base, officers: [{ id: "o1", name: "SMITH, Alex", role: "director", resigned: "2026-10-14" }, { id: "o2", name: "JONES, Pat", role: "director" }], psc: [], office: { ...base.office, postcode: "M1 1AA" }, charges: [{ id: "c1", created: "2026-10-16" }] };
    expect(runChecks(base, next).map((x) => x.check).sort()).toEqual(["charges", "office", "officers", "psc"]);
  });
  it("doesn't treat an unavailable FCA register as a change", () => {
    expect(runChecks({ ...base, fca: { status: "Authorised" } }, { ...base, fca: { status: null, unavailable: true } })).toEqual([]);
  });
  it("never uses verdict words in anything a customer reads", () => {
    const all = [base, { ...base, status: "liquidation" }, { ...base, accounts: { next_due: "2026-09-30", overdue: true }, cs: { next_due: "2026-09-01", overdue: true } }];
    const findings = runChecks(base, { ...base, status: "administration", gazette: [{ id: "g", type: "insolvency" as const, title: "Notice", published: "2026-10-17" }], charges: [{ id: "c" }], psc: [], officers: [] })
      .concat(...all.map((r) => runChecks(undefined, r)));
    const text = findings.map((f) => [f.title, f.summary, f.next, ...f.facts.flat()].join(" ")).join(" ") + CHECKS.map((c) => c.name + c.when).join(" ");
    expect(bannedWords(text)).toEqual([]);
  });
});

describe("CSV", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [["Client", "Note"], ['Brindle "Dental"', "a,b\nc"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it("maps common client-list headers", () => {
    expect(mapClientColumns(["Client name", "Company number", "Monthly fee", "Next invoice date"])).toMatchObject({ name: 0, number: 1, fee: 2, nextInvoice: 3 });
    expect(mapClientColumns(["Customer", "Company number", "Postcode"])).toMatchObject({ name: 0, number: 1, postcode: 2 });
    expect(mapClientColumns(["Company number", "Supplier"])).toMatchObject({ name: 1, number: 0 });
    expect(mapClientColumns(["Company No.", "Company"])).toMatchObject({ name: 1, number: 0 });
  });
});

describe("signing", () => {
  it("signs canonical JSON and detects tampering", async () => {
    const jwk = await generateSigningJwk();
    const signed = await signBody({ response_id: "chk_1", match: { name: "A", number: "1" } }, await importSigningKey(jwk), "k1");
    const vk = await importVerifyKey(jwk);
    expect(await verifyBody(signed, vk)).toBe(true);
    expect(await verifyBody({ ...signed, match: { name: "B", number: "1" } }, vk)).toBe(false);
  });
  it("is independent of key order", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
