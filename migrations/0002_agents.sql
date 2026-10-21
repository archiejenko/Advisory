-- Agent House v2: agents for every small business, a shared tool catalogue, developer tools.

ALTER TABLE org ADD COLUMN profile TEXT NOT NULL DEFAULT '{}';      -- what the business does, customers, area, tone
ALTER TABLE org ADD COLUMN plan TEXT NOT NULL DEFAULT 'pilot';      -- pilot | starter | growth | scale
ALTER TABLE org ADD COLUMN inbox_alias TEXT;                         -- <alias>@INBOUND_DOMAIN reaches the inbox agent
CREATE UNIQUE INDEX org_inbox_alias ON org(inbox_alias);

-- A business's hired agents. Templates live in code (packages/core/templates.ts).
CREATE TABLE agent (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  template TEXT NOT NULL,
  name TEXT NOT NULL,
  brief TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused')),
  rhythm TEXT NOT NULL DEFAULT 'weekdays' CHECK (rhythm IN ('weekdays','daily','weekly','monthly','on_demand','on_event')),
  run_hour INTEGER NOT NULL DEFAULT 8,
  autonomy TEXT NOT NULL DEFAULT 'approve_all' CHECK (autonomy IN ('approve_all','approve_first','auto')),
  channel_id TEXT,
  monthly_cap INTEGER NOT NULL DEFAULT 300,                          -- tool calls a month
  next_run_at TEXT,
  last_run_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX agent_org ON agent(org_id);
CREATE INDEX agent_due ON agent(status, next_run_at);

CREATE TABLE agent_run (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  trigger TEXT NOT NULL,                                             -- schedule | manual | event | api
  input TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','done','failed')),
  steps INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  error TEXT,
  transcript_key TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_pence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX run_org ON agent_run(org_id, created_at);
CREATE INDEX run_agent ON agent_run(agent_id, created_at);

-- Anything an agent wants to send to the outside world. Waits for approval unless the owner has allowed it.
CREATE TABLE agent_action (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('email')),
  title TEXT NOT NULL,
  payload TEXT NOT NULL,                                             -- {to, subject, body, lead_id?, invoice_id?, message_id?}
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','sent','rejected','failed')),
  decided_by TEXT,
  decided_at TEXT,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX action_org ON agent_action(org_id, status, created_at);

CREATE TABLE lead (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT,
  company TEXT NOT NULL,
  number TEXT,
  contact_name TEXT,
  email TEXT,
  website TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','replied','won','lost','unsubscribed')),
  notes TEXT,
  last_contact_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX lead_org ON lead(org_id, created_at);
CREATE UNIQUE INDEX lead_org_company ON lead(org_id, company);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX task_org ON task(org_id, status);

CREATE TABLE invoice (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  customer TEXT NOT NULL,
  email TEXT,
  amount_pence INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','disputed')),
  reminders INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, ref)
);

CREATE TABLE inbox_message (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','replied','ignored')),
  urgency TEXT,
  category TEXT,
  summary TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX inbox_org ON inbox_message(org_id, received_at);

-- Developer tools in the shared catalogue. First-party tools are defined in code.
CREATE TABLE tool (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  owner_key_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  price_pence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review','live','rejected','retired')),
  review_note TEXT,
  calls INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE tool_earning (
  id TEXT PRIMARY KEY,
  tool_slug TEXT NOT NULL,
  owner_key_id TEXT NOT NULL,
  gross_pence INTEGER NOT NULL,
  share_pence INTEGER NOT NULL,
  payment TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX earning_owner ON tool_earning(owner_key_id, at);
