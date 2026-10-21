-- The org chart: who each agent reports to, the badges that set its role and skills, and tasks passed down the tree.

ALTER TABLE agent ADD COLUMN reports_to TEXT;     -- an agent id in the same swarm; null = reports to the orchestrator (or the owner)
ALTER TABLE agent ADD COLUMN badges TEXT;         -- JSON {"role","skills"}; null = read from the template

-- A piece of work one agent (or the owner) gave another. The orchestrator plans with these.
CREATE TABLE agent_task (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  swarm_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,                        -- who does it
  assigned_by TEXT NOT NULL,                     -- an agent id, or 'owner'
  assigned_run TEXT,                             -- the run that assigned it, for the per-run limit
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','blocked','done','dropped')),
  run_id TEXT,                                   -- the run working on it
  item_id TEXT,                                  -- a card on the board it concerns
  result TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX agent_task_agent ON agent_task(agent_id, status);
CREATE INDEX agent_task_swarm ON agent_task(swarm_id, updated_at);
CREATE INDEX agent_task_run ON agent_task(run_id);
CREATE INDEX agent_task_assigner ON agent_task(assigned_by, created_at);
