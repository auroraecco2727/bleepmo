// src/routes/conversations.js
// GET  /api/conversations                    -> list of the viewer's conversations, newest activity first
// POST /api/conversations                    -> { otherUserId } -> get-or-create the 1:1 conversation
// GET  /api/conversations/:id/messages        -> paginated messages, oldest-first page via ?before= cursor
// POST /api/conversations/:id/messages        -> { body } -> send a message
// POST /api/conversations/:id/read            -> mark the other person's messages as read

import { getSessionUser, newId } from '../shared/auth.js';

const PAGE_SIZE = 30;

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Two users always map to the same (user_a_id, user_b_id) pair regardless
// of who initiated — smaller id first — so the UNIQUE constraint on
// conversations actually prevents duplicate threads between the same pair.
function orderedPair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

async function getConversationIfParticipant(db, conversationId, userId) {
  const conv = await db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .bind(conversationId)
    .first();
  if (!conv) return null;
  if (conv.user_a_id !== userId && conv.user_b_id !== userId) return null;
  return conv;
}

export async function handleConversationsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const { results } = await env.DB
    .prepare(
      `SELECT
         c.id, c.last_message_at, c.created_at,
         u.id AS other_id, u.full_name AS other_full_name, u.handle_symbol AS other_handle_symbol,
         u.handle AS other_handle, u.avatar_shape AS other_avatar_shape,
         u.main_pic_key AS other_main_pic_key, u.icon_pic_key AS other_icon_pic_key,
         (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_body,
         (SELECT sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_sender_id,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL) AS unread_count
       FROM conversations c
       JOIN users u ON u.id = (CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END)
       WHERE c.user_a_id = ? OR c.user_b_id = ?
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`
    )
    .bind(viewer.id, viewer.id, viewer.id, viewer.id)
    .all();

  return ok({ conversations: results });
}

export async function handleConversationsPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body with otherUserId.');
  }

  const otherUserId = (payload.otherUserId || '').toString();
  if (!otherUserId) return badRequest('otherUserId is required.');
  if (otherUserId === viewer.id) return badRequest('Cannot start a conversation with yourself.');

  const other = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(otherUserId).first();
  if (!other) return badRequest('That user doesn\'t exist.', 404);

  const [userAId, userBId] = orderedPair(viewer.id, otherUserId);

  let conv = await env.DB
    .prepare('SELECT * FROM conversations WHERE user_a_id = ? AND user_b_id = ?')
    .bind(userAId, userBId)
    .first();

  if (!conv) {
    const id = newId();
    await env.DB
      .prepare('INSERT INTO conversations (id, user_a_id, user_b_id) VALUES (?, ?, ?)')
      .bind(id, userAId, userBId)
      .run();
    conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  }

  return ok({ conversation: conv });
}

export async function handleConversationMessagesGet(request, env, conversationId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const conv = await getConversationIfParticipant(env.DB, conversationId, viewer.id);
  if (!conv) return badRequest('Conversation not found.', 404);

  const url = new URL(request.url);
  const before = url.searchParams.get('before'); // created_at cursor, paging backwards into history

  let query = `SELECT id, conversation_id, sender_id, body, created_at, read_at FROM messages WHERE conversation_id = ?`;
  const binds = [conversationId];
  if (before) {
    query += ' AND created_at < ?';
    binds.push(before);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(PAGE_SIZE);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  results.reverse(); // oldest-first for rendering top-to-bottom

  const nextCursor = results.length === PAGE_SIZE ? results[0].created_at : null;

  return ok({ messages: results, nextCursor });
}

export async function handleConversationMessagesPost(request, env, conversationId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const conv = await getConversationIfParticipant(env.DB, conversationId, viewer.id);
  if (!conv) return badRequest('Conversation not found.', 404);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body with body.');
  }

  const body = (payload.body || '').toString().trim();
  if (!body) return badRequest('Message can\'t be empty.');
  if (body.length > 2000) return badRequest('Message is too long (max 2000 characters).');

  const messageId = newId();
  await env.DB
    .prepare('INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?, ?, ?, ?)')
    .bind(messageId, conversationId, viewer.id, body)
    .run();
  await env.DB
    .prepare(`UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?`)
    .bind(conversationId)
    .run();

  const message = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first();

  return ok({ message }, 201);
}

export async function handleConversationReadPost(request, env, conversationId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const conv = await getConversationIfParticipant(env.DB, conversationId, viewer.id);
  if (!conv) return badRequest('Conversation not found.', 404);

  await env.DB
    .prepare(
      `UPDATE messages SET read_at = datetime('now') WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`
    )
    .bind(conversationId, viewer.id)
    .run();

  return ok({ ok: true });
}
