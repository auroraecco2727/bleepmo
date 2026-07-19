// src/routes/oauth-complete.js
// GET  /api/auth/pending   -> read back the provider profile stashed by the
//                             oauth callback, so the frontend can prefill
//                             the "finish your profile" screen
// POST /api/auth/complete  -> multipart/form-data: handleSymbol, handle,
//                             avatarShape, fullName (optional override),
//                             mainPic/iconPic (optional files)
//                             Creates the account using the pending cookie's
//                             provider/sub/email — never trusts those fields
//                             if sent directly by the client.

import { newId, createSession, sessionCookie, publicUser, hashPassword, readCookie } from '../shared/auth.js';
import { clearShortCookie } from '../shared/oauth.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readPendingCookie(request) {
  const raw = readCookie(request, 'oauth_pending');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.provider || !parsed.sub) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function putFile(bucket, key, file) {
  const buf = await file.arrayBuffer();
  await bucket.put(key, buf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return key;
}

export async function handlePendingOAuthGet(request, env) {
  const pending = readPendingCookie(request);
  if (!pending) {
    return new Response(JSON.stringify({ pending: null }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Don't leak the raw provider sub to the client — it doesn't need it.
  return new Response(
    JSON.stringify({ pending: { provider: pending.provider, email: pending.email, fullName: pending.fullName } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function handleCompleteOAuthSignup(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  if (!env.MEDIA) return badRequest('MEDIA (R2) binding not configured.', 500);

  const pending = readPendingCookie(request);
  if (!pending) return badRequest('No pending sign-in found. Please start over with Google or Apple.', 400);

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest('Expected multipart/form-data.');
  }

  const fullName = ((form.get('fullName') || '').toString().trim()) || pending.fullName || 'New User';
  const handleSymbol = (form.get('handleSymbol') || '@').toString().trim() || '@';
  const handle = (form.get('handle') || '').toString().trim();
  const avatarShape = (form.get('avatarShape') || 'circle').toString().trim() || 'circle';
  const email = (pending.email || '').toLowerCase();

  if (!handle) return badRequest('Please choose a handle.');
  if (!email) return badRequest('Your Google/Apple account didn\'t share a usable email — try a different sign-in method.');

  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email = ? OR handle = ?')
    .bind(email, handle)
    .first();
  if (existing) {
    return badRequest('That email is already registered, or that handle is taken. Try Bleepmo ID login, or pick a different handle.', 409);
  }

  const userId = newId();

  let mainPicKey = null;
  let iconPicKey = null;

  const mainPic = form.get('mainPic');
  if (mainPic && typeof mainPic === 'object' && mainPic.size > 0) {
    if (mainPic.size > MAX_IMAGE_BYTES) return badRequest('Main picture is too large (max 8MB).');
    mainPicKey = `users/${userId}/main-pic-${Date.now()}`;
    await putFile(env.MEDIA, mainPicKey, mainPic);
  }

  const iconPic = form.get('iconPic');
  if (iconPic && typeof iconPic === 'object' && iconPic.size > 0) {
    if (iconPic.size > MAX_IMAGE_BYTES) return badRequest('Icon picture is too large (max 8MB).');
    iconPicKey = `users/${userId}/icon-pic-${Date.now()}`;
    await putFile(env.MEDIA, iconPicKey, iconPic);
  }

  // OAuth-only accounts still need *some* password_hash/salt to satisfy the
  // NOT NULL columns — generate one from random bytes the user never sees.
  // They can set a real password later from Settings if they want a
  // Bleepmo-ID fallback login too.
  const randomPassword = crypto.randomUUID() + crypto.randomUUID();
  const { hash, salt } = await hashPassword(randomPassword);

  const googleSub = pending.provider === 'google' ? pending.sub : null;
  const appleSub = pending.provider === 'apple' ? pending.sub : null;

  try {
    await env.DB
      .prepare(
        `INSERT INTO users
          (id, full_name, handle_symbol, handle, email, password_hash, password_salt, avatar_shape, main_pic_key, icon_pic_key, google_sub, apple_sub)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, fullName, handleSymbol, handle, email, hash, salt, avatarShape, mainPicKey, iconPicKey, googleSub, appleSub)
      .run();
  } catch (err) {
    return badRequest('That email or handle is already taken.', 409);
  }

  const { token, expiresAt } = await createSession(env.DB, userId);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', sessionCookie(token, expiresAt));
  headers.append('Set-Cookie', clearShortCookie('oauth_pending'));

  return new Response(JSON.stringify({ user: publicUser(user) }), { status: 201, headers });
}
