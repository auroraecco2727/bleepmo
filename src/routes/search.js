// src/routes/search.js
// GET /api/search?q=QUERY -> { users: [...], bleeps: [...] }
//
// Basic substring search (SQL LIKE), not a full-text search engine — but
// real and functional. Searches user handles/names, and Bleep captions.

import { getSessionUser } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_RESULTS = 15;

export async function handleSearch(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  // This keeps the privacy control safe for production databases created
  // before Settings existed; schema.sql creates the same table for new ones.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      in_app_notifications INTEGER NOT NULL DEFAULT 1,
      email_updates INTEGER NOT NULL DEFAULT 0,
      searchable INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  if (q.length < 2) {
    return new Response(JSON.stringify({ users: [], bleeps: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const likeTerm = '%' + q.replace(/[%_]/g, '\\$&') + '%';

  const { results: users } = await env.DB
    .prepare(
      `SELECT u.id, u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE (u.id = ? OR COALESCE(s.searchable, 1) = 1)
         AND (u.handle LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\')
       ORDER BY (handle LIKE ? ESCAPE '\\') DESC, full_name ASC
       LIMIT ?`
    )
    .bind(viewer.id, likeTerm, likeTerm, q + '%', MAX_RESULTS)
    .all();

  const { results: bleeps } = await env.DB
    .prepare(
      `SELECT b.id, b.author_id, b.content_type, b.title, b.body, b.media_key, b.is_breaking, b.created_at,
              u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM bleeps b JOIN users u ON u.id = b.author_id
       WHERE b.deleted_at IS NULL AND (b.body LIKE ? ESCAPE '\\' OR b.title LIKE ? ESCAPE '\\')
       ORDER BY b.created_at DESC
       LIMIT ?`
    )
    .bind(likeTerm, likeTerm, MAX_RESULTS)
    .all();

  return new Response(JSON.stringify({ users, bleeps }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
