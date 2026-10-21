-- Hardening before launch: per-agent usage, billing state, purge tracking, and indexes for the paid API.

-- Usage is written as each agent tool call happens, so it can be checked against both the plan and the agent's cap.
ALTER TABLE usage_event ADD COLUMN agent_id TEXT;
CREATE INDEX usage_key_at ON usage_event(key_id, at);
CREATE INDEX usage_org_kind_at ON usage_event(org_id, kind, at);
CREATE INDEX usage_agent_at ON usage_event(agent_id, at);
CREATE INDEX usage_ref ON usage_event(payment_ref);   -- one agent_run cost row per run

-- Credit balance is summed on every paid call.
CREATE INDEX credit_key ON credit_ledger(key_id);

-- When the subscription entered its current status (for the past_due grace period).
ALTER TABLE subscription ADD COLUMN status_since TEXT;
CREATE INDEX subscription_stripe ON subscription(stripe_subscription);

-- Set once a cancelled business's data has been deleted, so retention doesn't revisit it.
ALTER TABLE org ADD COLUMN purged_at TEXT;

-- The stuck-run sweeper looks for runs by status and age.
CREATE INDEX run_status ON agent_run(status, started_at);
