// Stage 1 of the OS check: every row of the business OS matrix (docs/os-matrix.json) is a module in the
// catalogue (packages/core/os.ts) with the same area, name, app, depth and phase, and nothing extra.
// Run: node scripts/os-matrix-check.mjs. Exits non-zero on any mismatch.
import { readFileSync } from "node:fs";
import { AREAS, FACETS, KINDS, ROLES, roleInstructions } from "../packages/core/os.ts";

const m = JSON.parse(readFileSync(new URL("../docs/os-matrix.json", import.meta.url), "utf8"));
const DEPTH = { L: "full", P: "partial", N: "basic" };
const problems = [];
const byName = new Map(FACETS.map((f) => [f.name, f]));
for (const r of m.rows) {
  const f = byName.get(r.facet);
  if (!f) { problems.push(`missing module: ${r.facet}`); continue; }
  for (const [k, want, got] of [["area", r.area, f.area], ["app", r.app, f.app], ["depth", DEPTH[r.status], f.depth], ["phase", Number(r.phase), f.phase], ["optimal", r.optimal, f.optimal]])
    if (want !== got) problems.push(`${r.facet}: ${k} is "${got}", the matrix says "${want}"`);
}
for (const f of FACETS) if (!m.rows.some((r) => r.facet === f.name)) problems.push(`module not in the matrix: ${f.name}`);
const areas = new Set(m.rows.map((r) => r.area));
for (const a of areas) if (!AREAS.some((x) => x.key === a)) problems.push(`area missing: ${a}`);
for (const f of FACETS) {
  if (!KINDS[f.kind]) problems.push(`${f.key}: unknown record kind ${f.kind}`);
  if (f.agent === null && f.key !== "whistleblowing") problems.push(`${f.key}: no agent role`);
  if (f.agent && !roleInstructions(f.agent).includes(`module "${f.key}"`)) problems.push(`${f.key}: its agent's standing orders don't name it`);
}
const count = (s) => m.rows.filter((r) => r.status === s).length;
console.log(`Matrix: ${m.rows.length} rows in ${areas.size} areas (${count("L")} live, ${count("P")} partly built, ${count("N")} not yet)`);
console.log(`Catalogue: ${FACETS.length} modules in ${AREAS.length} areas, ${ROLES.length} agent roles`);
if (problems.length) { console.error(`\n${problems.length} problems:\n- ` + problems.join("\n- ")); process.exit(1); }
console.log("Stage 1 passed: every matrix row is a module, with matching area, app, depth, phase and purpose.");
