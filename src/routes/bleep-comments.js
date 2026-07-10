// src/routes/bleep-comments.js
// GET  /api/bleeps/:id/comments  -> threaded comments for a Bleep
// POST /api/bleeps/:id/comments  -> add a comment (or reply, via parentCommentId)

import { getSessionUser, newId } from '../shared/auth.js';
import { applyMentions } from '../shared/mentions.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBleepCommentsGet(request, env, bleepId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const { results } = await env.DB
    .prepare(
      `SELECT c.id, c.parent_comment_id, c.body, c.created_at, c.edited_at,
              u.id AS author_id, u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.content_type = 'bleep' AND c.content_id = ? AND c.hidden_at IS NULL
       ORDER BY c.created_at ASC`
    )
    .bind(bleepId)
    .all();

  return new Response(JSON.stringify({ comments: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleBleepCommentsPost(request, env, bleepId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  const bleep = await env.DB
    .prepare('SELECT id, author_id FROM bleeps WHERE id = ? AND deleted_at IS NULL')
    .bind(bleepId)
    .first();
  if (!bleep) return badRequest('Bleep not found.', 404);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const body = (payload.body || '').toString().trim();
  const parentCommentId = payload.parentCommentId || null;
  if (!body) return badRequest('Comment body is required.');
  if (body.length > 2000) return badRequest('Comment is too long (max 2000 characters).');

  let parentComment = null;
  if (parentCommentId) {
    parentComment = await env.DB
      .prepare('SELECT id, author_id FROM comments WHERE id = ? AND content_type = ? AND content_id = ?')
      .bind(parentCommentId, 'bleep', bleepId)
      .first();
    if (!parentComment) return badRequest('The comment you\'re replying to doesn\'t exist.', 404);
  }

  const commentId = newId();
  await env.DB
    .prepare(
      `INSERT INTO comments (id, content_type, content_id, author_id, parent_comment_id, body)
       VALUES (?, 'bleep', ?, ?, ?, ?)`
    )
    .bind(commentId, bleepId, user.id, parentCommentId, body)
    .run();

  if (bleep.author_id !== user.id) {
    await env.DB
      .prepare(
        `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
         VALUES (?, ?, 'comment', ?, 'bleep', ?)`
      )
      .bind(newId(), bleep.author_id, user.id, bleepId)
      .run();
  }

  if (parentComment && parentComment.author_id !== user.id && parentComment.author_id !== bleep.author_id) {
    await env.DB
      .prepare(
        `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
         VALUES (?, ?, 'reply', ?, 'comment', ?)`
      )
      .bind(newId(), parentComment.author_id, user.id, commentId)
      .run();
  }

  const tags = await applyMentions(env.DB, {
    text: body,
    contentType: 'comment',
    contentId: commentId,
    taggerUserId: user.id,
  });

  const comment = await env.DB
    .prepare(
      `SELECT c.id, c.parent_comment_id, c.body, c.created_at,
              u.id AS author_id, u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`
    )
    .bind(commentId)
    .first();

  return new Response(JSON.stringify({ comment, tagsApplied: tags.length }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}
