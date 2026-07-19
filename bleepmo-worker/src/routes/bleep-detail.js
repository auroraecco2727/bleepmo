// src/routes/bleep-detail.js
// GET    /api/bleeps/:id   -> single Bleep with author info, comment count, approved tags
// DELETE /api/bleeps/:id   -> soft delete (author only)

import { getSessionUser } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBleepDetailGet(request, env, bleepId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const bleep = await env.DB
    .prepare(
      `SELECT b.id, b.author_id, b.content_type, b.title, b.body, b.media_key, b.is_breaking, b.created_at,
              u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM bleeps b JOIN users u ON u.id = b.author_id
       WHERE b.id = ? AND b.deleted_at IS NULL`
    )
    .bind(bleepId)
    .first();

  if (!bleep) return badRequest('Bleep not found.', 404);

  const { results: trendPoints } = await env.DB
    .prepare(`SELECT topic FROM trend_points WHERE bleep_id = ? ORDER BY created_at ASC`)
    .bind(bleepId)
    .all();
  bleep.trend_points = trendPoints.map((t) => t.topic);

  const { results: tags } = await env.DB
    .prepare(
      `SELECT u.handle_symbol, u.handle
       FROM tags t JOIN users u ON u.id = t.tagged_user_id
       WHERE t.content_type = 'bleep' AND t.content_id = ?
       ORDER BY t.created_at ASC`
    )
    .bind(bleepId)
    .all();
  bleep.tagged_handles = tags.map((t) => t.handle_symbol + t.handle);

  const commentCountRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM comments WHERE content_type = 'bleep' AND content_id = ? AND hidden_at IS NULL`
    )
    .bind(bleepId)
    .first();
  bleep.comment_count = commentCountRow ? commentCountRow.n : 0;

  const likeCountRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM likes WHERE bleep_id = ?').bind(bleepId).first();
  bleep.like_count = likeCountRow ? likeCountRow.n : 0;

  const likedByViewerRow = await env.DB
    .prepare('SELECT 1 FROM likes WHERE bleep_id = ? AND user_id = ?')
    .bind(bleepId, viewer.id)
    .first();
  bleep.liked_by_viewer = !!likedByViewerRow;

  return new Response(JSON.stringify({ bleep }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBleepDetailDelete(request, env, bleepId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  const bleep = await env.DB.prepare('SELECT author_id FROM bleeps WHERE id = ?').bind(bleepId).first();
  if (!bleep) return badRequest('Bleep not found.', 404);
  if (bleep.author_id !== user.id) return badRequest('You can only delete your own Bleeps.', 403);

  await env.DB
    .prepare(`UPDATE bleeps SET deleted_at = datetime('now') WHERE id = ?`)
    .bind(bleepId)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
