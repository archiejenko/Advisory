// One-off: copy the last 30 days of runs, drafts, decisions, credits, house rules and handoffs into agent_log.
// Safe to re-run (see backfill-agent-log.sql). Usage: node scripts/backfill-agent-log.mjs --local | --remote
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const where = process.argv.includes("--remote") ? "--remote" : process.argv.includes("--local") ? "--local" : null;
if (!where) { console.error("Say where: --local or --remote."); process.exit(2); }
const file = fileURLToPath(new URL("./backfill-agent-log.sql", import.meta.url));
const count = () => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "agent-house", where, "--json", "--command", "SELECT COUNT(*) AS n FROM agent_log"], { encoding: "utf8" }))[0].results[0].n;

const before = count();
execFileSync("npx", ["wrangler", "d1", "execute", "agent-house", where, "--file", file, "--yes"], { stdio: "inherit" });
const after = count();
console.log(`agent_log: ${before} rows before, ${after} after (${after - before} added).`);
