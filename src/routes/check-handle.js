// src/routes/check-handle.js
// GET /api/check-handle?handle=quantumcity
//
// Lets the signup form validate a handle as the person types, instead of
// only finding out it's taken (or invalid) after filling out the entire
// form, uploading pictures, and recording a 15-second voice clip.
//
// Format rules mirror the @mention regex already used to render tagged
// handles elsewhere in the app (public/index.html, renderBleepMentions):
// 2-30 characters, letters/numbers/underscore only. A handle outside that
// pattern would never be @-mentionable once created, so it's enforced
// here and in signup.js — not just cosmetically in this endpoint.

const HANDLE_PATTERN = /^[A-Za-z0-9_]{2,30}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleCheckHandle(request, env) {
  if (!env.DB) return json({ error: 'DB binding not configured.' }, 500);

  const url = new URL(request.url);
  const handle = (url.searchParams.get('handle') || '').trim();

  if (!handle) {
    return json({ available: false, reason: 'empty' });
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return json({ available: false, reason: 'invalid_format' });
  }

  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE')
    .bind(handle)
    .first();

  return json({ available: !existing, reason: existing ? 'taken' : null });
}
