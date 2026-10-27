-- The AI Team: every agent wears a persona (packages/core/personas.ts), and one log records what each agent did.

ALTER TABLE agent ADD COLUMN persona TEXT;            -- a persona key; null = custom role
ALTER TABLE agent ADD COLUMN persona_overrides TEXT;  -- JSON: the owner's changes to name, role, mission, personality, hue, kpis
ALTER TABLE agent ADD COLUMN probation_until TEXT;    -- a new hire works under closer review until this date

-- Existing agents take the persona of their template (personaForTemplate; a test keeps the two the same).
UPDATE agent SET persona = CASE template
  WHEN 'orchestrator' THEN 'ava' WHEN 'briefing' THEN 'ava' WHEN 'research' THEN 'iris' WHEN 'lead-finder' THEN 'leo'
  WHEN 'outreach' THEN 'maya' WHEN 'social' THEN 'kai' WHEN 'bookings' THEN 'ruby' WHEN 'reviews' THEN 'ollie'
  WHEN 'customer-watch' THEN 'grace' WHEN 'bookkeeping' THEN 'finn' WHEN 'credit-control' THEN 'clara'
  WHEN 'inbox' THEN 'isla' WHEN 'customer-check' THEN 'felix' END
WHERE persona IS NULL;

-- One row per thing an agent did or had done to it. `ref` names the event (run:<id>:start, action:<id>:decided,
-- cost:run:<run id> ...) so a retry, the sweep or a re-run backfill can never write it twice.
CREATE TABLE agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  agent_id TEXT,                                 -- null for workspace-wide events (a system charge, an owner's rule)
  type TEXT NOT NULL CHECK (type IN ('action','decision','approval','handoff','cost','error','learning')),
  summary TEXT NOT NULL,
  detail TEXT,                                   -- JSON
  linked TEXT,                                   -- JSON {run, action, task, item, lead, invoice, rule, agent}
  run_id TEXT,
  action_id TEXT,
  mode TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  credits REAL NOT NULL DEFAULT 0,
  autonomy_level INTEGER,
  undo_token TEXT,
  ref TEXT NOT NULL,
  at TEXT NOT NULL,
  UNIQUE (org_id, ref)
);
CREATE INDEX agent_log_agent ON agent_log(agent_id, id);
CREATE INDEX agent_log_org_at ON agent_log(org_id, at);

-- An agent's set-up over time, so a change can be seen and undone.
CREATE TABLE agent_version (
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,                        -- JSON of the agent row
  changed_by TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (agent_id, version)
);

-- The agent whose draft a rule was learned from.
ALTER TABLE house_rule ADD COLUMN agent_id TEXT;
