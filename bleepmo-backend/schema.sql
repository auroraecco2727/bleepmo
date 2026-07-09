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
