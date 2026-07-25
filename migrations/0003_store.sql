-- Run ONCE against your live database:
--   wrangler d1 execute bleepmo-db --remote --file=./migrations/0003_store.sql

ALTER TABLE users ADD COLUMN has_store INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS store_items (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  price_cents   INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'usd',
  image_key     TEXT,
  tags          TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  buyer_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_item_id     TEXT NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  price_cents       INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'usd',
  status            TEXT NOT NULL DEFAULT 'demo_placeholder',
  stripe_session_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tips (
  id                TEXT PRIMARY KEY,
  sender_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'usd',
  message           TEXT,
  source_type       TEXT,
  source_id         TEXT,
  status            TEXT NOT NULL DEFAULT 'demo_placeholder',
  stripe_session_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_store_items_category ON store_items(category, is_active);
CREATE INDEX IF NOT EXISTS idx_store_items_owner ON store_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_tips_recipient ON tips(recipient_id);
