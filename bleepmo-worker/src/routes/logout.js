// src/routes/logout.js
import { readCookie, clearSessionCookie } from '../shared/auth.js';

export async function handleLogout(request, env) {
  const token = readCookie(request, 'session');

  if (token && env.DB) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  });
}
