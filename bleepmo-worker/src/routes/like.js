// src/routes/like.js
// POST /api/bleeps/:id/like -> toggle like, returns { liked, likeCount }

import { getSessionUser, newId } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBleepLikeToggle(request, env, bleepId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  const bleep = await env.DB
    .prepare('SELECT id, author_id FROM bleeps WHERE id = ? AND deleted_at IS NULL')
    .bind(bleepId)
    .first();
  if (!bleep) return badRequest('Bleep not found.', 404);

  const existing = await env.DB
    .prepare('SELECT 1 FROM likes WHERE bleep_id = ? AND user_id = ?')
    .bind(bleepId, user.id)
    .first();

  let liked;
  if (existing) {
    await env.DB.prepare('DELETE FROM likes WHERE bleep_id = ? AND user_id = ?').bind(bleepId, user.id).run();
    liked = false;
  } else {
    await env.DB.prepare('INSERT INTO likes (bleep_id, user_id) VALUES (?, ?)').bind(bleepId, user.id).run();
    liked = true;
    // Notify the author, unless they liked their own post.
    if (bleep.author_id !== user.id) {
      await env.DB
        .prepare(
          `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
           VALUES (?, ?, 'like', ?, 'bleep', ?)`
        )
        .bind(newId(), bleep.author_id, user.id, bleepId)
        .run();
    }
  }

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM likes WHERE bleep_id = ?').bind(bleepId).first();

  return new Response(JSON.stringify({ liked, likeCount: countRow ? countRow.n : 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
