// src/routes/upload-voice-clip.js
// POST multipart/form-data: { voiceClip: <file> } — requires an active session.

import { getSessionUser } from '../shared/auth.js';

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

export async function handleUploadVoiceClip(request, env, ctx) {
  if (!env.DB || !env.MEDIA) {
    return new Response(JSON.stringify({ error: 'Not configured' }), { status: 500 });
  }

  const user = await getSessionUser(request, env.DB);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not logged in.' }), { status: 401 });
  }

  const form = await request.formData();
  const voiceClip = form.get('voiceClip');

  if (!voiceClip || typeof voiceClip !== 'object' || voiceClip.size === 0) {
    return new Response(JSON.stringify({ error: 'No clip provided.' }), { status: 400 });
  }
  if (voiceClip.size > MAX_VIDEO_BYTES) {
    return new Response(JSON.stringify({ error: 'Clip is too large (max 40MB).' }), { status: 400 });
  }

  const key = `users/${user.id}/voice-clip-${Date.now()}`;
  const buf = await voiceClip.arrayBuffer();
  await env.MEDIA.put(key, buf, {
    httpMetadata: { contentType: voiceClip.type || 'video/webm' },
  });

  if (user.voice_clip_key && user.voice_clip_key !== key) {
    ctx.waitUntil(env.MEDIA.delete(user.voice_clip_key).catch(() => {}));
  }

  await env.DB.prepare('UPDATE users SET voice_clip_key = ? WHERE id = ?').bind(key, user.id).run();

  return new Response(JSON.stringify({ ok: true, voiceClipKey: key }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
