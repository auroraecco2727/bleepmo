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

  let query = `
    SELECT
      b.id, b.author_id, b.content_type, b.body, b.media_key, b.created_at,
      u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key,
      (SELECT COUNT(*) FROM comments c WHERE c.content_type = 'bleep' AND c.content_id = b.id AND c.hidden_at IS NULL) AS comment_count
    FROM bleeps b
    JOIN users u ON u.id = b.author_id
    WHERE b.deleted_at IS NULL
  `;
  const binds = [];
  if (cursor) {
    query += ' AND b.created_at < ?';
    binds.push(cursor);
  }
  query += ' ORDER BY b.created_at DESC LIMIT ?';
  binds.push(PAGE_SIZE);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
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
  const contentType = (form.get('contentType') || 'bleep').toString();
  const media = form.get('media');

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
      `INSERT INTO bleeps (id, author_id, content_type, body, media_key)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(bleepId, user.id, contentType, body || null, mediaKey)
    .run();

  const tags = await applyMentions(env.DB, {
    text: body,
    contentType: 'bleep',
    contentId: bleepId,
    taggerUserId: user.id,
  });

  const bleep = await env.DB
    .prepare(
      `SELECT b.id, b.author_id, b.content_type, b.body, b.media_key, b.created_at,
              u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM bleeps b JOIN users u ON u.id = b.author_id WHERE b.id = ?`
    )
    .bind(bleepId)
    .first();

  return new Response(JSON.stringify({ bleep, tagsApplied: tags.length }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
