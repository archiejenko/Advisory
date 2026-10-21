// Matching a messy client name to a registered company.

export type Candidate = { number: string; name: string; status?: string; postcode?: string; locality?: string };
export type Scored = Candidate & { score: number; reasons: string[] };
export type MatchResult = { confidence: "high" | "confirm" | "none"; candidates: Scored[]; chosen?: string };

const SUFFIX = /\b(limited|ltd|plc|llp|lp|cic|company|co|the|uk|group|holdings)\b/g;

export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}

/** Company numbers: 8 characters, digits or a two-letter prefix (SC, NI, OC...) then 6 digits. */
export function findCompanyNumber(s: string): string | null {
  const m = s.toUpperCase().match(/\b((?:SC|NI|OC|SO|NC|R0|IP|SP|RS|LP|SL|SA|NA|NL|NP|NO|NR|NZ|GE|FC|GS|IC|CE|CS|PC|NF)\d{6}|\d{8})\b/);
  return m ? m[1] : null;
}

export function findPostcode(s: string): string | null {
  const m = s.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Strip invoice and reference noise so "Tarnbrook Logistics, invoice INV-2207" searches as a name. */
export function nameFromInput(s: string): string {
  const pc = findPostcode(s);
  let out = s.replace(/\b(invoice|inv|ref|po)\b[\s#:-]*[A-Z0-9-]+/gi, " ").replace(findCompanyNumber(s) || "@@", " ");
  if (pc) out = out.replace(new RegExp(pc.replace(" ", "\\s*"), "i"), " ");
  return out.replace(/[,;|]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string) { return new Set(normaliseName(s).split(" ").filter(Boolean)); }

export function scoreCandidates(input: string, cands: Candidate[], hint: { postcode?: string | null; locality?: string | null } = {}): Scored[] {
  const want = normaliseName(nameFromInput(input));
  const wt = tokens(want);
  const pc = hint.postcode || findPostcode(input);
  const words = input.toLowerCase();
  return cands.map((c) => {
    const reasons: string[] = [];
    const n = normaliseName(c.name);
    let score: number;
    if (n === want) { score = 0.9; reasons.push("name"); }
    else {
      const ct = tokens(c.name);
      const inter = [...wt].filter((t) => ct.has(t)).length;
      const union = new Set([...wt, ...ct]).size || 1;
      score = 0.85 * (inter / union);
      if (inter) reasons.push("partial name");
    }
    if (pc && c.postcode && c.postcode.replace(/\s/g, "") === pc.replace(/\s/g, "")) { score += 0.1; reasons.push("registered postcode"); }
    else if (c.locality && words.includes(c.locality.toLowerCase())) { score += 0.08; reasons.push("registered town"); }
    if (c.status && c.status !== "active") score -= 0.05;
    return { ...c, score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), reasons };
  }).sort((a, b) => b.score - a.score);
}

export function decide(input: string, scored: Scored[]): MatchResult {
  const num = findCompanyNumber(input);
  if (num) {
    const hit = scored.find((c) => c.number === num);
    if (hit) return { confidence: "high", candidates: [{ ...hit, score: 1, reasons: ["company number", ...hit.reasons] }], chosen: num };
  }
  const [a, b] = scored;
  if (!a || a.score < 0.5) return { confidence: "none", candidates: scored.slice(0, 3) };
  // If several registered names contain every word the client gave us, a name alone can't tell them apart.
  const want = tokens(nameFromInput(input));
  const containing = scored.filter((c) => { const ct = tokens(c.name); return want.size > 0 && [...want].every((t) => ct.has(t)); });
  const located = a.reasons.includes("registered postcode") || a.reasons.includes("registered town");
  if (containing.length > 1 && !located) return { confidence: "confirm", candidates: containing.slice(0, 5) };
  const clear = !b || a.score - b.score >= 0.15;
  if (a.score >= 0.9 && clear) return { confidence: "high", candidates: scored.slice(0, 3), chosen: a.number };
  return { confidence: "confirm", candidates: scored.filter((c) => c.score >= 0.4).slice(0, 5) };
}
