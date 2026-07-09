// functions/api/login.js
// POST JSON: { userId: "<email or handle>", password: "..." }
// "userId" matches the front-end's "User ID" field — it can be an email
// address or a bare handle (without the leading symbol).

import { verifyPassword, createSession, sessionCookie, publicUser } from '../_shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return badRequest('DB binding not configured on this Pages project.', 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const userId = (body.userId || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();

  if (!userId || !password) {
    return badRequest('userId and password are required.');
  }

  const user = await env.DB
    .prepare('SELECT * FROM users WHERE email = ? OR handle = ?')
    .bind(userId, body.userId ? body.userId.toString().trim() : '')
    .first();

  // Generic message on both "no such user" and "wrong password" —
  // never reveal which one it was.
  if (!user) return badRequest('Invalid credentials.', 401);

  const ok = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) return badRequest('Invalid credentials.', 401);

  const { token, expiresAt } = await createSession(env.DB, user.id);

  return new Response(JSON.stringify({ user: publicUser(user) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token, expiresAt),
    },
  });
}
