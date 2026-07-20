// src/routes/update-profile.js
// PATCH /api/me  (multipart/form-data)
// Fields, all optional — only what's sent gets changed:
//   fullName, handleSymbol, handle, avatarShape
//   mainPic, iconPic (files)         — replace the current image
//   removeMainPic, removeIconPic     — 'true' to clear without replacing
//   currentPassword, newPassword     — both required together to change password

import { getSessionUser, hashPassword, verifyPassword, publicUser } from '../shared/auth.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB, same ceiling as signup

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

export async function handleUpdateProfile(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  if (!env.MEDIA) return badRequest('MEDIA (R2) binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest('Expected multipart/form-data.');
  }

  const updates = {};
  const binds = [];

  const fullName = form.has('fullName') ? (form.get('fullName') || '').toString().trim() : null;
  if (fullName !== null) {
    if (!fullName) return badRequest('Screen-name can\'t be empty.');
    updates.full_name = fullName;
  }

  const handleSymbol = form.has('handleSymbol') ? (form.get('handleSymbol') || '@').toString().trim() : null;
  if (handleSymbol) updates.handle_symbol = handleSymbol;

  const handle = form.has('handle') ? (form.get('handle') || '').toString().trim() : null;
  if (handle !== null) {
    if (!handle) return badRequest('Handle can\'t be empty.');
    if (handle !== user.handle) {
      const existing = await env.DB
        .prepare('SELECT id FROM users WHERE handle = ? AND id != ?')
        .bind(handle, user.id)
        .first();
      if (existing) return badRequest('That handle is already taken.', 409);
    }
    updates.handle = handle;
  }

  const avatarShape = form.has('avatarShape') ? (form.get('avatarShape') || '').toString().trim() : null;
  if (avatarShape) updates.avatar_shape = avatarShape;

  // Images: an uploaded file replaces the key; a 'removeXPic'='true' with
  // no file clears it back to null (falls back to initials in the UI).
  const mainPic = form.get('mainPic');
  if (mainPic && typeof mainPic === 'object' && mainPic.size > 0) {
    if (mainPic.size > MAX_IMAGE_BYTES) return badRequest('Main picture is too large (max 8MB).');
    const key = `users/${user.id}/main-pic-${Date.now()}`;
    await putFile(env.MEDIA, key, mainPic);
    updates.main_pic_key = key;
  } else if ((form.get('removeMainPic') || '').toString() === 'true') {
    updates.main_pic_key = null;
  }

  const iconPic = form.get('iconPic');
  if (iconPic && typeof iconPic === 'object' && iconPic.size > 0) {
    if (iconPic.size > MAX_IMAGE_BYTES) return badRequest('Icon picture is too large (max 8MB).');
    const key = `users/${user.id}/icon-pic-${Date.now()}`;
    await putFile(env.MEDIA, key, iconPic);
    updates.icon_pic_key = key;
  } else if ((form.get('removeIconPic') || '').toString() === 'true') {
    updates.icon_pic_key = null;
  }

  // Password change — both fields required together, current password verified first.
  const currentPassword = (form.get('currentPassword') || '').toString();
  const newPassword = (form.get('newPassword') || '').toString();
  if (newPassword || currentPassword) {
    if (!currentPassword || !newPassword) {
      return badRequest('Enter both your current password and a new password to change it.');
    }
    const ok = await verifyPassword(currentPassword, user.password_hash, user.password_salt);
    if (!ok) return badRequest('Current password is incorrect.', 401);
    if (newPassword.length < 8) return badRequest('New password must be at least 8 characters.');
    const { hash, salt } = await hashPassword(newPassword);
    updates.password_hash = hash;
    updates.password_salt = salt;
  }

  const fields = Object.keys(updates);
  if (fields.length === 0) {
    return new Response(JSON.stringify({ user: publicUser(user) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  binds.push(...fields.map((f) => updates[f]), user.id);

  try {
    await env.DB.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).bind(...binds).run();
  } catch (err) {
    return badRequest('That email or handle is already taken.', 409);
  }

  const updatedUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();

  return new Response(JSON.stringify({ user: publicUser(updatedUser) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
