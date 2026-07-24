-- Run ONCE against your live database:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0002_calendar.sql

CREATE TABLE IF NOT EXISTS calendar_events (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  event_date    TEXT NOT NULL,
  event_time    TEXT,
  location      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS event_likes (
  event_id    TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS vault_entries (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date           TEXT NOT NULL,
  reference_type       TEXT NOT NULL,
  reference_url        TEXT,
  referenced_bleep_id  TEXT REFERENCES bleeps(id) ON DELETE SET NULL,
  key_takeaway         TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_author ON calendar_events(author_id, event_date);
CREATE INDEX IF NOT EXISTS idx_vault_entries_user_date ON vault_entries(user_id, entry_date);
