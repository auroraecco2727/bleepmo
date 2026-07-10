// src/routes/comment-detail.js
// DELETE /api/comments/:id -> soft-hide, by the comment's author or the Bleep's author

import { getSessionUser } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleCommentDetailDelete(request, env, commentId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  const comment = await env.DB
    .prepare('SELECT id, author_id, content_type, content_id FROM comments WHERE id = ?')
    .bind(commentId)
    .first();
  if (!comment) return badRequest('Comment not found.', 404);

  let allowed = comment.author_id === user.id;

  if (!allowed && comment.content_type === 'bleep') {
    const bleep = await env.DB.prepare('SELECT author_id FROM bleeps WHERE id = ?').bind(comment.content_id).first();
    allowed = !!bleep && bleep.author_id === user.id;
  }

  if (!allowed) return badRequest('You can\'t remove this comment.', 403);

  await env.DB
    .prepare(`UPDATE comments SET hidden_at = datetime('now'), hidden_reason = ? WHERE id = ?`)
    .bind(comment.author_id === user.id ? 'removed_by_author' : 'removed_by_post_owner', commentId)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
