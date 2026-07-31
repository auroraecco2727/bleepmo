-- Creates the conversations/messages tables if they don't already exist
-- on the live D1 database. These were added to schema.sql after the DB
-- was first provisioned, so the live DB may be missing them entirely —
-- this migration is the fix. Safe to run even if they already exist.

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

CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON conversations(user_a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON conversations(user_b_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
