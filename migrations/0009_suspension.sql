-- Admin account-suspension support. Deleting an account doesn't need a
-- migration — it's just DELETE FROM users, and the existing ON DELETE
-- CASCADE constraints throughout schema.sql clean up everything else
-- (bleeps, follows, likes, comments, conversations, sessions, etc.).
-- Suspension needs a real column since it's a reversible, non-destructive
-- state rather than a deletion.

ALTER TABLE users ADD COLUMN suspended_at TEXT;
