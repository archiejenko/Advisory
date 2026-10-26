-- Scale fixes from the architecture check (October 2026), and Phase A of the operating-platform plan.

-- Indexes the clean-up, purge and sign-in paths were missing (they scanned whole tables).
CREATE INDEX IF NOT EXISTS membership_user ON membership(user_id);
CREATE INDEX IF NOT EXISTS session_org ON session(org_id);
CREATE INDEX IF NOT EXISTS session_expires ON session(expires_at);
CREATE INDEX IF NOT EXISTS import_org ON import(org_id, created_at);
CREATE INDEX IF NOT EXISTS import_created ON import(created_at);
CREATE INDEX IF NOT EXISTS import_row_org ON import_row(org_id);
CREATE INDEX IF NOT EXISTS delivery_org ON delivery(org_id);
CREATE INDEX IF NOT EXISTS work_item_org ON work_item(org_id);
CREATE INDEX IF NOT EXISTS agent_task_org ON agent_task(org_id);
CREATE INDEX IF NOT EXISTS brief_org ON brief(org_id, created_at);
CREATE INDEX IF NOT EXISTS channel_org ON channel(org_id);
CREATE INDEX IF NOT EXISTS register_event_processed ON register_event(processed_at);
CREATE INDEX IF NOT EXISTS health_check_created ON health_check(created_at);
CREATE INDEX IF NOT EXISTS agent_run_finished ON agent_run(finished_at);
CREATE INDEX IF NOT EXISTS inbox_received ON inbox_message(received_at);
CREATE INDEX IF NOT EXISTS action_decided ON agent_action(decided_at);

-- Truth API watches, one row per watched number, so a stream event is a lookup, not a scan of every watch.
CREATE TABLE IF NOT EXISTS watch_number (
  watch_id TEXT NOT NULL,
  number TEXT NOT NULL,
  PRIMARY KEY (number, watch_id)
);
INSERT OR IGNORE INTO watch_number (watch_id, number)
  SELECT w.id, j.value FROM watch_subscription w, json_each(w.numbers) j WHERE w.deleted_at IS NULL;

-- Messages that ran out of retries. Recorded by the dead-letter consumer, so nothing is lost without a trace.
CREATE TABLE IF NOT EXISTS dead_job (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL,
  type TEXT,
  body TEXT NOT NULL,
  attempts INTEGER,
  at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS dead_job_open ON dead_job(resolved_at, at);

-- A run is re-queued by the sweep at most once, so a backlog doesn't multiply its own messages.
ALTER TABLE agent_run ADD COLUMN requeued_at TEXT;

-- House rules: how this business wants things done. Learned from the owner's edits to drafts, or said directly.
-- Every agent in the workspace follows the active ones.
CREATE TABLE IF NOT EXISTS house_rule (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('edit','owner')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','dismissed')),
  action_id TEXT,                 -- the edited draft it was learned from
  created_by TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS house_rule_org ON house_rule(org_id, status, created_at);
