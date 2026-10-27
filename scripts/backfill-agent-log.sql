-- One-off: fill agent_log with the last 30 days from the tables that recorded it before. Safe to re-run: every row
-- uses the same ref live logging uses (or swarm_event:<id> where live logging has no equivalent), and agent_log is
-- unique on (org_id, ref). Run with: node scripts/backfill-agent-log.mjs [--local|--remote]

-- Runs started
INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, mode, ref, at)
SELECT org_id, agent_id, 'action',
  'Started' || CASE trigger WHEN 'event' THEN ' on a handoff' WHEN 'manual' THEN ' (asked)' WHEN 'schedule' THEN ' on schedule' ELSE '' END,
  json_object('trigger', trigger), json_object('run', id), id, mode, 'run:' || id || ':start', started_at
FROM agent_run WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
ON CONFLICT(org_id, ref) DO NOTHING;

-- Runs finished or stopped
INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, mode, tokens_in, tokens_out, credits, ref, at)
SELECT org_id, agent_id, CASE status WHEN 'failed' THEN 'error' ELSE 'action' END,
  CASE status WHEN 'failed' THEN 'Stopped: ' || COALESCE(substr(error, 1, 200), 'the run failed')
    ELSE 'Finished: ' || COALESCE(NULLIF(substr(summary, 1, CASE WHEN instr(summary, char(10)) > 0 THEN instr(summary, char(10)) - 1 ELSE 200 END), ''), 'no summary') END,
  json_object('steps', steps, 'tool_calls', tool_calls), json_object('run', id), id, mode,
  tokens_in + cache_read + cache_write, tokens_out, credits, 'run:' || id || ':end', finished_at
FROM agent_run WHERE finished_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') AND status IN ('done', 'waiting', 'failed')
ON CONFLICT(org_id, ref) DO NOTHING;

-- Drafts proposed for approval
INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, action_id, ref, at)
SELECT org_id, agent_id, 'approval', 'Drafted: ' || title, json_object('kind', kind, 'reason', substr(reason, 1, 300)),
  json_object('action', id, 'run', run_id), run_id, id, 'action:' || id || ':proposed', created_at
FROM agent_action WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
ON CONFLICT(org_id, ref) DO NOTHING;

-- Drafts decided (sent, rejected, failed)
INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, action_id, ref, at)
SELECT org_id, agent_id, CASE decided_by WHEN 'agent' THEN 'action' ELSE 'decision' END,
  CASE WHEN decided_by = 'removed' THEN 'Rejected: the agent was removed (' || title || ')'
    WHEN status = 'rejected' THEN 'Rejected by ' || COALESCE(decided_by, 'someone') || ': ' || title
    WHEN decided_by = 'agent' THEN 'Sent on its own: ' || title
    ELSE 'Approved by ' || COALESCE(decided_by, 'someone') || ': ' || title || CASE status WHEN 'failed' THEN ' (not sent: ' || COALESCE(substr(result, 1, 120), 'failed') || ')' ELSE '' END END,
  json_object('by', decided_by, 'outcome', status), json_object('action', id, 'run', run_id), run_id, id, 'action:' || id || ':decided', COALESCE(decided_at, created_at)
FROM agent_action WHERE status != 'proposed' AND COALESCE(decided_at, created_at) >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
ON CONFLICT(org_id, ref) DO NOTHING;

-- Credits used
INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, mode, tokens_in, tokens_out, credits, ref, at)
SELECT org_id, agent_id, 'cost',
  'Used ' || round(-credits, 2) || ' credits' || CASE WHEN note IS NOT NULL THEN ': ' || note WHEN mode IS NOT NULL THEN ' (' || mode || ')' ELSE '' END,
  json_object('kind', kind, 'task_type', task_type), CASE WHEN run_id IS NOT NULL THEN json_object('run', run_id) END, run_id, mode,
  tokens_in + cache_read + cache_write, tokens_out, round(-credits, 2), 'cost:' || kind || ':' || ref, at
FROM credit_entry WHERE kind IN ('run', 'system') AND at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
ON CONFLICT(org_id, ref) DO NOTHING;

-- House rules
INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, action_id, ref, at)
SELECT org_id, agent_id, 'learning',
  CASE source WHEN 'owner' THEN 'New house rule from ' || COALESCE(created_by, 'the owner') || ': ' || text ELSE 'Learned from an edit, waiting for you: ' || text END,
  json_object('source', source), json_object('rule', id, 'action', action_id), action_id,
  'rule:' || id || ':' || CASE source WHEN 'owner' THEN 'added' ELSE 'proposed' END, created_at
FROM house_rule WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
ON CONFLICT(org_id, ref) DO NOTHING;

-- Tasks one agent gave another (same ref as live logging)
INSERT INTO agent_log (org_id, agent_id, type, summary, linked, run_id, ref, at)
SELECT org_id, agent_id, 'handoff', summary,
  json_object('task', json_extract(detail, '$.task_id'), 'agent', json_extract(detail, '$.to_agent'), 'run', run_id, 'item', item_id), run_id,
  'task:' || json_extract(detail, '$.task_id'), at
FROM swarm_event WHERE kind = 'task' AND json_extract(detail, '$.task_id') IS NOT NULL AND at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
ON CONFLICT(org_id, ref) DO NOTHING;

-- Cards handed on, and failed tool calls. Live logging has its own refs for these, so only events from before it
-- started are copied: anything later is already in the log.
INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, ref, at)
SELECT org_id, agent_id, 'handoff', summary, json_object('stage', json_extract(detail, '$.stage')),
  json_object('item', item_id, 'agent', json_extract(detail, '$.to_agent'), 'run', run_id), run_id, 'swarm_event:' || id, at
FROM swarm_event WHERE kind = 'handoff' AND at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  AND at < COALESCE((SELECT MIN(at) FROM agent_log WHERE ref LIKE 'handoff:%'), '9999')
ON CONFLICT(org_id, ref) DO NOTHING;

INSERT INTO agent_log (org_id, agent_id, type, summary, detail, linked, run_id, ref, at)
SELECT org_id, agent_id, 'error', summary || ' failed', json_object('tool', summary), json_object('run', run_id), run_id, 'swarm_event:' || id, at
FROM swarm_event WHERE kind = 'tool' AND json_extract(detail, '$.ok') = 0 AND at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  AND at < COALESCE((SELECT MIN(at) FROM agent_log WHERE ref LIKE 'run:%:tool:%'), '9999')
ON CONFLICT(org_id, ref) DO NOTHING;
