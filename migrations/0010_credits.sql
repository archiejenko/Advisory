-- Credits: the AI Team is metered on model cost (1 credit = 1p) instead of tool-call "actions".
-- The ledger is append-only. Balances are sums over it, never a stored counter.

CREATE TABLE credit_entry (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trial_grant','plan_grant','plan_expiry','upgrade_grant','topup','run','system','adjustment')),
  credits REAL NOT NULL,                 -- 2dp; + adds credits, - uses them
  from_plan REAL NOT NULL DEFAULT 0,     -- the part of credits that is plan credits (reset on the 1st)
  from_topup REAL NOT NULL DEFAULT 0,    -- the part that is top-up credits (roll over)
  period TEXT NOT NULL,                  -- YYYY-MM, UK time
  agent_id TEXT,
  run_id TEXT,
  mode TEXT,
  model TEXT,
  task_type TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,  -- uncached input
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,   -- model requests (steps) behind a run
  cost REAL NOT NULL DEFAULT 0,          -- model cost in credits before the per-run minimum, unrounded
  ref TEXT NOT NULL,                     -- what makes the entry unique: a run id, a period, a Stripe session
  note TEXT,
  at TEXT NOT NULL,
  UNIQUE (org_id, kind, ref)
);
CREATE INDEX credit_org_period ON credit_entry(org_id, period);
CREATE INDEX credit_agent_period ON credit_entry(agent_id, period);
CREATE INDEX credit_org_at ON credit_entry(org_id, at);
CREATE INDEX credit_task_model ON credit_entry(task_type, model, at);

-- Each agent's default mode, an optional monthly cap in credits, and the per-run estimate the owner approved
-- for runs that start without them (schedules, events).
ALTER TABLE agent ADD COLUMN mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE agent ADD COLUMN monthly_budget REAL;
ALTER TABLE agent ADD COLUMN budget_paused_period TEXT;
ALTER TABLE agent ADD COLUMN confirmed_estimate REAL;

ALTER TABLE agent_run ADD COLUMN mode TEXT;
ALTER TABLE agent_run ADD COLUMN model TEXT;
ALTER TABLE agent_run ADD COLUMN task_type TEXT;
ALTER TABLE agent_run ADD COLUMN cache_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_run ADD COLUMN cache_write INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_run ADD COLUMN credits REAL NOT NULL DEFAULT 0;

-- A task given to an agent can run in its own mode.
ALTER TABLE agent_task ADD COLUMN mode TEXT;

ALTER TABLE org ADD COLUMN confirm_over REAL NOT NULL DEFAULT 100;  -- runs estimated above this ask first
ALTER TABLE org ADD COLUMN pending_plan TEXT;                       -- a downgrade waiting for the 1st
ALTER TABLE org ADD COLUMN credits_out_notified TEXT;               -- the period the owner was told credits ran out

-- Swarm caps were in actions, which don't translate to credits: they start empty.
UPDATE swarm SET monthly_cap = NULL;
