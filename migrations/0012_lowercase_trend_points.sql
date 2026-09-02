-- 0012_lowercase_trend_points.sql
--
-- Backfill: normalize existing trend_points.topic values to lowercase.
--
-- Bleeps created before the bug fix in src/routes/bleeps.js (and the
-- matching composer fix in public/index.html) may have mixed-case topics
-- (e.g. "Sustainable Tech"), which silently broke case-sensitive matching
-- in two places downstream:
--   - the /api/bleeps/similar query (trendpoint overlap matching)
--   - the notification bell's "commerce" category classifier
--     (getRecommendedMerchForTopics in src/routes/store.js)
--
-- New posts are lowercased at write time as of that fix. This migration
-- catches everything written before it. users.subscribed_trend_points is
-- NOT touched here — it's already always written lowercase
-- (src/routes/update-profile.js), so it was never affected.
--
-- RUN THE DRY-RUN SELECTS BELOW FIRST, AGAINST PRODUCTION, BEFORE RUNNING
-- THE UPDATE. See the handoff notes for the wrangler commands.

-- ── Dry run #1: preview which rows would change ──
-- SELECT id, bleep_id, topic, LOWER(topic) AS would_become
-- FROM trend_points
-- WHERE topic != LOWER(topic);

-- ── Dry run #2: check for same-bleep collisions the UPDATE can't resolve
--    on its own (e.g. a post that already has both "Gaming" and "gaming"
--    as two separate trend_points rows pre-fix) ──
-- SELECT bleep_id, LOWER(topic) AS topic_lower, COUNT(*) AS n
-- FROM trend_points
-- GROUP BY bleep_id, LOWER(topic)
-- HAVING COUNT(*) > 1;

-- If dry run #2 returns any rows, resolve those collisions first (decide
-- together which duplicate row to drop per bleep_id/topic_lower pair) —
-- otherwise this plain UPDATE will just leave silent duplicate rows
-- (harmless for matching, since it's used as a Set, but worth knowing
-- about and cleaning up rather than leaving it).

UPDATE trend_points
SET topic = LOWER(topic)
WHERE topic != LOWER(topic);
