// What's live on the site, against main: the deployed SHA (GET /api/version), origin/main's HEAD, and the commits
// between them. LIVE_URL overrides the site (default https://www.ejtech.co.uk).
import { execSync } from "node:child_process";

const site = process.env.LIVE_URL || "https://www.ejtech.co.uk";
const sh = (cmd) => { try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };

sh("git fetch --quiet origin main");
const main = sh("git rev-parse origin/main");
let live = null, builtAt = null;
try {
  const r = await fetch(site + "/api/version", { headers: { "Cache-Control": "no-cache" } });
  if (r.ok) ({ sha: live, builtAt } = await r.json());
  else console.log(`${site}/api/version answered ${r.status}: the live build predates the build stamp.`);
} catch (e) { console.log(`Couldn't reach ${site}: ${e.message}`); }

console.log(`live         ${live || "unknown"}${builtAt ? `  (built ${builtAt})` : ""}`);
console.log(`origin/main  ${main}`);
if (!live || live === "dev") process.exit(0);
const base = live.replace(/-dirty$/, "");
if (live.endsWith("-dirty")) console.log("The live build was deployed from a working tree with uncommitted changes.");
if (base === main) { console.log("Live is origin/main."); process.exit(0); }
if (!sh(`git cat-file -e ${base}^{commit} && echo y`)) { console.log(`Live commit ${base} isn't in this clone (git fetch --all?).`); process.exit(0); }
const ahead = sh(`git log --oneline ${base}..${main}`), behind = sh(`git log --oneline ${main}..${base}`);
console.log(ahead ? `\nOn main, not live (${ahead.split("\n").length}):\n${ahead}` : "\nNothing on main is waiting to go live.");
if (behind) console.log(`\nLive, not on main (${behind.split("\n").length}):\n${behind}`);
