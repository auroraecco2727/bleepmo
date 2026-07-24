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
  google_sub      TEXT UNIQUE,      -- Google's stable per-user id ('sub' claim), set once linked
  apple_sub       TEXT UNIQUE,      -- Apple's stable per-user id ('sub' claim), set once linked
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

CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id)
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

-- ══════════════════════════════════════
-- DIRECT MESSAGES: 1:1 conversations only, no group DMs (yet).
-- user_a_id is always the lexicographically smaller of the two user ids,
-- so a conversation between two users has exactly one row regardless of
-- who started it — that's what UNIQUE(user_a_id, user_b_id) relies on.
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  user_a_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_a_id, user_b_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body              TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  read_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_bleeps_author ON bleeps(author_id);
CREATE INDEX IF NOT EXISTS idx_bleeps_created ON bleeps(created_at);
CREATE INDEX IF NOT EXISTS idx_trend_points_bleep ON trend_points(bleep_id);
CREATE INDEX IF NOT EXISTS idx_trend_points_topic ON trend_points(topic);
CREATE INDEX IF NOT EXISTS idx_likes_bleep ON likes(bleep_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_tags_content ON tags(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_tags_tagged_user ON tags(tagged_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON conversations(user_a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations(user_b_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- ══════════════════════════════════════
-- CALENDAR: public Events (followers see/like/comment) + private Vault
-- (personal saved links/Bleeps with a "key takeaway" note, own-eyes-only).
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS calendar_events (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  event_date    TEXT NOT NULL,   -- 'YYYY-MM-DD'
  event_time    TEXT,            -- optional 'HH:MM'
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
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- private, own-eyes-only
  entry_date           TEXT NOT NULL,   -- 'YYYY-MM-DD'
  reference_type       TEXT NOT NULL,   -- 'link' | 'bleep'
  reference_url        TEXT,
  referenced_bleep_id  TEXT REFERENCES bleeps(id) ON DELETE SET NULL,
  key_takeaway         TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_author ON calendar_events(author_id, event_date);
CREATE INDEX IF NOT EXISTS idx_vault_entries_user_date ON vault_entries(user_id, entry_date);
