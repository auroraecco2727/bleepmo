-- Onboarding 3-step flow data capture (Step 1: location anchor,
-- Step 2: subscribed trendpoints, Step 3: theme glow intensity).
-- No UI depends on these existing yet except the new onboarding modal —
-- safe to run any time.

ALTER TABLE users ADD COLUMN location_anchor TEXT;

-- JSON array of lowercase trendpoint strings, e.g. ["indie-tech","gaming"].
-- This is also the exact format the feed-scoring formula (bleeps.js,
-- scoreBleep()) already expects when reading this column.
ALTER TABLE users ADD COLUMN subscribed_trend_points TEXT;

-- 'low' | 'medium' | 'high' — controls accent-glow intensity in the UI.
ALTER TABLE users ADD COLUMN theme_glow_intensity TEXT DEFAULT 'medium';

-- Marks whether the person has been through onboarding at all, so we
-- know whether to show the modal after signup vs. skip it for existing
-- users who signed up before this existed.
ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT;
