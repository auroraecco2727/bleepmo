// src/routes/signup.js
// POST multipart/form-data:
//   fullName, handleSymbol, handle, email, password, avatarShape (required-ish)
//   mainPic, iconPic, voiceClip (files, all optional)

import { hashPassword, newId, createSession, sessionCookie, publicUser } from '../shared/auth.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8MB
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;  // 40MB (generous ceiling for a 15s clip)

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function putFile(bucket, key, file) {
  const buf = await file.arrayBuffer();
  await bucket.put(key, buf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return key;
}

export async function handleSignup(request, env) {
  if (!env.DB) return badRequest('DB binding not configured on this Worker.', 500);
  if (!env.MEDIA) return badRequest('MEDIA (R2) binding not configured on this Worker.', 500);

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest('Expected multipart/form-data.');
  }

  const fullName = (form.get('fullName') || '').toString().trim();
  const handleSymbol = (form.get('handleSymbol') || '@').toString().trim() || '@';
  const handle = (form.get('handle') || '').toString().trim();
  const email = (form.get('email') || '').toString().trim().toLowerCase();
  const password = (form.get('password') || '').toString();
  const avatarShape = (form.get('avatarShape') || 'circle').toString().trim() || 'circle';

  if (!fullName || !handle || !email || !password) {
    return badRequest('fullName, handle, email, and password are all required.');
  }
  if (password.length < 8) {
    return badRequest('Password must be at least 8 characters.');
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return badRequest('That email address doesn\'t look valid.');
  }

  const existing = await env.DB
    .prepare('SELECT id FROM users WHERE email = ? OR handle = ?')
    .bind(email, handle)
    .first();
  if (existing) {
    return badRequest('That email or handle is already taken.', 409);
  }

  const userId = newId();

  let mainPicKey = null;
  let iconPicKey = null;
  let voiceClipKey = null;

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

  const voiceClip = form.get('voiceClip');
  if (voiceClip && typeof voiceClip === 'object' && voiceClip.size > 0) {
    if (voiceClip.size > MAX_VIDEO_BYTES) return badRequest('Voice clip is too large (max 40MB).');
    voiceClipKey = `users/${userId}/voice-clip-${Date.now()}`;
    await putFile(env.MEDIA, voiceClipKey, voiceClip);
  }

  const { hash, salt } = await hashPassword(password);

  try {
    await env.DB
      .prepare(
        `INSERT INTO users
          (id, full_name, handle_symbol, handle, email, password_hash, password_salt, avatar_shape, main_pic_key, icon_pic_key, voice_clip_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, fullName, handleSymbol, handle, email, hash, salt, avatarShape, mainPicKey, iconPicKey, voiceClipKey)
      .run();
  } catch (err) {
    return badRequest('That email or handle is already taken.', 409);
  }

  const { token, expiresAt } = await createSession(env.DB, userId);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

  return new Response(JSON.stringify({ user: publicUser(user) }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token, expiresAt),
    },
  });
}
