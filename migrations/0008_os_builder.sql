-- The OS Builder: each business builds its own OS from the app library. With no org_os row, a business keeps
-- the earlier behaviour (every app available), so nothing changes for workspaces that haven't built one.

CREATE TABLE IF NOT EXISTS org_os (
  org_id TEXT PRIMARY KEY,
  pack TEXT NOT NULL DEFAULT 'blank',
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','calm','terminal','light')),
  version INTEGER NOT NULL DEFAULT 1,
  ai_paused INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- One row per app placed in the OS. features is the list of feature keys switched on; provider is who does an outsourced app.
CREATE TABLE IF NOT EXISTS org_module (
  org_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('here','outsourced','external','off')),
  features TEXT NOT NULL DEFAULT '[]',
  autonomy TEXT NOT NULL DEFAULT 'approve' CHECK (autonomy IN ('suggest','approve','auto')),
  provider TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, module_key)
);

-- Studio: fields a business adds to any app, and apps it designs itself.
CREATE TABLE IF NOT EXISTS custom_field (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  module TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','date','money','long','url','number','choice')),
  options TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_key ON custom_field(org_id, module, key);

CREATE TABLE IF NOT EXISTS custom_app (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  statuses TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_app_key ON custom_app(org_id, key);

-- Every save of the OS, so a change can be seen and undone.
CREATE TABLE IF NOT EXISTS os_change (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  by_user TEXT,
  summary TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS os_change_org ON os_change(org_id, version);

-- The home screen: widgets on the canvas and apps in the dock, per space (desktop or phone).
CREATE TABLE IF NOT EXISTS org_layout (
  org_id TEXT NOT NULL,
  space TEXT NOT NULL CHECK (space IN ('desktop','phone')),
  widgets TEXT NOT NULL DEFAULT '[]',
  dock TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, space)
);
