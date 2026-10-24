// The business OS, upper half: the catalogue with this business's numbers, channels where people and agents
// talk, and @mentions that put an agent to work and bring its answer back to the conversation.
import { loadOs } from "./osbuilder";
import { moduleSetting } from "../../../../packages/core/osconfig";
import { newId, nowIso } from "../../../../packages/core/util";
import { FACETS, KINDS, ROLES, modulesFor } from "../../../../packages/core/os";
import { PLANS } from "../../../../packages/core/templates";
import { type Env, one, all, run, audit } from "./db";
import { HttpError } from "./http";
import { startRun } from "./agents";
import { specFor } from "./swarm";
import { postMessage, shapeRecord } from "./ostools";

export const DEFAULT_CHANNELS = ["general", "sales", "finance", "operations", "people"];
export const MAX_MENTIONS = 3;
export const PAGE = 100;

/** Every module, with this business's record counts and who works it. */
export async function catalogue(env: Env, orgId: string) {
  const counts = await all<any>(env, "SELECT module, status, COUNT(*) AS n FROM os_record WHERE org_id = ? GROUP BY module, status", orgId);
  const agents = await all<any>(env, "SELECT id, name, status, template FROM agent WHERE org_id = ? AND template = 'os'", orgId);
  const byName = new Map(agents.map((a) => [a.name, a]));
  const os = await loadOs(env, orgId);
  const total: Record<string, number> = {}, open: Record<string, number> = {};
  for (const c of counts) {
    total[c.module] = (total[c.module] || 0) + c.n;
    const f = FACETS.find((x) => x.key === c.module);
    if (f && !KINDS[f.kind].done.includes(c.status)) open[c.module] = (open[c.module] || 0) + c.n;
  }
  return {
    modules: FACETS.map((f) => ({ key: f.key, area: f.area, name: f.name, app: f.app, kind: f.kind, depth: f.depth, agent: f.agent, link: f.link,
      records: total[f.key] || 0, open: open[f.key] || 0, agent_id: f.agent ? byName.get(f.agent)?.id ?? null : null, ...(os ? { mode: moduleSetting(os, f.key)!.mode, autonomy: moduleSetting(os, f.key)!.autonomy } : {}) })),
    built: !!os,
    totals: { modules: FACETS.length, records: Object.values(total).reduce((a, b) => a + b, 0), agents: agents.length },
  };
}

/** The agent for an OS role, hired the first time someone asks for it. It counts towards the plan's agents. */
export async function ensureRoleAgent(env: Env, orgId: string, role: string, by: string) {
  if (!ROLES.includes(role)) throw new HttpError(404, "not_found", "No agent by that name in the OS.");
  const have = await one<any>(env, "SELECT * FROM agent WHERE org_id = ? AND template = 'os' AND name = ?", orgId, role);
  if (have) return have;
  const org = await one<any>(env, "SELECT plan FROM org WHERE id = ?", orgId);
  const plan = PLANS[org?.plan || "trial"] || PLANS.trial;
  const count = (await one<any>(env, "SELECT COUNT(*) AS n FROM agent WHERE org_id = ? AND template != 'orchestrator'", orgId))?.n || 0;
  if (count >= plan.agents) throw new HttpError(409, "plan_limit", `Your ${plan.name} plan includes ${plan.agents} agents. Pause or remove one, or move to a bigger plan.`);
  const mods = modulesFor(role);
  const id = newId("agt");
  await run(env, `INSERT INTO agent (id, org_id, template, name, brief, settings, rhythm, run_hour, autonomy, next_run_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, orgId, "os", role, `Keep ${mods.map((f) => f.app).join(" and ")} up to date, and answer the people who ask.`, JSON.stringify({ role, modules: mods.map((f) => f.key) }),
    "on_demand", 8, "approve_all", null, by, nowIso());
  await audit(env, orgId, by, "agent_hired", id, { template: "os", role });
  return one<any>(env, "SELECT * FROM agent WHERE id = ?", id);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The agents a message @mentions: the business's own agents first, then any OS role. Longest names win. */
export async function findMentions(env: Env, orgId: string, body: string) {
  if (!body.includes("@")) return [];
  const own = await all<any>(env, "SELECT id, name, template FROM agent WHERE org_id = ? AND template != 'orchestrator'", orgId);
  const names = [...new Set([...own.map((a) => a.name), ...ROLES])].sort((a, b) => b.length - a.length);
  const found: { name: string; agent_id: string | null }[] = [];
  let rest = body;
  for (const n of names) {
    const re = new RegExp(`@${esc(n)}(?![\\w-])`, "i");
    if (!re.test(rest)) continue;
    rest = rest.replace(new RegExp(re.source, "gi"), " ");
    found.push({ name: n, agent_id: own.find((a) => a.name === n)?.id ?? null });
    if (found.length >= MAX_MENTIONS) break;
  }
  return found;
}

export async function teamChannels(env: Env, orgId: string, by = "system") {
  const have = await all<any>(env, "SELECT name FROM os_channel WHERE org_id = ? AND kind = 'team'", orgId);
  if (!have.length) {
    for (const n of DEFAULT_CHANNELS) await run(env, "INSERT OR IGNORE INTO os_channel (id, org_id, name, kind, created_by, created_at) VALUES (?,?,?,?,?,?)", newId("chn"), orgId, n, "team", by, nowIso());
  }
  return all<any>(env, `SELECT c.id, c.name, c.kind, c.created_at,
      (SELECT COUNT(*) FROM os_message m WHERE m.channel_id = c.id) AS messages,
      (SELECT MAX(at) FROM os_message m WHERE m.channel_id = c.id) AS last_at
    FROM os_channel c WHERE c.org_id = ? AND c.kind = 'team' ORDER BY c.name = 'general' DESC, c.name`, orgId);
}

export async function createChannel(env: Env, orgId: string, name: string, by: string) {
  const n = name.toLowerCase().replace(/^#/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (n.length < 2) throw new HttpError(400, "invalid_request", "A channel needs a name, for example \"site-team\".");
  if (await one(env, "SELECT id FROM os_channel WHERE org_id = ? AND kind = 'team' AND name = ?", orgId, n)) throw new HttpError(409, "exists", `#${n} already exists.`);
  if (((await one<any>(env, "SELECT COUNT(*) AS n FROM os_channel WHERE org_id = ? AND kind = 'team'", orgId))?.n || 0) >= 100) throw new HttpError(409, "too_many", "A workspace can have 100 channels.");
  const id = newId("chn");
  await run(env, "INSERT INTO os_channel (id, org_id, name, kind, created_by, created_at) VALUES (?,?,?,?,?,?)", id, orgId, n, "team", by, nowIso());
  await audit(env, orgId, by, "channel_added", id, { name: n });
  return { id, name: n };
}

/** A record's thread: its own channel, made when first needed. */
export async function recordChannel(env: Env, orgId: string, recordId: string) {
  const rec = await one<any>(env, "SELECT * FROM os_record WHERE id = ? AND org_id = ?", recordId, orgId);
  if (!rec) throw new HttpError(404, "not_found", "Record not found.");
  let ch = await one<any>(env, "SELECT * FROM os_channel WHERE org_id = ? AND record_id = ?", orgId, recordId);
  if (!ch) {
    await run(env, "INSERT OR IGNORE INTO os_channel (id, org_id, name, kind, record_id, created_at) VALUES (?,?,?,?,?,?)", newId("chn"), orgId, recordId, "record", recordId, nowIso());
    ch = await one<any>(env, "SELECT * FROM os_channel WHERE org_id = ? AND record_id = ?", orgId, recordId);
  }
  return { channel: ch, record: rec };
}

export async function channelById(env: Env, orgId: string, id: string) {
  const ch = await one<any>(env, "SELECT * FROM os_channel WHERE id = ? AND org_id = ?", id, orgId);
  if (!ch) throw new HttpError(404, "not_found", "Channel not found.");
  return ch;
}

/** Messages in a channel, oldest first. `after` pages forward for polling; otherwise the latest page. */
export async function messages(env: Env, orgId: string, channelId: string, after?: string) {
  if (after) return all<any>(env, "SELECT id, channel_id, author_kind, author_id, author_name, body, mentions, at FROM os_message WHERE org_id = ? AND channel_id = ? AND at > ? ORDER BY at LIMIT ?", orgId, channelId, after, PAGE);
  return (await all<any>(env, "SELECT id, channel_id, author_kind, author_id, author_name, body, mentions, at FROM os_message WHERE org_id = ? AND channel_id = ? ORDER BY at DESC LIMIT ?", orgId, channelId, PAGE)).reverse();
}

/**
 * A person says something in a channel. Each @mentioned agent is asked, with the message (and the record,
 * on a record's thread) as its input; its answer is posted back here when the run ends.
 */
export async function say(env: Env, orgId: string, ch: any, who: { id: string; name: string }, body: string) {
  const text = body.trim().slice(0, 4000);
  if (!text) throw new HttpError(400, "invalid_request", "Write a message.");
  const mentions = await findMentions(env, orgId, text);
  const msg = await postMessage(env, orgId, ch.id, { kind: "person", id: who.id, name: who.name, body: text, mentions: mentions.map((m) => m.name) });
  const asked: { agent: string; agent_id?: string; run_id?: string; error?: string }[] = [];
  let context = "";
  if (ch.kind === "record" && ch.record_id) {
    const rec = shapeRecord(await one<any>(env, "SELECT * FROM os_record WHERE id = ? AND org_id = ?", ch.record_id, orgId));
    if (rec) context = `\n\nThis is the thread on a record in the ${rec.module} module:\n${JSON.stringify(rec)}`;
  }
  const where = ch.kind === "record" ? "on a record's thread" : `in #${ch.name}`;
  for (const m of mentions) {
    try {
      const agent = m.agent_id ? await one<any>(env, "SELECT * FROM agent WHERE id = ?", m.agent_id) : await ensureRoleAgent(env, orgId, m.name, who.name);
      const spec = agent && specFor(agent);
      if (!agent || !spec || spec.engine !== "llm") throw new HttpError(409, "not_runnable", `${m.name} works from the registers on its own schedule and can't be asked in a channel.`);
      if (agent.status !== "running") throw new HttpError(409, "paused", `${agent.name} is paused. Switch it back on in Agents to ask it things.`);
      const runId = await startRun(env, orgId, agent.id, "manual", `${who.name} asked you ${where}:\n${text}${context}`, { replyChannel: ch.id });
      asked.push({ agent: agent.name, agent_id: agent.id, run_id: runId });
    } catch (e: any) {
      asked.push({ agent: m.name, error: e?.message || "Couldn't ask that agent." });
      await postMessage(env, orgId, ch.id, { kind: "system", name: "Agent House", body: `${m.name} wasn't asked: ${e?.message || "something went wrong"}` });
    }
  }
  return { message: msg, asked };
}

/** Who can be @mentioned: the people in the workspace and every agent, hired or not. */
export async function directory(env: Env, orgId: string) {
  const people = await all<any>(env, "SELECT u.id, u.name, u.email, m.role FROM membership m JOIN user u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.name, u.email", orgId);
  const own = await all<any>(env, "SELECT id, name, template, status FROM agent WHERE org_id = ? AND template != 'orchestrator' ORDER BY name", orgId);
  const hired = new Set(own.map((a) => a.name));
  return {
    people: people.map((p) => ({ id: p.id, name: p.name || p.email.split("@")[0], email: p.email, role: p.role })),
    agents: [
      ...own.map((a) => ({ id: a.id, name: a.name, hired: true, status: a.status, modules: a.template === "os" ? modulesFor(a.name).map((f) => f.key) : [] })),
      ...ROLES.filter((r) => !hired.has(r)).map((r) => ({ id: null, name: r, hired: false, status: null, modules: modulesFor(r).map((f) => f.key) })),
    ],
  };
}
