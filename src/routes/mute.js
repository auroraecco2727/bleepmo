// src/routes/mute.js
// POST   /api/users/:id/mute -> toggle mute, returns { muted }
// GET    /api/me/muted       -> list of currently-muted users, for a future
//                               "Muted accounts" management screen
//
// Muting is intentionally one-directional and silent — see the header
// comment in migrations/0014_muted_users.sql for exactly what it does
// and doesn't affect. It is NOT a block: the muted person is never
// notified, can still follow/message/comment on the muter, and none of
// their content is hidden if the muter visits their profile directly.

import { getSessionUser } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleMuteToggle(request, env, targetUserId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  if (user.id === targetUserId) return badRequest('You can\'t mute yourself.');

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetUserId).first();
  if (!target) return badRequest('User not found.', 404);

  const existing = await env.DB
    .prepare('SELECT 1 FROM muted_users WHERE muter_id = ? AND muted_id = ?')
    .bind(user.id, targetUserId)
    .first();

  let muted;
  if (existing) {
    await env.DB
      .prepare('DELETE FROM muted_users WHERE muter_id = ? AND muted_id = ?')
      .bind(user.id, targetUserId)
      .run();
    muted = false;
  } else {
    await env.DB
      .prepare('INSERT INTO muted_users (muter_id, muted_id) VALUES (?, ?)')
      .bind(user.id, targetUserId)
      .run();
    muted = true;
  }

  return new Response(JSON.stringify({ muted }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleMutedListGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  const { results } = await env.DB
    .prepare(
      `SELECT u.id, u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key, m.created_at AS muted_at
       FROM muted_users m
       JOIN users u ON u.id = m.muted_id
       WHERE m.muter_id = ?
       ORDER BY m.created_at DESC`
    )
    .bind(user.id)
    .all();

  return new Response(JSON.stringify({ muted: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
