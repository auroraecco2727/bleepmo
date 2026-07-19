// src/routes/follow.js
// POST /api/users/:id/follow       -> toggle follow, returns { following, followerCount }
// GET  /api/users/:id/relationship -> { followerCount, followingCount, isFollowing, isFollowedBy }

import { getSessionUser, newId } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleFollowToggle(request, env, targetUserId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  if (user.id === targetUserId) return badRequest('You can\'t follow yourself.');

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetUserId).first();
  if (!target) return badRequest('User not found.', 404);

  const existing = await env.DB
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
    .bind(user.id, targetUserId)
    .first();

  let following;
  if (existing) {
    await env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(user.id, targetUserId).run();
    following = false;
  } else {
    await env.DB.prepare('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)').bind(user.id, targetUserId).run();
    following = true;
    await env.DB
      .prepare(
        `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
         VALUES (?, ?, 'follow', ?, 'user', ?)`
      )
      .bind(newId(), targetUserId, user.id, user.id)
      .run();
  }

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').bind(targetUserId).first();

  return new Response(JSON.stringify({ following, followerCount: countRow ? countRow.n : 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleUserRelationship(request, env, targetUserId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const followerCountRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').bind(targetUserId).first();
  const followingCountRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').bind(targetUserId).first();
  const isFollowingRow = await env.DB
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
    .bind(viewer.id, targetUserId)
    .first();
  const isFollowedByRow = await env.DB
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
    .bind(targetUserId, viewer.id)
    .first();

  return new Response(
    JSON.stringify({
      followerCount: followerCountRow ? followerCountRow.n : 0,
      followingCount: followingCountRow ? followingCountRow.n : 0,
      isFollowing: !!isFollowingRow,
      isFollowedBy: !!isFollowedByRow,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
