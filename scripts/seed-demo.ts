// A demo business in the LOCAL database, with three months of credit use, so the Usage page has something to show:
// Corriemoor Interiors on Growth, six agents across all four modes (Inbox on Deep, so there's a cheaper-mode tip;
// Research has reached its monthly budget), a top-up, monthly resets and AI Team (system) use.
//   npm run seed:demo            (after `npm run setup`; then `npm run dev` and open the sign-in link it prints)
// Only ever writes to the local D1 (`wrangler d1 execute --local`). Re-running replaces the demo business.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { demoLedger, DEMO_AGENTS } from "../packages/core/demoUsage";

if (process.argv.includes("--remote")) { console.error("seed:demo only writes to the local database."); process.exit(1); }

const ORG = "org_demo_corriemoor", EMAIL = "owner@corriemoor.example", USER = "usr_demo_corriemoor";
const now = new Date(), iso = now.toISOString();
const q = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const row = (table: string, o: Record<string, unknown>) => `INSERT INTO ${table} (${Object.keys(o).join(", ")}) VALUES (${Object.values(o).map(q).join(", ")});`;

const { entries, agents } = demoLedger({ plan: "growth", now, months: 3, seed: 7 });
const sql: string[] = [];
// Replace any earlier copy of the demo business.
for (const t of ["credit_entry", "agent_run", "agent", "agent_config", "membership", "subscription", "audit_log"]) sql.push(`DELETE FROM ${t} WHERE org_id = '${ORG}';`);
sql.push(`DELETE FROM org WHERE id = '${ORG}';`);

const created = new Date(now.getTime() - 120 * 864e5).toISOString();
sql.push(row("org", { id: ORG, name: "Corriemoor Interiors Ltd", plan: "growth", inbox_alias: "corriemoor-demo", created_at: created, confirm_over: 100,
  profile: JSON.stringify({ what: "Interior design and fit-out for offices, clinics and restaurants", customers: "Owners and facilities managers of 10–80 person workplaces", area: "Stockport and south Manchester", tone: "warm, clear and practical", sign_off: "Morgan Hale, Corriemoor Interiors", website: "corriemoor.example" }) }));
sql.push(`INSERT INTO user (id, email, name, created_at) VALUES (${q(USER)}, ${q(EMAIL)}, 'Morgan Hale', ${q(created)}) ON CONFLICT(email) DO NOTHING;`);
sql.push(`INSERT INTO membership (org_id, user_id, role) VALUES (${q(ORG)}, (SELECT id FROM user WHERE email = ${q(EMAIL)}), 'owner');`);
sql.push(row("subscription", { org_id: ORG, stripe_customer: "cus_demo", stripe_subscription: "sub_demo", status: "active", founding: 0, status_since: created, updated_at: iso }));
for (const k of ["watch", "check", "prospect"]) sql.push(row("agent_config", { org_id: ORG, agent: k, on_: 0, digest: "weekly" }));

for (const a of agents) {
  sql.push(row("agent", {
    id: a.id + "_cm", org_id: ORG, template: a.template, name: a.name, rhythm: a.rhythm === "monthly" ? "monthly" : a.rhythm, run_hour: 8, autonomy: "approve_all", status: "running",
    brief: a.template === "custom" ? a.instructions : `${a.name} for Corriemoor Interiors.`, settings: "{}", mode: a.mode, monthly_budget: a.monthly_budget ?? null,
    budget_paused_period: a.budget_paused_period ?? null, role: a.role ?? null, instructions: a.template === "custom" ? a.instructions : null, tools: a.template === "custom" ? JSON.stringify(["business-profile", "web-research", "read-page", "create-task"]) : null,
    created_by: USER, created_at: created,
  }));
}
/** The same refs the ledger itself uses, so the app's own monthly reset recognises these entries and adds nothing. */
const refFor = (e: (typeof entries)[number], runId: string | null) =>
  e.kind === "plan_grant" || e.kind === "plan_expiry" ? e.period : e.kind === "topup" ? `cs_demo_${e.period}` : runId || "sys_demo_" + randomBytes(6).toString("hex");
for (const e of entries) {
  const agent = e.agent_id ? e.agent_id + "_cm" : null, runId = e.run_id ? e.run_id + "_cm" : null;
  if (e.kind === "run") {
    const failed = e.ok === false;
    sql.push(row("agent_run", { id: runId, org_id: ORG, agent_id: agent, trigger: "schedule", status: failed ? "failed" : "done", steps: e.requests, tool_calls: Math.max(1, e.requests - 1),
      summary: failed ? null : "Done.", error: failed ? "Interrupted: the run stopped partway." : null, tokens_in: e.tokens_in, cache_read: e.cache_read, cache_write: e.cache_write, tokens_out: e.tokens_out,
      credits: -e.credits, cost_pence: Math.ceil(-e.credits), mode: e.mode, model: e.model, created_at: e.at, started_at: e.at, finished_at: e.at }));
  }
  sql.push(row("credit_entry", { id: "cr_demo_" + randomBytes(6).toString("hex"), org_id: ORG, kind: e.kind, credits: e.credits, from_plan: e.from_plan, from_topup: e.from_topup, period: e.period,
    agent_id: agent, run_id: runId, mode: e.mode ?? null, model: e.model ?? null, task_type: null, tokens_in: e.tokens_in, cache_read: e.cache_read, cache_write: e.cache_write, tokens_out: e.tokens_out,
    requests: e.requests, cost: -e.credits, ref: refFor(e, runId), note: e.note ?? null, at: e.at }));
}
// Each agent's last run, as the runtime records it.
for (const a of agents) {
  const last = entries.filter((e) => e.kind === "run" && e.agent_id === a.id).at(-1);
  if (last) sql.push(`UPDATE agent SET last_run_at = ${q(last.at)} WHERE id = ${q(a.id + "_cm")};`);
}
const token = randomBytes(24).toString("base64url");
sql.push(row("magic_link", { token_hash: createHash("sha256").update(token).digest("hex"), email: EMAIL, expires_at: new Date(now.getTime() + 7 * 864e5).toISOString() }));

const dir = mkdtempSync(join(tmpdir(), "ah-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql.join("\n") + "\n");
try {
  execFileSync("npx", ["wrangler", "d1", "execute", "agent-house", "--local", "--file", file], { stdio: ["ignore", "ignore", "inherit"] });
} finally { rmSync(dir, { recursive: true, force: true }); }

const runs = entries.filter((e) => e.kind === "run").length;
console.log(`Seeded Corriemoor Interiors (Growth): ${DEMO_AGENTS.length} agents, ${runs} runs over 3 months, ${entries.length} ledger entries.`);
console.log(`Sign in as ${EMAIL} (link works once, for 7 days):\n  http://127.0.0.1:8787/#/sign-in?token=${token}\nthen open Usage and plan.`);
