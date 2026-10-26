// Deploys the Worker and website with a build stamp: the commit (GITHUB_SHA in CI, else git HEAD) and the build time
// go into the HTML (<meta name="build-sha">) and the Worker (BUILD_SHA, BUILD_TIME → GET /api/version), so anyone can
// check exactly what is live. Refuses to deploy uncommitted changes unless ALLOW_DIRTY=1, because the SHA would lie.
import { execSync } from "node:child_process";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const out = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

const sha = process.env.GITHUB_SHA || out("git rev-parse HEAD");
const dirty = !process.env.GITHUB_SHA && out("git status --porcelain --untracked-files=no") !== "";
if (dirty && process.env.ALLOW_DIRTY !== "1") {
  console.error("Uncommitted changes: commit them first, so the deployed SHA is the code that's live (or set ALLOW_DIRTY=1).");
  process.exit(1);
}
const stamp = dirty ? `${sha}-dirty` : sha;
const builtAt = new Date().toISOString();
console.log(`Deploying ${stamp} built ${builtAt}`);
run("npm run web:build", { BUILD_SHA: stamp, BUILD_TIME: builtAt });
run(`npx wrangler deploy --var BUILD_SHA:${stamp} --var BUILD_TIME:${builtAt} --message "${stamp}"`);
