// src/shared/user-search.js
// Shared by routes/search.js and routes/mention-suggest.js so the two
// "find a user by partial handle/name" surfaces in the app can't drift
// out of sync with each other.

export async function searchUsers(env, q, limit) {
  const likeTerm = '%' + q.replace(/[%_]/g, '\\$&') + '%';

  const { results } = await env.DB
    .prepare(
      `SELECT id, full_name, handle_symbol, handle, avatar_shape, main_pic_key, icon_pic_key
       FROM users
       WHERE (handle LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\')
       ORDER BY (handle LIKE ? ESCAPE '\\') DESC, full_name ASC
       LIMIT ?`
    )
    .bind(likeTerm, likeTerm, q + '%', limit)
    .all();

  return results;
}
