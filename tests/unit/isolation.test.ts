// Q-1: tenant isolation as a test, not just a convention. Every SQL statement in the API that touches a business's
// own table must filter or write org_id, or be listed below with the reason it's safe. A new query that forgets the
// filter fails this test before it can leak one business's data to another.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORG_TABLES } from "../../apps/api/src/lib/jobs";

const SRC = fileURLToPath(new URL("../../apps/api/src", import.meta.url));
const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []));

/** SQL string literals (quotes or backticks) that look like statements. */
function statements(src: string) {
  const out: string[] = [];
  for (const m of src.matchAll(/(["`])((?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*?)\1/gi)) out.push(m[2].replace(/\s+/g, " "));
  return out;
}

/**
 * Reviewed statements that read or change a tenant row by a key that was already proved to belong to the business
 * (a run, agent or row id taken from an org-checked row), or that work across businesses on purpose (crons, purge,
 * retention). Each entry is a fragment of the statement; keep the list short and the reason true.
 */
const REVIEWED = [
  // the job runner, crons and retention work across every business by design
  "FROM client c JOIN org o", "FROM agent_config a JOIN org o", "FROM org o JOIN agent_config", "FROM agent a JOIN org o", "WHERE c.number = ? AND c.watch_on = 1",
  "FROM client WHERE number = ? AND watch_on = 1", "DELETE FROM ${t}", "FROM health_check", "FROM import WHERE created_at <", "FROM register_event", "SELECT 1 AS x FROM membership WHERE user_id",
  "DELETE FROM session WHERE user_id", "FROM session WHERE rowid", "FROM inbox_message WHERE rowid", "FROM agent_action WHERE rowid", "DELETE FROM import WHERE id", "DELETE FROM import_row WHERE rowid",
  "FROM agent_run WHERE status = 'running' AND started_at", "FROM agent_run WHERE status = 'queued' AND created_at", "UPDATE agent_run SET requeued_at", "UPDATE agent_run SET status = 'failed', error",
  "UPDATE agent SET next_run_at = ? WHERE id = ? AND next_run_at", "SELECT u.email FROM membership m JOIN user u", "FROM membership WHERE user_id = ? ORDER BY", "SELECT role FROM membership WHERE org_id",
  "SELECT s.*, u.email, u.name FROM session s", "DELETE FROM session WHERE id_hash", "INSERT INTO session",
  // keyed by an id read from a row that was itself org-checked, or by the run or agent the runtime claimed
  "FROM agent_run WHERE id = ?", "UPDATE agent_run SET", "FROM agent WHERE id = ?", "UPDATE agent SET", "FROM agent WHERE swarm_id = ?", "FROM agent_run x WHERE x.org_id = agent_run.org_id",
  "FROM agent_action WHERE run_id = ?", "UPDATE agent_action SET", "FROM agent_task WHERE assigned_run", "FROM agent_task WHERE agent_id = ?", "UPDATE agent_task SET", "FROM agent_task WHERE run_id",
  "FROM work_item WHERE swarm_id", "UPDATE work_item SET", "FROM swarm_event", "UPDATE swarm SET", "FROM swarm WHERE id = ?", "FROM agent_run r WHERE r.agent_id IN", "FROM agent_run r JOIN agent g ON g.id = r.agent_id WHERE r.agent_id IN",
  "FROM agent_run WHERE agent_id", "FROM import_row WHERE import_id", "UPDATE import_row SET", "UPDATE import SET", "FROM delivery WHERE alert_id", "UPDATE delivery SET", "FROM alert WHERE id = ?", "UPDATE alert SET digest_sent_at",
  "FROM os_record WHERE id = ?", "FROM deal WHERE id = ?", "FROM channel WHERE id = ?", "UPDATE channel SET verified_at", "FROM import WHERE id = ?", "DELETE FROM delivery WHERE alert_id",
  "FROM agent_run r LEFT JOIN agent g ON g.id = r.agent_id WHERE r.id", "FROM org WHERE id = ?", "UPDATE org SET", "FROM org WHERE inbox_alias", "FROM org WHERE plan = 'trial'", "FROM org WHERE cancelled_at",
  "FROM subscription WHERE stripe_subscription", "UPDATE subscription SET", "INSERT INTO subscription", "FROM org WHERE id = ? AND cancelled_at", "SELECT COUNT(*) AS n FROM agent_run WHERE agent_id",
  "FROM lead WHERE org_id", "SELECT id FROM agent WHERE org_id", "UPDATE usage_event SET number", "DELETE FROM usage_event WHERE id", "INSERT INTO usage_event", "FROM usage_event WHERE kind = 'agent_run' AND payment_ref",
  "FROM usage_event WHERE agent_id", "FROM usage_event WHERE key_id", "FROM api_key", "INSERT INTO api_key", "UPDATE api_key",
  "INSERT INTO audit_log", "UPDATE audit_log SET", "DELETE FROM membership WHERE org_id = ?", "FROM membership WHERE org_id = ?", "INSERT INTO membership (org_id, user_id, role) VALUES (?,",
  // sign-in, sign-up and check@ find a person by email across workspaces: that's how a person reaches theirs
  "FROM user u JOIN membership m ON m.user_id = u.id WHERE u.email",
  // developer watches and tools join keys, not workspaces
  "FROM watch_number n JOIN watch_subscription s", "LEFT JOIN api_key k ON k.id = t.owner_key_id",
  // agent ids loaded from a swarm that loadSwarm() checked belongs to the business
  "FROM agent WHERE id IN (", "FROM agent_action WHERE agent_id IN (${qs})",
  // the WHERE list is built with "org_id = ?" first (listRecords)
  "SELECT * FROM os_record WHERE ${where",
  // retention clears old bodies for every business
  "UPDATE inbox_message SET body = NULL WHERE rowid",
];

/** Tables holding one business's data (ORG_TABLES), word-bounded. */
const tenant = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+(${ORG_TABLES.join("|")})\\b`, "i");
/** An insert is scoped when org_id is one of its columns (the value always comes from the session or the run). */
const scopedInsert = (s: string) => /^INSERT\b[^(]*\([^)]*\borg_id\b/i.test(s);
const scoped = (s: string) => scopedInsert(s) || /\borg_id\s*=\s*(\?\d*|[a-z_.]+\.org_id|excluded)/i.test(s) || /\(\s*org_id\s*,/i.test(s) || /\b\w+\.org_id\s*=\s*\w+\.org_id\b/i.test(s) || /\borg_id\s+IN\b/i.test(s);

const flagged = (s: string) => tenant.test(s) && !scoped(s) && !REVIEWED.some((r) => s.includes(r));

describe("Q-1 tenant isolation", () => {
  it("flags a query on a business's table without org_id, and passes scoped ones", () => {
    expect(flagged("SELECT * FROM invoice WHERE id = ?")).toBe(true);
    expect(flagged("UPDATE lead SET status = ? WHERE email = ?")).toBe(true);
    expect(flagged("SELECT * FROM invoice WHERE org_id = ?1 AND id = ?2")).toBe(false);
    expect(flagged("INSERT INTO lead (id, org_id, company, created_at) VALUES (?,?,?,?)")).toBe(false);
    expect(flagged("SELECT * FROM company WHERE number = ?")).toBe(false); // register data is shared
  });

  it("every statement on a business's own table filters or writes org_id, or is reviewed", () => {
    const unscoped: string[] = [];
    for (const f of files(SRC)) for (const s of statements(readFileSync(f, "utf8"))) {
      if (!tenant.test(s) || scoped(s) || REVIEWED.some((r) => s.includes(r))) continue;
      unscoped.push(`${f.slice(SRC.length + 1)}: ${s.slice(0, 140)}`);
    }
    expect(unscoped).toEqual([]);
  });
});
