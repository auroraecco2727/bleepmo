// src/routes/bleeps.js
// GET  /api/bleeps  -> paginated feed, newest first
// POST /api/bleeps  -> create a new Bleep (caption + optional media)

import { getSessionUser, newId } from '../shared/auth.js';
import { getRecommendedMerchForTopics } from './store.js';
import { applyMentions } from '../shared/mentions.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_MEDIA_BYTES = 60 * 1024 * 1024;
const PAGE_SIZE = 20;

// ────────────────────────────────────────────────────────────
// Weighted feed-recommendation formula (per the onboarding/color-card
// spec): Feed Score = W_local*S_location + W_interest*S_trend_match +
// W_recency*T + W_engagement*E
//
// S_location and S_trend_match need user.location_anchor /
// user.subscribed_trend_points, which don't exist in the schema yet
// (that's the pending onboarding flow). Until then this code just reads
// undefined off the viewer object and those two terms contribute 0 —
// nothing breaks, and the moment those columns exist this scores for
// real with zero further changes here.
//
// Assumed storage format for when that column lands:
// users.subscribed_trend_points = JSON array of lowercase topic strings.
//
// Weights below are a reasonable starting point, not derived from any
// real usage data (there isn't any yet) — expect to retune once you can
// see how it behaves on a real feed.
const W_LOCAL = 3;
const W_INTEREST = 2;
const W_RECENCY = 1.5;
const W_ENGAGEMENT = 1;
const RECENCY_HALFLIFE_HOURS = 36;
const CANDIDATE_POOL_SIZE = 150; // how many recent posts we score against, before keeping the top PAGE_SIZE

function scoreBleep(b, viewer) {
  var ageHours = Math.max((Date.now() - new Date(b.created_at).getTime()) / 36e5, 0);
  var recency = Math.exp(-ageHours / RECENCY_HALFLIFE_HOURS);
  var engagement = Math.log(1 + (b.like_count || 0) + (b.comment_count || 0) * 2);

  var locationMatch = 0;
  if (viewer.location_anchor) {
    var locSlug = String(viewer.location_anchor).toLowerCase();
    locationMatch = (b.trend_points || []).some(function (t) { return String(t).toLowerCase() === locSlug; }) ? 1 : 0;
  }

  var trendMatchCount = 0;
  if (viewer.subscribed_trend_points) {
    var subscribed;
    try { subscribed = JSON.parse(viewer.subscribed_trend_points); } catch (e) { subscribed = []; }
    if (Array.isArray(subscribed) && subscribed.length) {
      var subscribedSet = new Set(subscribed.map(function (t) { return String(t).toLowerCase(); }));
      trendMatchCount = (b.trend_points || []).reduce(function (n, t) {
        return n + (subscribedSet.has(String(t).toLowerCase()) ? 1 : 0);
      }, 0);
    }
  }

  return (
    W_LOCAL * locationMatch +
    W_INTEREST * trendMatchCount +
    W_RECENCY * recency +
    W_ENGAGEMENT * engagement
  );
}

export async function handleBleepsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const authorFilter = url.searchParams.get('author');
  const contentTypeFilter = url.searchParams.get('contentType');
  const trendFilter = url.searchParams.get('trend');

  // The plain, unfiltered "For You" home-feed request (loadLiveFeed() on
  // the client) — the only request this scoring applies to. Any filtered
  // view (a profile's posts, a Flicks pane, a trend-filtered list) stays
  // exactly as it was: plain reverse-chronological, since ranking those
  // by "recommendation score" wouldn't make sense for what they're for.
  const isPersonalizedFeed = !authorFilter && !contentTypeFilter && !trendFilter && !cursor;
  const candidateLimit = isPersonalizedFeed ? CANDIDATE_POOL_SIZE : PAGE_SIZE;

  let query = `
    SELECT
      b.id, b.author_id, b.content_type, b.title, b.body, b.media_key, b.is_breaking, b.linked_bleep_id, b.created_at,
      u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key,
      (SELECT COUNT(*) FROM comments c WHERE c.content_type = 'bleep' AND c.content_id = b.id AND c.hidden_at IS NULL) AS comment_count
    FROM bleeps b
    JOIN users u ON u.id = b.author_id
    WHERE b.deleted_at IS NULL
  `;
  const binds = [];
  if (authorFilter) {
    query += ' AND b.author_id = ?';
    binds.push(authorFilter);
  } else {
    // Muting only affects passive/browsing surfaces (this branch) — a
    // deliberate visit to a muted person's own profile (authorFilter set)
    // still shows their content. See migrations/0014_muted_users.sql.
    query += ' AND b.author_id NOT IN (SELECT muted_id FROM muted_users WHERE muter_id = ?)';
    binds.push(viewer.id);
  }
  if (contentTypeFilter) {
    query += ' AND b.content_type = ?';
    binds.push(contentTypeFilter);
  }
  if (trendFilter) {
    query += ' AND b.id IN (SELECT bleep_id FROM trend_points WHERE topic = ? COLLATE NOCASE)';
    binds.push(trendFilter);
  }
  if (cursor) {
    query += ' AND b.created_at < ?';
    binds.push(cursor);
  }
  query += ' ORDER BY b.created_at DESC LIMIT ?';
  binds.push(candidateLimit);

  let { results } = await env.DB.prepare(query).bind(...binds).all();

  // Trend-linked swipe (Bleep -> Flick -> Long-Flick) asked for a specific
  // topic and came up empty — rather than a dead end, fall back to
  // Bleepmo's general pick for that content type (first page only; a
  // paginated cursor request just returns what it returns).
  let usedTrendFallback = false;
  if (trendFilter && results.length === 0 && !cursor) {
    let fallbackQuery = `
      SELECT
        b.id, b.author_id, b.content_type, b.title, b.body, b.media_key, b.is_breaking, b.linked_bleep_id, b.created_at,
        u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key,
        (SELECT COUNT(*) FROM comments c WHERE c.content_type = 'bleep' AND c.content_id = b.id AND c.hidden_at IS NULL) AS comment_count
      FROM bleeps b
      JOIN users u ON u.id = b.author_id
      WHERE b.deleted_at IS NULL
        AND b.author_id NOT IN (SELECT muted_id FROM muted_users WHERE muter_id = ?)
    `;
    const fallbackBinds = [viewer.id];
    if (contentTypeFilter) {
      fallbackQuery += ' AND b.content_type = ?';
      fallbackBinds.push(contentTypeFilter);
    }
    fallbackQuery += ' ORDER BY b.created_at DESC LIMIT ?';
    fallbackBinds.push(PAGE_SIZE);
    const fallback = await env.DB.prepare(fallbackQuery).bind(...fallbackBinds).all();
    results = fallback.results;
    usedTrendFallback = results.length > 0;
  }

  // Attach trend-points and tagged users to each Bleep in two extra
  // queries rather than N+1.
  if (results.length > 0) {
    const ids = results.map((b) => b.id);
    const placeholders = ids.map(() => '?').join(',');

    const { results: allTrendPoints } = await env.DB
      .prepare(`SELECT bleep_id, topic FROM trend_points WHERE bleep_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(...ids)
      .all();
    const trendByBleepId = {};
    for (const tp of allTrendPoints) {
      (trendByBleepId[tp.bleep_id] = trendByBleepId[tp.bleep_id] || []).push(tp.topic);
    }

    const { results: allTags } = await env.DB
      .prepare(
        `SELECT t.content_id AS bleep_id, u.handle_symbol, u.handle
         FROM tags t JOIN users u ON u.id = t.tagged_user_id
         WHERE t.content_type = 'bleep' AND t.content_id IN (${placeholders})
         ORDER BY t.created_at ASC`
      )
      .bind(...ids)
      .all();
    const tagsByBleepId = {};
    for (const t of allTags) {
      (tagsByBleepId[t.bleep_id] = tagsByBleepId[t.bleep_id] || []).push(t.handle_symbol + t.handle);
    }

    const { results: allLikes } = await env.DB
      .prepare(`SELECT bleep_id, user_id FROM likes WHERE bleep_id IN (${placeholders})`)
      .bind(...ids)
      .all();
    const likeCountByBleepId = {};
    const likedByViewerSet = new Set();
    for (const l of allLikes) {
      likeCountByBleepId[l.bleep_id] = (likeCountByBleepId[l.bleep_id] || 0) + 1;
      if (l.user_id === viewer.id) likedByViewerSet.add(l.bleep_id);
    }

    // Which of these authors does the viewer already follow? One query
    // against the distinct author_ids on this page, rather than N+1.
    const authorIds = [...new Set(results.map((b) => b.author_id))];
    const authorPlaceholders = authorIds.map(() => '?').join(',');
    const { results: allFollows } = await env.DB
      .prepare(
        `SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN (${authorPlaceholders})`
      )
      .bind(viewer.id, ...authorIds)
      .all();
    const followedAuthorSet = new Set(allFollows.map((f) => f.followee_id));

    // Contextual Merch: one batched query for every trend topic on this
    // page, rather than a query per post.
    const allTopicsOnPage = results.flatMap((b) => trendByBleepId[b.id] || []);
    const merchByTopic = await getRecommendedMerchForTopics(env.DB, allTopicsOnPage);

    // Linked-post preview — batched the same way as everything above.
    // Deliberately a lightweight preview (title/body snippet + author),
    // not a full second bleep object, since it's only ever rendered as a
    // small "Related to" line on the card.
    const linkedIds = [...new Set(results.map((b) => b.linked_bleep_id).filter(Boolean))];
    let linkedPreviewById = {};
    if (linkedIds.length > 0) {
      const linkedPlaceholders = linkedIds.map(() => '?').join(',');
      const { results: linkedRows } = await env.DB
        .prepare(
          `SELECT lb.id, lb.title, lb.body, lu.handle_symbol, lu.handle
           FROM bleeps lb JOIN users lu ON lu.id = lb.author_id
           WHERE lb.id IN (${linkedPlaceholders}) AND lb.deleted_at IS NULL`
        )
        .bind(...linkedIds)
        .all();
      linkedPreviewById = Object.fromEntries(linkedRows.map((r) => [r.id, r]));
    }

    for (const b of results) {
      b.trend_points = trendByBleepId[b.id] || [];
      b.tagged_handles = tagsByBleepId[b.id] || [];
      b.like_count = likeCountByBleepId[b.id] || 0;
      b.liked_by_viewer = likedByViewerSet.has(b.id);
      b.followed_by_viewer = b.author_id !== viewer.id && followedAuthorSet.has(b.author_id);
      b.recommended_merch = null;
      for (const topic of b.trend_points) {
        if (merchByTopic.has(topic)) { b.recommended_merch = merchByTopic.get(topic); break; }
      }
      // linked_bleep_id can point at a since-deleted post — falls back to
      // null rather than showing a broken/dangling reference.
      b.linked_bleep_preview = b.linked_bleep_id ? (linkedPreviewById[b.linked_bleep_id] || null) : null;
    }
  }

  if (isPersonalizedFeed) {
    for (const b of results) {
      b.feed_score = Math.round(scoreBleep(b, viewer) * 1000) / 1000;
    }
    results.sort((a, b) => {
      if (b.feed_score !== a.feed_score) return b.feed_score - a.feed_score;
      return new Date(b.created_at) - new Date(a.created_at); // tiebreak: newest first
    });
    results = results.slice(0, PAGE_SIZE);
  }

  // Scored order isn't a valid "load more before this timestamp" cursor,
  // so the personalized feed only supports its first (scored) page for
  // now — which matches current reality: the client doesn't request a
  // second page of the "For You" feed yet. Every other view (profile,
  // Flicks, trend-filtered) keeps real cursor pagination unchanged.
  const nextCursor = isPersonalizedFeed
    ? null
    : (results.length === PAGE_SIZE ? results[results.length - 1].created_at : null);

  return new Response(JSON.stringify({ bleeps: results, nextCursor, usedTrendFallback }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBleepsPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  if (!env.MEDIA) return badRequest('MEDIA (R2) binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest('Expected multipart/form-data.');
  }

  const body = (form.get('body') || '').toString().trim();
  const title = (form.get('title') || '').toString().trim().slice(0, 120) || null;
  const media = form.get('media');
  const isBreaking = (form.get('isBreaking') || '').toString() === 'true' ? 1 : 0;
  const postAsFlick = (form.get('postAsFlick') || '').toString() === 'true';
  const flickLength = (form.get('flickLength') || 'short').toString() === 'long' ? 'long' : 'short';

  // Optional "relate this to an existing post" from the Similar Posts
  // step of the compose wizard. Validated against the real table rather
  // than trusted blindly — a stale/tampered id just silently gets
  // dropped instead of failing the whole post.
  let linkedBleepId = null;
  const linkedBleepIdRaw = (form.get('linkedBleepId') || '').toString().trim();
  if (linkedBleepIdRaw) {
    const targetExists = await env.DB
      .prepare('SELECT id FROM bleeps WHERE id = ? AND deleted_at IS NULL')
      .bind(linkedBleepIdRaw)
      .first();
    if (targetExists) linkedBleepId = linkedBleepIdRaw;
  }

  // trendPoints arrives as a JSON array string, e.g. '["Sustainable Tech","Urban Design"]'
  // Normalized to lowercase on the way in — every other place in the app
  // that reads trend-points (subscribed_trend_points, location_anchor
  // matching, the merch-recommendation map, notification categorization)
  // already assumes lowercase, per the convention documented in
  // migrations/0008_onboarding.sql. Bleep-authored trend-points were the
  // one place that never actually enforced it, which silently broke
  // case-sensitive lookups downstream (commerce notification category,
  // similar-posts matching) any time someone typed "Gaming" instead of
  // "gaming". Fixed here instead of trusting every reader to lowercase.
  let trendPoints = [];
  const trendPointsRaw = form.get('trendPoints');
  if (trendPointsRaw) {
    try {
      const parsed = JSON.parse(trendPointsRaw.toString());
      if (Array.isArray(parsed)) {
        trendPoints = [...new Set(
          parsed
            .map((t) => t.toString().trim().toLowerCase())
            .filter((t) => t.length > 0 && t.length <= 40)
        )].slice(0, 8); // sane cap so nobody turns a caption into 200 tags
      }
    } catch {
      // malformed JSON — just skip trend-points rather than failing the whole post
    }
  }

  // taggedHandles arrives as a JSON array of bare handles (no symbol), e.g.
  // '["QuantumCity","darvenHaze"]' — explicit tags from the compose UI,
  // separate from any @/*/~/^/>/& mentions typed directly into the body.
  let taggedHandles = [];
  const taggedHandlesRaw = form.get('taggedHandles');
  if (taggedHandlesRaw) {
    try {
      const parsed = JSON.parse(taggedHandlesRaw.toString());
      if (Array.isArray(parsed)) {
        taggedHandles = parsed
          .map((h) => h.toString().trim().replace(/^[@*~^>&]/, ''))
          .filter((h) => h.length > 0)
          .slice(0, 10);
      }
    } catch {
      // malformed JSON — skip explicit tags rather than failing the whole post
    }
  }

  const hasMedia = media && typeof media === 'object' && media.size > 0;
  if (!body && !hasMedia) {
    return badRequest('A Bleep needs either a caption or media.');
  }

  const isVideo = hasMedia && (media.type || '').startsWith('video/');
  const contentType = postAsFlick && isVideo ? (flickLength === 'long' ? 'flick_long' : 'flick_short') : 'bleep';

  const bleepId = newId();
  let mediaKey = null;

  if (hasMedia) {
    if (media.size > MAX_MEDIA_BYTES) return badRequest('Media file is too large (max 60MB).');
    mediaKey = `bleeps/${bleepId}/media-${Date.now()}`;
    const buf = await media.arrayBuffer();
    await env.MEDIA.put(mediaKey, buf, {
      httpMetadata: { contentType: media.type || 'application/octet-stream' },
    });
  }

  await env.DB
    .prepare(
      `INSERT INTO bleeps (id, author_id, content_type, title, body, media_key, is_breaking, linked_bleep_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(bleepId, user.id, contentType, title, body || null, mediaKey, isBreaking, linkedBleepId)
    .run();

  for (const topic of trendPoints) {
    await env.DB
      .prepare(`INSERT INTO trend_points (id, bleep_id, topic) VALUES (?, ?, ?)`)
      .bind(newId(), bleepId, topic)
      .run();
  }

  // Combine body-text mentions and explicit compose-time tags into a single
  // pass so the same handle mentioned both ways doesn't get double-tagged
  // or double-notified — applyMentions already dedupes within one text blob.
  const combinedTagText = body + ' ' + taggedHandles.map((h) => '@' + h).join(' ');
  await applyMentions(env.DB, {
    text: combinedTagText,
    contentType: 'bleep',
    contentId: bleepId,
    taggerUserId: user.id,
  });

  const { results: resolvedTags } = await env.DB
    .prepare(
      `SELECT u.handle_symbol, u.handle
       FROM tags t JOIN users u ON u.id = t.tagged_user_id
       WHERE t.content_type = 'bleep' AND t.content_id = ?
       ORDER BY t.created_at ASC`
    )
    .bind(bleepId)
    .all();

  const bleep = await env.DB
    .prepare(
      `SELECT b.id, b.author_id, b.content_type, b.title, b.body, b.media_key, b.is_breaking, b.linked_bleep_id, b.created_at,
              u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM bleeps b JOIN users u ON u.id = b.author_id WHERE b.id = ?`
    )
    .bind(bleepId)
    .first();
  bleep.trend_points = trendPoints;
  bleep.like_count = 0;
  bleep.liked_by_viewer = false;
  bleep.tagged_handles = resolvedTags.map((t) => t.handle_symbol + t.handle);
  bleep.linked_bleep_preview = null;
  if (linkedBleepId) {
    bleep.linked_bleep_preview = await env.DB
      .prepare(
        `SELECT lb.id, lb.title, lb.body, lu.handle_symbol, lu.handle
         FROM bleeps lb JOIN users lu ON lu.id = lb.author_id WHERE lb.id = ?`
      )
      .bind(linkedBleepId)
      .first();
  }

  return new Response(JSON.stringify({ bleep, tagsApplied: resolvedTags.length }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/bleeps/similar?trendPoints=indie-tech,gaming -> up to 5 existing
// posts sharing at least one of those topics, ranked by how many they
// share (then recency). Backs the compose wizard's "Similar posts" step —
// no AI involved, just the same trend-point overlap idea the feed-scoring
// formula already uses, applied the other direction (find posts matching
// a draft, instead of scoring posts for a viewer).
const SIMILAR_RESULTS_LIMIT = 5;

export async function handleBleepsSimilar(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const url = new URL(request.url);
  const raw = (url.searchParams.get('trendPoints') || '').trim();
  const topics = raw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);

  if (!topics.length) {
    return new Response(JSON.stringify({ bleeps: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const placeholders = topics.map(() => '?').join(',');
  const { results } = await env.DB
    .prepare(
      `SELECT b.id, b.title, b.body, b.content_type, b.created_at,
              u.full_name, u.handle_symbol, u.handle,
              COUNT(DISTINCT tp.topic) AS overlap_count
       FROM bleeps b
       JOIN users u ON u.id = b.author_id
       JOIN trend_points tp ON tp.bleep_id = b.id AND tp.topic COLLATE NOCASE IN (${placeholders})
       WHERE b.deleted_at IS NULL
         AND b.author_id NOT IN (SELECT muted_id FROM muted_users WHERE muter_id = ?)
       GROUP BY b.id
       ORDER BY overlap_count DESC, b.created_at DESC
       LIMIT ?`
    )
    .bind(...topics, viewer.id, SIMILAR_RESULTS_LIMIT)
    .all();

  return new Response(JSON.stringify({ bleeps: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
