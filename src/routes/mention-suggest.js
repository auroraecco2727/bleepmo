// src/routes/mention-suggest.js
// GET /api/mention-suggest?q=partial -> { users: [...] }
//
// Backs the "Tag people" autocomplete in the composer. Deliberately
// separate from /api/search (routes/search.js) even though they share
// the same underlying query (searchUsers in shared/user-search.js):
// search.js requires 2+ characters and returns up to 15 results across
// both users and Bleeps, which is too slow-to-appear and too crowded for
// an inline dropdown a person is actively typing into. This starts
// suggesting at 1 character and caps at 6 results.

import { getSessionUser } from '../shared/auth.js';
import { searchUsers } from '../shared/user-search.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_RESULTS = 6;

export async function handleMentionSuggest(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  if (q.length < 1) {
    return new Response(JSON.stringify({ users: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const users = await searchUsers(env, q, MAX_RESULTS);

  return new Response(JSON.stringify({ users }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
