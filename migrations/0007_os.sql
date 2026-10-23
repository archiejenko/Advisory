-- The business OS: native modules for every area of the business, and channels where people and agents talk.

-- One table for every module's records. A module is a facet key from packages/core/os.ts; the fields that
-- differ by kind live in the fields JSON, and the ones every list sorts or sums by have their own columns.
CREATE TABLE IF NOT EXISTS os_record (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  owner TEXT,
  due_date TEXT,
  amount_pence INTEGER,
  party TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS os_record_module ON os_record(org_id, module, updated_at);
CREATE INDEX IF NOT EXISTS os_record_due ON os_record(org_id, due_date);

-- Channels: team channels (#general, #sales) and one thread per record, created when the first message is posted.
CREATE TABLE IF NOT EXISTS os_channel (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('team','record')),
  record_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS os_channel_name ON os_channel(org_id, kind, name);
CREATE UNIQUE INDEX IF NOT EXISTS os_channel_record ON os_channel(org_id, record_id) WHERE record_id IS NOT NULL;

-- Messages from people, agents and the system, in one stream per channel.
CREATE TABLE IF NOT EXISTS os_message (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('person','agent','system')),
  author_id TEXT,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  mentions TEXT NOT NULL DEFAULT '[]',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS os_message_channel ON os_message(channel_id, at);
CREATE INDEX IF NOT EXISTS os_message_org ON os_message(org_id, at);

-- One task list for people and agents: a task can be assigned to a person in the business.
ALTER TABLE task ADD COLUMN assignee_user_id TEXT;
-- A run asked for from a channel posts its answer back there.
ALTER TABLE agent_run ADD COLUMN reply_channel TEXT;
