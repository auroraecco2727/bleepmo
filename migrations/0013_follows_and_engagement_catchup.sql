-- 0013_follows_and_engagement_catchup.sql
--
-- Creates the follows and engagement_events tables if they don't already
-- exist on the live D1 database. Both were added to schema.sql well after
-- the DB was first provisioned (confirmed via git history: neither table
-- is present in schema.sql's earliest commit) but — unlike conversations/
-- messages, which got a catch-up migration in 0007 — never got one of
-- their own. Safe to run even if both already exist (CREATE TABLE IF NOT
-- EXISTS is a no-op in that case).
--
-- Why this matters if it's actually missing on production:
--   - follows: the entire follow/followers feature (follow.js) would be
--     silently broken — every request erroring against a table that was
--     never created.
--   - engagement_events: dwell-time/view instrumentation is sent via
--     navigator.sendBeacon on every card view, which swallows errors —
--     so data could be silently going nowhere with zero visible symptom.
--
-- BEFORE running this, check whether it's actually needed:
--   wrangler d1 execute bleepmo-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('follows','engagement_events');"
-- If that returns both table names, this migration is a no-op — safe to
-- run anyway, or safe to skip.
--
-- Run:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0013_follows_and_engagement_catchup.sql

CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  content_type  TEXT,
  content_id    TEXT,
  value_ms      INTEGER,
  metadata      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
CREATE INDEX IF NOT EXISTS idx_engagement_content ON engagement_events(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_engagement_user_time ON engagement_events(user_id, created_at);
