-- UUID text primary keys (not incremental) so ids aren't enumerable/IDOR-prone.
-- Ids are generated in the app layer with crypto.randomUUID().

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT DEFAULT '',
  industry TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  title TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'lead',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  value REAL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'prospect',
  close_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Activity timeline: one row per interaction logged against a contact, company,
-- or deal. The substrate every integration writes into (email sent, meeting
-- scheduled, Slack notification) plus manual notes.
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,               -- 'contact' | 'company' | 'deal'
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',        -- 'note' | 'email' | 'meeting' | 'slack' | 'stage_change'
  body TEXT DEFAULT '',
  meta TEXT DEFAULT '',                     -- JSON: subject, recipient, event link, channel, etc.
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
