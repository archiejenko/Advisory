// The agent log: one row per thing an agent did or had done to it (runs, approvals, decisions, handoffs, costs,
// errors, learning), read back per agent. Each event has a ref, so a retry or a re-run backfill never writes it twice.
import { nowIso } from "../../../../packages/core/util";
import { type Env, run } from "./db";

export const LOG_TYPES = ["action", "decision", "approval", "handoff", "cost", "error", "learning"] as const;
export type LogType = (typeof LOG_TYPES)[number];

export type LogEvent = {
  orgId: string;
  agentId?: string | null;
  type: LogType;
  summary: string;
  ref: string;
  detail?: unknown;
  linked?: Record<string, string | null | undefined>;
  runId?: string | null;
  actionId?: string | null;
  mode?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  credits?: number;
  autonomyLevel?: number | null;
  at?: string;
};

/** Record an event. Never throws: the log must not break the work it records. */
export async function logEvent(env: Env, e: LogEvent) {
  try {
    const linked = e.linked && Object.fromEntries(Object.entries(e.linked).filter(([, v]) => v));
    await run(env, `INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, action_id, mode, tokens_in, tokens_out, credits, autonomy_level, ref, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id, ref) DO NOTHING`,
      e.orgId, e.agentId ?? null, e.type, e.summary.slice(0, 300), e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 2000),
      linked && Object.keys(linked).length ? JSON.stringify(linked) : null, e.runId ?? null, e.actionId ?? null, e.mode ?? null,
      e.tokensIn ?? 0, e.tokensOut ?? 0, e.credits ?? 0, e.autonomyLevel ?? null, e.ref, e.at ?? nowIso());
  } catch (err) { console.error("agent log not recorded", e.ref, err); }
}

/** Log the decision on every draft still waiting for an agent that is being removed, before they're rejected. */
export async function logRemovedDrafts(env: Env, orgId: string, agentId: string) {
  try {
    await run(env, `INSERT INTO agent_log (org_id, agent_id, type, summary, linked, run_id, action_id, ref, at)
      SELECT org_id, agent_id, 'decision', 'Rejected: the agent was removed (' || title || ')', json_object('action', id, 'run', run_id), run_id, id, 'action:' || id || ':decided', ?
      FROM agent_action WHERE org_id = ? AND agent_id = ? AND status = 'proposed' ON CONFLICT(org_id, ref) DO NOTHING`, nowIso(), orgId, agentId);
  } catch (err) { console.error("agent log not recorded", agentId, err); }
}
