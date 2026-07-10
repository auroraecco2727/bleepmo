// src/routes/login.js
// POST JSON: { userId: "<email or handle>", password: "..." }

import { verifyPassword, createSession, sessionCookie, publicUser } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleLogin(request, env) {
  if (!env.DB) return badRequest('DB binding not configured on this Worker.', 500);

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
