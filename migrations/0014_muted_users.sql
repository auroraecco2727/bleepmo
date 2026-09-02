-- 0014_muted_users.sql
--
-- A soft, one-directional, silent content preference — NOT the same
-- thing as a block (see blocks table, once it exists). Muting someone
-- only affects what shows up in the muter's own passive feeds (main
-- feed, Flicks panes, trend-browsing, similar-posts). It does not:
--   - notify the muted person in any way
--   - stop them from following, messaging, or commenting on the muter
--   - hide the muter's content from the muted person
--   - hide the muted person's content if the muter visits their profile
--     directly (muting is about what surfaces passively, not a full
--     removal from view)
--
-- Run:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0014_muted_users.sql

CREATE TABLE IF NOT EXISTS muted_users (
  muter_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (muter_id, muted_id)
);

CREATE INDEX IF NOT EXISTS idx_muted_users_muter ON muted_users(muter_id);
