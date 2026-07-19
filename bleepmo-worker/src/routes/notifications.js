// src/routes/notifications.js
import { getSessionUser } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleNotificationsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  const { results } = await env.DB
    .prepare(
      `SELECT n.id, n.type, n.source_type, n.source_id, n.read_at, n.created_at,
              a.id AS actor_id, a.full_name AS actor_name, a.handle_symbol AS actor_symbol, a.handle AS actor_handle
       FROM notifications n JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`
    )
    .bind(user.id)
    .all();

  return new Response(JSON.stringify({ notifications: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleNotificationsPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // no body is fine, treat as markAllRead
  }

  if (payload.markAllRead) {
    await env.DB
      .prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`)
      .bind(user.id)
      .run();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
