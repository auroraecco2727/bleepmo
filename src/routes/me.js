// src/routes/me.js
// GET -> returns the current session's user, or 401 if not logged in.

import { getSessionUser, publicUser } from '../shared/auth.js';

export async function handleMe(request, env) {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'DB binding not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return new Response(JSON.stringify({ user: null }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ user: publicUser(user) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
