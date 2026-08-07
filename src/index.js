// src/index.js
// Single entry point required by Cloudflare Workers. Routes /api/* and
// /media/* to their handlers; anything else falls through to the static
// assets binding (index.html, test-console.html, etc.) configured in
// wrangler.toml under [assets].

import { handleSignup } from './routes/signup.js';
import { handleLogin } from './routes/login.js';
import { handleLogout } from './routes/logout.js';
import { handleMe } from './routes/me.js';
import { handleUpdateProfile } from './routes/update-profile.js';
import { handleUploadVoiceClip } from './routes/upload-voice-clip.js';
import { handleNotificationsGet, handleNotificationsPost } from './routes/notifications.js';
import { handleBleepsGet, handleBleepsPost, handleBleepsSimilar } from './routes/bleeps.js';
import { handleBleepDetailGet, handleBleepDetailDelete, handleBleepDetailPatch } from './routes/bleep-detail.js';
import { handleBleepCommentsGet, handleBleepCommentsPost } from './routes/bleep-comments.js';
import { handleCommentDetailDelete } from './routes/comment-detail.js';
import { handleBleepLikeToggle } from './routes/like.js';
import { handleFollowToggle, handleUserRelationship } from './routes/follow.js';
import { handleSearch } from './routes/search.js';
import {
  handleConversationsGet,
  handleConversationsPost,
  handleConversationMessagesGet,
  handleConversationMessagesPost,
  handleConversationReadPost,
} from './routes/conversations.js';
import { handleGoogleAuthStart, handleGoogleAuthCallback } from './routes/oauth-google.js';
import { handleAppleAuthStart, handleAppleAuthCallback } from './routes/oauth-apple.js';
import { handlePendingOAuthGet, handleCompleteOAuthSignup } from './routes/oauth-complete.js';
import {
  handleCalendarEventsGet,
  handleCalendarEventsPost,
  handleEventDetailGet,
  handleEventLikeToggle,
  handleEventCommentsGet,
  handleEventCommentsPost,
  handleVaultGet,
  handleVaultPost,
  handleVaultDelete,
} from './routes/calendar.js';
import {
  handleStoreItemsGet,
  handleStoreItemsPost,
  handleStoreItemDetailGet,
  handleOrderCreate,
  handleTipCreate,
} from './routes/store.js';
import { handleAiAssistPost } from './routes/ai.js';
import { handleEngagementEventsPost } from './routes/engagement.js';
import { handleAiSettingsGet, handleAiSettingsPost, handleAdminSuspendUser, handleAdminDeleteUser } from './routes/admin.js';
import { handleMedia } from './routes/media.js';
import { handleForgotPassword, handleResetPassword } from './routes/password-reset.js';
import { handleCheckHandle } from './routes/check-handle.js';
import { handleMentionSuggest } from './routes/mention-suggest.js';

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
      if (path === '/api/me' && method === 'PATCH') return await handleUpdateProfile(request, env);
      if (path === '/api/upload-voice-clip' && method === 'POST') return await handleUploadVoiceClip(request, env, ctx);
      if (path === '/api/auth/forgot-password' && method === 'POST') return await handleForgotPassword(request, env);
      if (path === '/api/auth/reset-password' && method === 'POST') return await handleResetPassword(request, env);
      if (path === '/api/check-handle' && method === 'GET') return await handleCheckHandle(request, env);
      if (path === '/api/mention-suggest' && method === 'GET') return await handleMentionSuggest(request, env);

      // ── Notifications ──
      if (path === '/api/notifications' && method === 'GET') return await handleNotificationsGet(request, env);
      if (path === '/api/notifications' && method === 'POST') return await handleNotificationsPost(request, env);

      // ── Bleeps ──
      if (path === '/api/bleeps' && method === 'GET') return await handleBleepsGet(request, env);
      if (path === '/api/bleeps' && method === 'POST') return await handleBleepsPost(request, env);
      if (path === '/api/bleeps/similar' && method === 'GET') return await handleBleepsSimilar(request, env);

      const bleepDetailMatch = path.match(/^\/api\/bleeps\/([^/]+)$/);
      if (bleepDetailMatch && method === 'GET') return await handleBleepDetailGet(request, env, bleepDetailMatch[1]);
      if (bleepDetailMatch && method === 'DELETE') return await handleBleepDetailDelete(request, env, bleepDetailMatch[1]);
      if (bleepDetailMatch && method === 'PATCH') return await handleBleepDetailPatch(request, env, bleepDetailMatch[1]);

      const bleepCommentsMatch = path.match(/^\/api\/bleeps\/([^/]+)\/comments$/);
      if (bleepCommentsMatch && method === 'GET') return await handleBleepCommentsGet(request, env, bleepCommentsMatch[1]);
      if (bleepCommentsMatch && method === 'POST') return await handleBleepCommentsPost(request, env, bleepCommentsMatch[1]);

      const bleepLikeMatch = path.match(/^\/api\/bleeps\/([^/]+)\/like$/);
      if (bleepLikeMatch && method === 'POST') return await handleBleepLikeToggle(request, env, bleepLikeMatch[1]);

      // ── Comments ──
      const commentDetailMatch = path.match(/^\/api\/comments\/([^/]+)$/);
      if (commentDetailMatch && method === 'DELETE') return await handleCommentDetailDelete(request, env, commentDetailMatch[1]);

      // ── Follows ──
      const followMatch = path.match(/^\/api\/users\/([^/]+)\/follow$/);
      if (followMatch && method === 'POST') return await handleFollowToggle(request, env, followMatch[1]);

      const relationshipMatch = path.match(/^\/api\/users\/([^/]+)\/relationship$/);
      if (relationshipMatch && method === 'GET') return await handleUserRelationship(request, env, relationshipMatch[1]);

      // ── Search ──
      if (path === '/api/search' && method === 'GET') return await handleSearch(request, env);

      // ── Direct Messages ──
      if (path === '/api/conversations' && method === 'GET') return await handleConversationsGet(request, env);
      if (path === '/api/conversations' && method === 'POST') return await handleConversationsPost(request, env);

      const convMessagesMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (convMessagesMatch && method === 'GET') return await handleConversationMessagesGet(request, env, convMessagesMatch[1]);
      if (convMessagesMatch && method === 'POST') return await handleConversationMessagesPost(request, env, convMessagesMatch[1]);

      const convReadMatch = path.match(/^\/api\/conversations\/([^/]+)\/read$/);
      if (convReadMatch && method === 'POST') return await handleConversationReadPost(request, env, convReadMatch[1]);

      // ── OAuth (Google / Apple) ──
      if (path === '/api/auth/google/start' && method === 'GET') return await handleGoogleAuthStart(request, env);
      if (path === '/api/auth/google/callback' && method === 'GET') return await handleGoogleAuthCallback(request, env);
      if (path === '/api/auth/apple/start' && method === 'GET') return await handleAppleAuthStart(request, env);
      if (path === '/api/auth/apple/callback' && method === 'POST') return await handleAppleAuthCallback(request, env);
      if (path === '/api/auth/pending' && method === 'GET') return await handlePendingOAuthGet(request, env);
      if (path === '/api/auth/complete' && method === 'POST') return await handleCompleteOAuthSignup(request, env);

      // ── Calendar: Events (public) ──
      if (path === '/api/calendar/events' && method === 'GET') return await handleCalendarEventsGet(request, env);
      if (path === '/api/calendar/events' && method === 'POST') return await handleCalendarEventsPost(request, env);

      const eventDetailMatch = path.match(/^\/api\/calendar\/events\/([^/]+)$/);
      if (eventDetailMatch && method === 'GET') return await handleEventDetailGet(request, env, eventDetailMatch[1]);

      const eventLikeMatch = path.match(/^\/api\/calendar\/events\/([^/]+)\/like$/);
      if (eventLikeMatch && method === 'POST') return await handleEventLikeToggle(request, env, eventLikeMatch[1]);

      const eventCommentsMatch = path.match(/^\/api\/calendar\/events\/([^/]+)\/comments$/);
      if (eventCommentsMatch && method === 'GET') return await handleEventCommentsGet(request, env, eventCommentsMatch[1]);
      if (eventCommentsMatch && method === 'POST') return await handleEventCommentsPost(request, env, eventCommentsMatch[1]);

      // ── Calendar: Vault (private) ──
      if (path === '/api/vault' && method === 'GET') return await handleVaultGet(request, env);
      if (path === '/api/vault' && method === 'POST') return await handleVaultPost(request, env);

      const vaultDeleteMatch = path.match(/^\/api\/vault\/([^/]+)$/);
      if (vaultDeleteMatch && method === 'DELETE') return await handleVaultDelete(request, env, vaultDeleteMatch[1]);

      // ── e-Store ──
      if (path === '/api/store/items' && method === 'GET') return await handleStoreItemsGet(request, env);
      if (path === '/api/store/items' && method === 'POST') return await handleStoreItemsPost(request, env);

      const storeItemDetailMatch = path.match(/^\/api\/store\/items\/([^/]+)$/);
      if (storeItemDetailMatch && method === 'GET') return await handleStoreItemDetailGet(request, env, storeItemDetailMatch[1]);

      if (path === '/api/orders' && method === 'POST') return await handleOrderCreate(request, env);
      if (path === '/api/tips' && method === 'POST') return await handleTipCreate(request, env);

      // ── AI Assist ──
      if (path === '/api/ai/assist-post' && method === 'POST') return await handleAiAssistPost(request, env);

      // ── Engagement instrumentation (groundwork, no ad engine attached) ──
      if (path === '/api/engagement/events' && method === 'POST') return await handleEngagementEventsPost(request, env);

      // ── Admin: AI provider settings ──
      if (path === '/api/admin/ai-settings' && method === 'GET') return await handleAiSettingsGet(request, env);
      if (path === '/api/admin/ai-settings' && method === 'POST') return await handleAiSettingsPost(request, env);

      const adminSuspendMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/suspend$/);
      if (adminSuspendMatch && method === 'POST') return await handleAdminSuspendUser(request, env, adminSuspendMatch[1]);

      const adminDeleteUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminDeleteUserMatch && method === 'DELETE') return await handleAdminDeleteUser(request, env, adminDeleteUserMatch[1]);

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
