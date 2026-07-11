// src/routes/bleeps.js
// GET  /api/bleeps  -> paginated feed, newest first
// POST /api/bleeps  -> create a new Bleep (caption + optional media)

import { getSessionUser, newId } from '../shared/auth.js';
import { applyMentions } from '../shared/mentions.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_MEDIA_BYTES = 60 * 1024 * 1024;
const PAGE_SIZE = 20;

export async function handleBleepsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const authorFilter = url.searchParams.get('author');

  let query = `
    SELECT
      b.id, b.author_id, b.content_type, b.title, b.body, b.media_key, b.is_breaking, b.created_at,
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
  }
  if (cursor) {
    query += ' AND b.created_at < ?';
    binds.push(cursor);
  }
  query += ' ORDER BY b.created_at DESC LIMIT ?';
  binds.push(PAGE_SIZE);

  const { results } = await env.DB.prepare(query).bind(...binds).all();

  // Attach trend-points to each Bleep in one extra query rather than N+1.
  if (results.length > 0) {
    const ids = results.map((b) => b.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: allTrendPoints } = await env.DB
      .prepare(`SELECT bleep_id, topic FROM trend_points WHERE bleep_id IN (${placeholders}) ORDER BY created_at ASC`)
      .bind(...ids)
      .all();
    const byBleepId = {};
    for (const tp of allTrendPoints) {
      (byBleepId[tp.bleep_id] = byBleepId[tp.bleep_id] || []).push(tp.topic);
    }
    for (const b of results) {
      b.trend_points = byBleepId[b.id] || [];
    }
  }

  const nextCursor = results.length === PAGE_SIZE ? results[results.length - 1].created_at : null;

  return new Response(JSON.stringify({ bleeps: results, nextCursor }), {
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
  const contentType = (form.get('contentType') || 'bleep').toString();
  const media = form.get('media');
  const isBreaking = (form.get('isBreaking') || '').toString() === 'true' ? 1 : 0;

  // trendPoints arrives as a JSON array string, e.g. '["Sustainable Tech","Urban Design"]'
  let trendPoints = [];
  const trendPointsRaw = form.get('trendPoints');
  if (trendPointsRaw) {
    try {
      const parsed = JSON.parse(trendPointsRaw.toString());
      if (Array.isArray(parsed)) {
        trendPoints = parsed
          .map((t) => t.toString().trim())
          .filter((t) => t.length > 0 && t.length <= 40)
          .slice(0, 8); // sane cap so nobody turns a caption into 200 tags
      }
    } catch {
      // malformed JSON — just skip trend-points rather than failing the whole post
    }
  }

  const hasMedia = media && typeof media === 'object' && media.size > 0;
  if (!body && !hasMedia) {
    return badRequest('A Bleep needs either a caption or media.');
  }

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
      `INSERT INTO bleeps (id, author_id, content_type, title, body, media_key, is_breaking)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(bleepId, user.id, contentType, title, body || null, mediaKey, isBreaking)
    .run();

  for (const topic of trendPoints) {
    await env.DB
      .prepare(`INSERT INTO trend_points (id, bleep_id, topic) VALUES (?, ?, ?)`)
      .bind(newId(), bleepId, topic)
      .run();
  }

  const tags = await applyMentions(env.DB, {
    text: body,
    contentType: 'bleep',
    contentId: bleepId,
    taggerUserId: user.id,
  });

  const bleep = await env.DB
    .prepare(
      `SELECT b.id, b.author_id, b.content_type, b.title, b.body, b.media_key, b.is_breaking, b.created_at,
              u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM bleeps b JOIN users u ON u.id = b.author_id WHERE b.id = ?`
    )
    .bind(bleepId)
    .first();
  bleep.trend_points = trendPoints;

  return new Response(JSON.stringify({ bleep, tagsApplied: tags.length }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
