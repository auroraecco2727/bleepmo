-- Bleepmo D1 schema
-- Run with: wrangler d1 execute bleepmo-db --file=./schema.sql   (add --remote for production)

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  handle_symbol   TEXT NOT NULL DEFAULT '@',
  handle          TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  avatar_shape    TEXT NOT NULL DEFAULT 'circle',
  main_pic_key    TEXT,             -- R2 object key for the main profile picture
  icon_pic_key    TEXT,             -- R2 object key for the smaller icon-profile picture
  voice_clip_key  TEXT,             -- R2 object key for the 15s genuine-voice clip
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ══════════════════════════════════════
-- CONTENT: bleeps, comments, tags, notifications
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS bleeps (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type  TEXT NOT NULL DEFAULT 'bleep',   -- 'bleep' | 'flick_short' | 'flick_long'
  body          TEXT,                             -- caption / text (nullable for media-only posts)
  title         TEXT,                             -- optional bold headline for "beautiful post" formatting
  media_key     TEXT,                             -- R2 object key for photo/video, nullable for text-only Bleeps
  is_breaking   INTEGER NOT NULL DEFAULT 0,       -- stylized "BREAKING" badge, set via a checkbox at compose time
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT                               -- soft delete
);

CREATE TABLE IF NOT EXISTS trend_points (
  id          TEXT PRIMARY KEY,
  bleep_id    TEXT NOT NULL REFERENCES bleeps(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,                       -- e.g. "Sustainable Tech" — rendered with a bullet, not a #
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS likes (
  bleep_id    TEXT NOT NULL REFERENCES bleeps(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bleep_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id                  TEXT PRIMARY KEY,
  content_type        TEXT NOT NULL DEFAULT 'bleep',  -- 'bleep' | 'flick'
  content_id          TEXT NOT NULL,                   -- references bleeps.id (no FK: keeps this table content-type agnostic)
  author_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id   TEXT REFERENCES comments(id) ON DELETE CASCADE,  -- nullable, enables threaded replies
  body                TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at           TEXT,
  hidden_at           TEXT,                             -- soft-moderation, not hard delete
  hidden_reason       TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id                  TEXT PRIMARY KEY,
  content_type        TEXT NOT NULL,        -- 'bleep' | 'comment'
  content_id          TEXT NOT NULL,
  tagged_user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tagged_by_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol_used         TEXT,                  -- whichever of @ * ~ ^ > & was actually typed
  position_type       TEXT NOT NULL DEFAULT 'inline',  -- 'inline' | 'timestamp' | 'coordinate'
  position_data       TEXT,                  -- JSON string, e.g. {"t":4.2} or {"x":0.3,"y":0.6}
  approved            INTEGER NOT NULL DEFAULT 0,  -- tag only becomes visible once the tagged user approves it
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who receives it
  type          TEXT NOT NULL,                -- 'tag' | 'comment' | 'reply'
  actor_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who caused it
  source_type   TEXT,                         -- 'bleep' | 'comment'
  source_id     TEXT,
  read_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bleeps_author ON bleeps(author_id);
CREATE INDEX IF NOT EXISTS idx_bleeps_created ON bleeps(created_at);
CREATE INDEX IF NOT EXISTS idx_trend_points_bleep ON trend_points(bleep_id);
CREATE INDEX IF NOT EXISTS idx_trend_points_topic ON trend_points(topic);
CREATE INDEX IF NOT EXISTS idx_likes_bleep ON likes(bleep_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_tags_content ON tags(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_tags_tagged_user ON tags(tagged_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
