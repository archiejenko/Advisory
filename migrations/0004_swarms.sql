-- Swarms and the Floor: groups of agents set up for one business, the work each agent is on,
-- a live event log, and the business core (contacts, deals, an activity timeline).

CREATE TABLE swarm (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT,
  description TEXT,
  preset TEXT,                                   -- sales-floor | back-office | markets-desk | null (generated)
  blueprint TEXT NOT NULL,                       -- JSON, checked against the schema in lib/swarm.ts
  layout TEXT NOT NULL DEFAULT '{}',             -- JSON: positions and view preferences saved from the Floor
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused')),
  monthly_cap INTEGER,                           -- actions a month for the whole swarm (null = plan allowance only)
  synced_at TEXT,
  last_brief_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX swarm_org ON swarm(org_id, created_at);

-- Agents belong to at most one swarm; custom roles keep their standing orders and tools on the row.
ALTER TABLE agent ADD COLUMN swarm_id TEXT;
ALTER TABLE agent ADD COLUMN swarm_key TEXT;      -- the agent's key inside its swarm's blueprint
ALTER TABLE agent ADD COLUMN role TEXT;           -- one line: what this agent does in the swarm
ALTER TABLE agent ADD COLUMN instructions TEXT;   -- custom roles only
ALTER TABLE agent ADD COLUMN tools TEXT;          -- custom roles only: JSON array of tool slugs
CREATE INDEX agent_swarm ON agent(swarm_id);

-- One card per thing an agent is working on. Cards backed by a record (lead, invoice, message) take their
-- stage from that record; free-standing cards are moved by agents with track-work, or by hand.
CREATE TABLE work_item (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  swarm_id TEXT NOT NULL,
  agent_id TEXT,                                 -- current owner
  stage TEXT NOT NULL,                           -- a stage key from the blueprint
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  value_pence INTEGER,
  ref_kind TEXT,                                 -- lead | invoice | message | null
  ref_id TEXT,
  note TEXT,
  handoff_day TEXT,                              -- loop guard: handoffs counted per day
  handoffs_today INTEGER NOT NULL DEFAULT 0,
  last_from_agent TEXT,                          -- who handed it over last
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX work_swarm ON work_item(swarm_id, status, updated_at);
CREATE UNIQUE INDEX work_ref ON work_item(swarm_id, ref_kind, ref_id);

-- What happened, in order. The integer id is the Floor's cursor. Kept 30 days.
CREATE TABLE swarm_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  swarm_id TEXT NOT NULL,
  agent_id TEXT,
  run_id TEXT,
  item_id TEXT,
  kind TEXT NOT NULL,                            -- run_started | tool | proposed | sent | run_done | run_failed | handoff | moved | created | ask | brief
  summary TEXT NOT NULL,
  detail TEXT,                                   -- JSON: from/to stage, tool name, agent keys
  at TEXT NOT NULL
);
CREATE INDEX event_swarm ON swarm_event(swarm_id, id);
CREATE INDEX event_org_at ON swarm_event(org_id, at);

/* ---------- The business core: CRM ----------
   A company is a lead row (the table every agent already writes); contacts, deals and the timeline hang off it. */
CREATE TABLE contact (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  lead_id TEXT,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,                                   -- where it came from: website, reply, manual
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX contact_org ON contact(org_id, lead_id);

CREATE TABLE deal (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  lead_id TEXT,
  contact_id TEXT,
  title TEXT NOT NULL,
  value_pence INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'open',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  agent_id TEXT,
  expected_close TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX deal_org ON deal(org_id, status, updated_at);
CREATE INDEX deal_lead ON deal(org_id, lead_id);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  lead_id TEXT,
  deal_id TEXT,
  contact_id TEXT,
  agent_id TEXT,
  actor TEXT,                                    -- a person's email, an agent's name, or "system"
  kind TEXT NOT NULL,                            -- note | email | reply | call | stage | payment | lead | deal
  summary TEXT NOT NULL,
  ref_kind TEXT,
  ref_id TEXT,
  at TEXT NOT NULL
);
CREATE INDEX activity_lead ON activity(org_id, lead_id, at);
CREATE INDEX activity_org_at ON activity(org_id, at);
