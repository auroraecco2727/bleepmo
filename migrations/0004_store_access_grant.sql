-- Run ONCE against your live database:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0004_store_access_grant.sql

ALTER TABLE store_items ADD COLUMN grants_store_access INTEGER NOT NULL DEFAULT 0;
