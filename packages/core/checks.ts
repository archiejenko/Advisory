// The ten checks. A check compares the last stored record with the new one and returns findings.
// All alert wording lives here, so the banned-words test covers every word a customer can see.
import { longDate } from "./util";

export type Source = "Companies House" | "The Gazette" | "FCA register" | "Your client list" | "Agent House";

export type CompanyRecord = {
  number: string;
  name: string;
  status: string; // active | administration | liquidation | dissolved | receivership | voluntary-arrangement | insolvency-proceedings | ...
  incorporated?: string;
  sic?: string[];
  office?: { line?: string; locality?: string; postcode?: string };
  accounts?: { next_due?: string; last_made_up?: string; overdue?: boolean };
  cs?: { next_due?: string; overdue?: boolean };
  officers?: { id: string; name: string; role: string; appointed?: string; resigned?: string }[];
  psc?: { id: string; name: string; kind?: string; notified?: string; ceased?: string }[];
  charges?: { id: string; created?: string; status?: string; lender?: string }[];
  gazette?: { id: string; type: "insolvency" | "strike-off" | "other"; title: string; published: string }[];
  fca?: { status?: string | null; frn?: string | null; unavailable?: boolean };
  retrieved_at?: string;
};

export type Finding = {
  check: CheckKey;
  severity: "Critical" | "Review";
  title: string;
  summary: string;
  facts: [string, string, Source][];
  next: string;
};

export type CheckKey = "status" | "insolvency" | "strike_off" | "accounts" | "confirmation" | "officers" | "psc" | "office" | "charges" | "fca";

export const CHECKS: { key: CheckKey; name: string; source: Source; when: string; severity: "Critical" | "Review" }[] = [
  { key: "status", name: "Company status", source: "Companies House", when: "Status changes from active, for example to administration, liquidation or dissolved", severity: "Critical" },
  { key: "insolvency", name: "Insolvency notices", source: "The Gazette", when: "Any new corporate insolvency notice naming the company", severity: "Critical" },
  { key: "strike_off", name: "Strike-off notice", source: "The Gazette", when: "A first notice of compulsory or voluntary strike-off is published", severity: "Critical" },
  { key: "accounts", name: "Annual accounts", source: "Companies House", when: "The filing deadline passes without accounts being filed", severity: "Review" },
  { key: "confirmation", name: "Confirmation statement", source: "Companies House", when: "The filing deadline passes without a statement being filed", severity: "Review" },
  { key: "officers", name: "Officers", source: "Companies House", when: "A director is appointed or resigns", severity: "Review" },
  { key: "psc", name: "People with significant control", source: "Companies House", when: "A person with significant control is added or ceases", severity: "Review" },
  { key: "office", name: "Registered office", source: "Companies House", when: "The registered office address changes", severity: "Review" },
  { key: "charges", name: "Charges", source: "Companies House", when: "A new charge is registered against the company", severity: "Review" },
  { key: "fca", name: "FCA status", source: "FCA register", when: "Authorisation status changes, where the company is listed", severity: "Review" },
];

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  administration: "In administration",
  liquidation: "In liquidation",
  dissolved: "Dissolved",
  receivership: "In receivership",
  "voluntary-arrangement": "In a voluntary arrangement",
  "insolvency-proceedings": "In insolvency proceedings",
  "converted-closed": "Converted or closed",
  "registered": "Registered",
  "removed": "Removed",
};
export const statusLabel = (s?: string) => (s ? STATUS_LABEL[s] || s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Unknown");

export type ClientContext = { nextInvoice?: string | null; monthlyFee?: number | null; since?: string | null; users?: number | null };

function invoiceFact(ctx: ClientContext): [string, string, Source][] {
  if (!ctx.nextInvoice) return [];
  const amt = ctx.monthlyFee ? `, £${Math.round(ctx.monthlyFee).toLocaleString("en-GB")}` : "";
  return [["Next invoice", longDate(ctx.nextInvoice) + amt, "Your client list"]];
}
const beforeInvoice = (ctx: ClientContext) => (ctx.nextInvoice ? ` before the ${longDate(ctx.nextInvoice)} invoice` : " before the next invoice");

/** Compare two records. `prev` undefined means first sight: only report things that are already overdue or not active. */
export function runChecks(prev: CompanyRecord | undefined, next: CompanyRecord, ctx: ClientContext = {}): Finding[] {
  const out: Finding[] = [];
  const first = !prev;

  // 1. Status
  if (next.status !== "active" && (first || prev!.status !== next.status)) {
    out.push({
      check: "status", severity: "Critical",
      title: next.status === "administration" ? "Administrators appointed" : `Status now ${statusLabel(next.status).toLowerCase()}`,
      summary: `Companies House now records the company as ${statusLabel(next.status).toLowerCase()}.`,
      facts: [["Status", statusLabel(next.status), "Companies House"], ...invoiceFact(ctx)],
      next: `Hold new project work and talk to your finance lead${beforeInvoice(ctx)}.`,
    });
  }

  // 2 and 3. Gazette notices
  const seen = new Set((prev?.gazette || []).map((g) => g.id));
  for (const g of next.gazette || []) {
    if (seen.has(g.id) || g.type === "other") continue;
    if (first && g.published < daysAgo(next.retrieved_at, 365)) continue;
    const ins = g.type === "insolvency";
    out.push({
      check: ins ? "insolvency" : "strike_off", severity: "Critical",
      title: ins ? "Insolvency notice published" : "Strike-off notice published",
      summary: `${g.title} was published in The Gazette on ${longDate(g.published)}.`,
      facts: [["Notice", g.title, "The Gazette"], ["Published", longDate(g.published), "The Gazette"], ...invoiceFact(ctx)],
      next: ins ? `Hold new project work and talk to your finance lead${beforeInvoice(ctx)}.` : "Check the company is still trading and who you should be invoicing.",
    });
  }

  // 4. Accounts
  if (next.accounts?.overdue && (first || !prev!.accounts?.overdue)) {
    out.push({
      check: "accounts", severity: "Review", title: "Accounts overdue",
      summary: `Annual accounts were due at Companies House on ${longDate(next.accounts.next_due!)} and have not been filed.`,
      facts: [["Accounts due", longDate(next.accounts.next_due!) + ", overdue", "Companies House"], ...(next.accounts.last_made_up ? [["Last made up to", longDate(next.accounts.last_made_up), "Companies House"] as [string, string, Source]] : []), ...invoiceFact(ctx)],
      next: `Check payment terms and recent payment history${beforeInvoice(ctx)}.`,
    });
  }

  // 5. Confirmation statement
  if (next.cs?.overdue && (first || !prev!.cs?.overdue)) {
    out.push({
      check: "confirmation", severity: "Review", title: "Confirmation statement overdue",
      summary: `The confirmation statement was due on ${longDate(next.cs.next_due!)} and has not been filed.`,
      facts: [["Statement due", longDate(next.cs.next_due!) + ", overdue", "Companies House"]],
      next: "Often an oversight. Worth mentioning at your next account review.",
    });
  }

  if (!first) {
    // 6. Officers
    const pAct = new Map((prev!.officers || []).filter((o) => !o.resigned).map((o) => [o.id, o]));
    const nAct = new Map((next.officers || []).filter((o) => !o.resigned).map((o) => [o.id, o]));
    const appointed = [...nAct.keys()].filter((k) => !pAct.has(k));
    const resigned = [...pAct.keys()].filter((k) => !nAct.has(k));
    if (appointed.length || resigned.length) {
      const parts = [resigned.length && `${resigned.length} resigned`, appointed.length && `${appointed.length} appointed`].filter(Boolean).join(", ");
      out.push({
        check: "officers", severity: "Review", title: "Director changed",
        summary: `Officer changes at Companies House: ${parts}.`,
        facts: [["Officers", parts, "Companies House"], ...appointed.map((k) => ["Appointed", `${nAct.get(k)!.name}, ${nAct.get(k)!.role}`, "Companies House"] as [string, string, Source]), ...resigned.map((k) => ["Resigned", `${pAct.get(k)!.name}, ${pAct.get(k)!.role}`, "Companies House"] as [string, string, Source])],
        next: "Confirm who now signs off IT spend and update the contract contact.",
      });
    }
    // 7. People with significant control
    const pP = new Set((prev!.psc || []).filter((p) => !p.ceased).map((p) => p.id));
    const nP = new Set((next.psc || []).filter((p) => !p.ceased).map((p) => p.id));
    const added = [...nP].filter((k) => !pP.has(k)).length, ceased = [...pP].filter((k) => !nP.has(k)).length;
    if (added || ceased) {
      const parts = [added && `${added} added`, ceased && `${ceased} ceased`].filter(Boolean).join(", ");
      out.push({ check: "psc", severity: "Review", title: "Ownership changed", summary: `People with significant control: ${parts}.`, facts: [["People with significant control", parts, "Companies House"]], next: "A change of owner can mean a change of supplier. Worth a call." });
    }
    // 8. Registered office
    const po = prev!.office, no = next.office;
    if (po && no && (po.postcode || "") !== (no.postcode || "") || (po && no && (po.line || "") !== (no.line || ""))) {
      out.push({ check: "office", severity: "Review", title: "Registered office moved", summary: `The registered office moved to ${[no!.line, no!.locality, no!.postcode].filter(Boolean).join(", ")}.`, facts: [["Previous office", [po!.locality, po!.postcode].filter(Boolean).join(", "), "Companies House"], ["New office", [no!.locality, no!.postcode].filter(Boolean).join(", "), "Companies House"]], next: "Check invoices go to the right address." });
    }
    // 9. Charges
    const pc = new Set((prev!.charges || []).map((c) => c.id));
    const newCharges = (next.charges || []).filter((c) => !pc.has(c.id));
    if (newCharges.length) {
      const c = newCharges[0];
      out.push({ check: "charges", severity: "Review", title: "Charge registered", summary: `A charge was registered against the company's assets${c.created ? " on " + longDate(c.created) : ""}.`, facts: [["Charge", c.created ? "Registered " + longDate(c.created) : "Registered", "Companies House"], ...(c.lender ? [["Lender", c.lender, "Companies House"] as [string, string, Source]] : [])], next: "Usually routine borrowing. Worth noting alongside any late payments." });
    }
    // 10. FCA
    if (!prev!.fca?.unavailable && !next.fca?.unavailable && (prev!.fca?.status || null) !== (next.fca?.status || null) && (prev!.fca?.status || next.fca?.status)) {
      out.push({ check: "fca", severity: "Review", title: "FCA status changed", summary: `FCA register status changed from ${prev!.fca?.status || "not listed"} to ${next.fca?.status || "not listed"}.`, facts: [["FCA status", next.fca?.status || "Not listed", "FCA register"]], next: "If the client is regulated, check whether this affects the services you provide." });
    }
  }
  return out;
}

function daysAgo(iso: string | undefined, n: number) {
  const d = new Date(iso ? Date.parse(iso) : Date.now());
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Words that must never appear in anything we say about a company. */
export const BANNED = [/\bverified\b/i, /\bsafe to\b/i, /\btrusted\b/i, /\bapproved\b/i, /\bpass(?:ed)?\b/i, /\bfail(?:ed)?\b(?! to)/i, /\bcreditworthy\b/i, /\brisk score\b/i];
export function bannedWords(text: string): string[] {
  return BANNED.filter((r) => r.test(text)).map((r) => r.source);
}
