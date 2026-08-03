-- Run ONCE against your live database:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0005_admin_settings.sql

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- After running this, grant yourself admin access once:
--   wrangler d1 execute bleepmo-db --remote --command="UPDATE users SET is_admin = 1 WHERE handle = 'yourhandle'"
