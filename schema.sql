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
  has_store       INTEGER NOT NULL DEFAULT 0,  -- manually flipped for now; gates the profile "Showcase" storefront tab
  is_admin        INTEGER NOT NULL DEFAULT 0,  -- manually flipped; gates admin-only settings (e.g. AI provider config)
  location_anchor TEXT,             -- onboarding Step 1: metro slug, e.g. "los-angeles"
  subscribed_trend_points TEXT,     -- onboarding Step 2: JSON array of lowercase trendpoint strings
  theme_glow_intensity TEXT DEFAULT 'medium',  -- onboarding Step 3: 'low' | 'medium' | 'high'
  onboarding_completed_at TEXT,     -- set once the 3-step modal is finished; null skips it for pre-existing users
  suspended_at    TEXT,             -- set by an admin; blocks login while non-null, reversible
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
  linked_bleep_id TEXT REFERENCES bleeps(id) ON DELETE SET NULL,  -- optional "related to" set via the guided-post wizard
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT                               -- soft delete
);

CREATE TABLE IF NOT EXISTS trend_points (
  id          TEXT PRIMARY KEY,
  bleep_id    TEXT NOT NULL REFERENCES bleeps(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,                       -- lowercase, e.g. "sustainable-tech" — rendered with a bullet, not a #
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

-- ══════════════════════════════════════
-- E-STORE: store_items (platform upgrades, creator merch, Bleepmo gear),
-- orders (checkout — placeholder/demo status until real Stripe is wired),
-- tips (fan-to-creator micro-tips — same placeholder status for now).
-- ══════════════════════════════════════

CREATE TABLE IF NOT EXISTS store_items (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT REFERENCES users(id) ON DELETE CASCADE, -- NULL = Bleepmo platform item; set = creator's own merch
  category      TEXT NOT NULL,   -- 'platform_upgrade' | 'creator_merch' | 'bleepmo_gear'
  title         TEXT NOT NULL,
  description   TEXT,
  price_cents   INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'usd',
  image_key     TEXT,            -- R2 object key
  tags          TEXT,            -- comma-separated topic keywords for contextual matching, e.g. "gaming,pc-building"
  is_active     INTEGER NOT NULL DEFAULT 1,
  grants_store_access INTEGER NOT NULL DEFAULT 0, -- buying this item flips the buyer's has_store to 1 (e.g. "Storefront Unlock")
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  buyer_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_item_id     TEXT NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  price_cents       INTEGER NOT NULL,   -- snapshot of price at purchase time
  currency          TEXT NOT NULL DEFAULT 'usd',
  status            TEXT NOT NULL DEFAULT 'demo_placeholder', -- 'demo_placeholder' until Stripe is connected; later: 'paid' | 'failed' | 'refunded'
  stripe_session_id TEXT,               -- populated once real Stripe Checkout is wired
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tips (
  id                TEXT PRIMARY KEY,
  sender_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'usd',
  message           TEXT,
  source_type       TEXT,               -- 'profile' | 'flick' | 'bleep', optional context
  source_id         TEXT,
  status            TEXT NOT NULL DEFAULT 'demo_placeholder',
  stripe_session_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_store_items_category ON store_items(category, is_active);
CREATE INDEX IF NOT EXISTS idx_store_items_owner ON store_items(owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_tips_recipient ON tips(recipient_id);

-- ══════════════════════════════════════
-- ENGAGEMENT EVENTS: generic, extensible instrumentation groundwork for
-- future recommendation/ad-optimization work. Deliberately NOT an ad engine
-- — just making sure passive signals (dwell time, scroll stops, hover) aren't
-- thrown away if/when they matter later. New signal types plug into this
-- same table via event_type + metadata; no schema changes needed per signal.
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS engagement_events (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,    -- 'card_dwell' | 'card_view' | 'scroll_stop' | 'hover' | ... (open-ended)
  content_type  TEXT,             -- 'bleep' | 'flick_short' | 'flick_long' | 'store_item' | ...
  content_id    TEXT,
  value_ms      INTEGER,          -- duration in ms, when the event represents a span of time
  metadata      TEXT,             -- optional JSON blob for anything event-specific (scroll %, position, etc.)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_engagement_content ON engagement_events(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_engagement_user_time ON engagement_events(user_id, created_at);

-- ══════════════════════════════════════
-- App-wide settings (key/value). First use: which AI provider(s) handle
-- AI Assist and future AI features, changeable from Settings without a
-- redeploy — a natural home for future runtime-toggleable config too.
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ══════════════════════════════════════
-- Password reset tokens (see migrations/0010_password_reset.sql). Tokens
-- are stored hashed, not raw, and expire ~30 min after issue.
-- ══════════════════════════════════════
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);
