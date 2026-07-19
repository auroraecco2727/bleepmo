-- Run ONCE against your live database (schema.sql's CREATE TABLE IF NOT
-- EXISTS won't touch a table that already exists, so this has to run
-- separately):
--
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0001_oauth_columns.sql
--
-- If you ever spin up a brand-new database from schema.sql alone, you do
-- NOT need this file — schema.sql already includes these columns.

ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN apple_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_sub ON users(apple_sub);
