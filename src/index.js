// src/index.js
// Single entry point required by Cloudflare Workers. Routes /api/* and
// /media/* to their handlers; anything else falls through to the static
// assets binding (index.html, test-console.html, etc.) configured in
// wrangler.toml under [assets].

import { handleSignup } from './routes/signup.js';
import { handleLogin } from './routes/login.js';
import { handleLogout } from './routes/logout.js';
import { handleMe } from './routes/me.js';
import { handleUploadVoiceClip } from './routes/upload-voice-clip.js';
import { handleNotificationsGet, handleNotificationsPost } from './routes/notifications.js';
import { handleBleepsGet, handleBleepsPost } from './routes/bleeps.js';
import { handleBleepDetailGet, handleBleepDetailDelete } from './routes/bleep-detail.js';
import { handleBleepCommentsGet, handleBleepCommentsPost } from './routes/bleep-comments.js';
import { handleCommentDetailDelete } from './routes/comment-detail.js';
import { handleMedia } from './routes/media.js';

function notFound() {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serverError(err) {
  return new Response(JSON.stringify({ error: 'Internal error', detail: String(err && err.message || err) }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── Auth ──
      if (path === '/api/signup' && method === 'POST') return await handleSignup(request, env);
      if (path === '/api/login' && method === 'POST') return await handleLogin(request, env);
      if (path === '/api/logout' && method === 'POST') return await handleLogout(request, env);
      if (path === '/api/me' && method === 'GET') return await handleMe(request, env);
      if (path === '/api/upload-voice-clip' && method === 'POST') return await handleUploadVoiceClip(request, env, ctx);

      // ── Notifications ──
      if (path === '/api/notifications' && method === 'GET') return await handleNotificationsGet(request, env);
      if (path === '/api/notifications' && method === 'POST') return await handleNotificationsPost(request, env);

      // ── Bleeps ──
      if (path === '/api/bleeps' && method === 'GET') return await handleBleepsGet(request, env);
      if (path === '/api/bleeps' && method === 'POST') return await handleBleepsPost(request, env);

      const bleepDetailMatch = path.match(/^\/api\/bleeps\/([^/]+)$/);
      if (bleepDetailMatch && method === 'GET') return await handleBleepDetailGet(request, env, bleepDetailMatch[1]);
      if (bleepDetailMatch && method === 'DELETE') return await handleBleepDetailDelete(request, env, bleepDetailMatch[1]);

      const bleepCommentsMatch = path.match(/^\/api\/bleeps\/([^/]+)\/comments$/);
      if (bleepCommentsMatch && method === 'GET') return await handleBleepCommentsGet(request, env, bleepCommentsMatch[1]);
      if (bleepCommentsMatch && method === 'POST') return await handleBleepCommentsPost(request, env, bleepCommentsMatch[1]);

      // ── Comments ──
      const commentDetailMatch = path.match(/^\/api\/comments\/([^/]+)$/);
      if (commentDetailMatch && method === 'DELETE') return await handleCommentDetailDelete(request, env, commentDetailMatch[1]);

      // ── Media (private R2 objects) ──
      const mediaMatch = path.match(/^\/media\/(.+)$/);
      if (mediaMatch && method === 'GET') return await handleMedia(request, env, mediaMatch[1]);

      // ── Everything else: static assets (index.html, test-console.html, etc.) ──
      if (env.ASSETS) return await env.ASSETS.fetch(request);

      return notFound();
    } catch (err) {
      return serverError(err);
    }
  },
};
