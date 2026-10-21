// Creating a business workspace: by the operator (pilots) or by the owner (self-serve sign-up).
import { newId, nowIso, randomToken, sha256Hex } from "../../../../packages/core/util";
import { type Env, one, run, audit } from "./db";
import { sendMail } from "./mail";
import { hireAgent } from "./agents";

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "team";

/**
 * Everything a workspace needs is written in one D1 batch (a single transaction), so a failure partway
 * leaves nothing behind instead of a half-built workspace. Agents are hired and the email sent afterwards;
 * a failure there is logged, and the owner can hire from the catalogue.
 */
export async function createOrg(env: Env, o: { name: string; owner_email: string; owner_name?: string; profile?: Record<string, string>; plan?: string; agents?: string[]; by: string }) {
  const orgId = newId("org"), email = o.owner_email.toLowerCase(), now = nowIso();
  const alias = `${slug(o.name)}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "x1"}`;
  const token = randomToken();
  const userId = "(SELECT id FROM user WHERE email = ?)";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO org (id, name, profile, plan, inbox_alias, created_at) VALUES (?,?,?,?,?,?)").bind(orgId, o.name, JSON.stringify(o.profile || {}), o.plan || "pilot", alias, now),
    env.DB.prepare("INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING").bind(newId("usr"), email, o.owner_name ?? null, now),
    env.DB.prepare(`INSERT INTO membership (org_id, user_id, role) VALUES (?, ${userId}, 'owner')`).bind(orgId, email),
    env.DB.prepare("INSERT INTO agent_config (org_id, agent, on_, digest) VALUES (?, 'watch', 0, 'weekly')").bind(orgId),
    env.DB.prepare("INSERT INTO agent_config (org_id, agent, on_, digest) VALUES (?, 'check', 0, 'weekly')").bind(orgId),
    env.DB.prepare("INSERT INTO agent_config (org_id, agent, on_, digest) VALUES (?, 'prospect', 0, 'weekly')").bind(orgId),
    env.DB.prepare("INSERT INTO subscription (org_id, status, founding, status_since, updated_at) VALUES (?, ?, 1, ?, ?)").bind(orgId, o.plan === "trial" ? "trialing" : "pilot", now, now),
    env.DB.prepare("INSERT INTO api_key (id, key_hash, org_id, kind, created_at) VALUES (?,?,?,'internal',?)").bind(newId("key"), await sha256Hex(randomToken(32)), orgId, now),
    env.DB.prepare("INSERT INTO magic_link (token_hash, email, expires_at) VALUES (?,?,?)").bind(await sha256Hex(token), email, new Date(Date.now() + 7 * 864e5).toISOString()),
  ]);
  const u = await one<any>(env, "SELECT id FROM user WHERE email = ?", email);
  for (const t of o.agents || []) {
    try { await hireAgent(env, orgId, u.id, { template: t }); } catch (e: any) { console.error("could not hire", t, "for", orgId, e?.message || e); }
  }
  await sendMail(env, { to: email, subject: "Your Agent House workspace is ready", text: `Your workspace for ${o.name} is ready.\nSign in: ${env.APP_URL}#/sign-in?token=${token}\nThis link works once and expires in 7 days.` });
  await audit(env, orgId, o.by, "org_created", orgId, { name: o.name });
  return { org_id: orgId, owner_id: u.id, inbox_address: `${alias}@${env.INBOUND_DOMAIN || "in.agenthouse.example"}` };
}
