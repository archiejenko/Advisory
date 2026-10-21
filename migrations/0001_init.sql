-- Agent House schema, version 1.
-- Register tables are shared across organisations; every workspace table carries org_id.

-- ---------- Register (shared) ----------
CREATE TABLE company (
  number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,
  incorporated TEXT,
  sic TEXT,
  office_locality TEXT,
  office_postcode TEXT,
  accounts_next_due TEXT,
  accounts_last_made_up TEXT,
  cs_next_due TEXT,
  fca_status TEXT,
  snapshot TEXT,              -- JSON of the last full record we compared against
  refreshed_at TEXT
);
CREATE INDEX company_name ON company(name);

CREATE TABLE register_field (
  number TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT,
  source TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  licence TEXT NOT NULL,
  PRIMARY KEY (number, field)
);

CREATE TABLE register_event (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  kind TEXT NOT NULL,          -- company | filing | insolvency | charges | officers | psc | gazette | fca | reconcile
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload TEXT,
  stream_timepoint INTEGER,
  processed_at TEXT,
  UNIQUE (source, source_id)
);
CREATE INDEX register_event_number ON register_event(number, occurred_at);

CREATE TABLE officer (
  number TEXT NOT NULL,
  officer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  appointed TEXT,
  ceased TEXT,
  PRIMARY KEY (number, officer_id)
);

CREATE TABLE psc (
  number TEXT NOT NULL,
  psc_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT,
  notified TEXT,
  ceased TEXT,
  PRIMARY KEY (number, psc_id)
);

CREATE TABLE company_index (     -- monthly bulk snapshot, for the prospect finder
  number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT,
  incorporated TEXT,
  postcode TEXT,
  district TEXT,
  sic TEXT,
  loaded_month TEXT
);
CREATE INDEX company_index_district ON company_index(district, sic);

-- ---------- Workspace ----------
CREATE TABLE org (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  markup_pct INTEGER NOT NULL DEFAULT 50,
  prospect_districts TEXT NOT NULL DEFAULT '[]',
  prospect_sic TEXT NOT NULL DEFAULT '["69","70","71"]',
  prospect_min_age INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE membership (
  org_id TEXT NOT NULL REFERENCES org(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  role TEXT NOT NULL CHECK (role IN ('owner','manager','viewer')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE magic_link (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE session (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE client (
  org_id TEXT NOT NULL REFERENCES org(id),
  number TEXT NOT NULL,
  display_name TEXT NOT NULL,
  since TEXT,
  users INTEGER,
  monthly_fee REAL,
  next_invoice TEXT,
  watch_on INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL,
  PRIMARY KEY (org_id, number)
);
CREATE INDEX client_number ON client(number);

CREATE TABLE import (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  file_key TEXT NOT NULL,
  status TEXT NOT NULL,          -- queued | matching | needs_confirmation | done | failed
  rows_total INTEGER DEFAULT 0,
  rows_matched INTEGER DEFAULT 0,
  rows_confirm INTEGER DEFAULT 0,
  rows_unmatched INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE import_row (
  import_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  row INTEGER NOT NULL,
  input TEXT NOT NULL,
  extra TEXT,                    -- JSON: since, users, fee, next invoice from optional columns
  candidates TEXT,               -- JSON array
  confidence TEXT,               -- high | confirm | none
  chosen_number TEXT,
  PRIMARY KEY (import_id, row)
);

CREATE TABLE agent_config (
  org_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('watch','check','prospect')),
  on_ INTEGER NOT NULL DEFAULT 1,
  digest TEXT NOT NULL DEFAULT 'weekly',   -- for watch: weekly | daily (critical alerts always go at once)
  coverage TEXT NOT NULL DEFAULT 'all',
  channel_id TEXT,
  PRIMARY KEY (org_id, agent)
);

CREATE TABLE channel (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('email','teams','slack')),
  label TEXT NOT NULL,
  target_enc TEXT NOT NULL,       -- encrypted URL or address
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE alert (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  number TEXT NOT NULL,
  event_id TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'watch',
  check_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Critical','Review')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  facts TEXT NOT NULL,            -- JSON [[label, value, source]]
  next_step TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','reviewed')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  digest_sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, event_id, check_key)
);
CREATE INDEX alert_org_state ON alert(org_id, state, created_at);

CREATE TABLE delivery (
  id TEXT PRIMARY KEY,
  alert_id TEXT,
  org_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- alert | digest | share | test
  attempt INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,           -- pending | sent | failed
  last_error TEXT,
  sent_at TEXT,
  UNIQUE (alert_id, channel_id, kind)
);

CREATE TABLE brief (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  input TEXT NOT NULL,
  number TEXT,
  body TEXT NOT NULL,             -- the signed check response, JSON
  response_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- ---------- Billing ----------
CREATE TABLE subscription (
  org_id TEXT PRIMARY KEY,
  stripe_customer TEXT,
  stripe_subscription TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  founding INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE usage_event (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  key_id TEXT,
  kind TEXT NOT NULL,             -- watch_run | brief | api_call | prospect_build
  number TEXT,
  units INTEGER NOT NULL DEFAULT 1,
  cost_pence INTEGER NOT NULL DEFAULT 0,
  payment TEXT,                   -- x402 | credits | internal | plan
  payment_ref TEXT,
  at TEXT NOT NULL
);
CREATE INDEX usage_org_at ON usage_event(org_id, at);

CREATE TABLE api_key (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  owner_email TEXT,
  org_id TEXT,                    -- set for internal house keys
  kind TEXT NOT NULL CHECK (kind IN ('credits','internal')),
  daily_cap_pence INTEGER NOT NULL DEFAULT 2000,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  delta_pence INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  at TEXT NOT NULL,
  UNIQUE (reason, ref)
);

CREATE TABLE watch_subscription (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  numbers TEXT NOT NULL,          -- JSON array
  webhook TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

-- ---------- Acquisition and operations ----------
CREATE TABLE health_check (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  file_key TEXT NOT NULL,
  status TEXT NOT NULL,           -- queued | running | awaiting_approval | sent | failed
  summary TEXT,                   -- JSON
  report_key TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT
);

CREATE TABLE booking (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL UNIQUE,      -- ISO date-time in UK time
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE TABLE suppression (
  email TEXT PRIMARY KEY,
  reason TEXT,
  at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX audit_org_at ON audit_log(org_id, at);

CREATE TABLE rate_window (
  bucket TEXT PRIMARY KEY,        -- e.g. ch:2026-10-20T07:05
  count INTEGER NOT NULL
);

CREATE TABLE webhook_seen (       -- replay protection for inbound webhooks
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (source, event_id)
);

CREATE TABLE dev_outbox (         -- local development only: every email we would have sent
  id TEXT PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);
