-- Optional "this post relates to that post" link, set at compose time via
-- the new guided-post-wizard's "Similar posts" step. Nullable — most posts
-- won't have one. ON DELETE SET NULL rather than CASCADE: if the linked
-- post gets deleted later, this post should keep existing, just lose the
-- reference rather than being deleted along with it.
--
-- Run ONCE against your live database:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0011_bleep_linking.sql

ALTER TABLE bleeps ADD COLUMN linked_bleep_id TEXT REFERENCES bleeps(id) ON DELETE SET NULL;
