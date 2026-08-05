-- Password reset tokens. Tokens are stored as a SHA-256 hash (not the raw
-- token) so a leaked/stolen DB row can't be replayed directly — same spirit
-- as password_hash, just SHA-256 instead of PBKDF2 since these are already
-- high-entropy random values with a short TTL, not human-chosen passwords.
--
-- Run ONCE against your live database:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0010_password_reset.sql

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);
