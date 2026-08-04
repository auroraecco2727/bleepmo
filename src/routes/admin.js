// src/routes/admin.js
// GET  /api/admin/ai-settings  -> which providers are configured + current order
// POST /api/admin/ai-settings  -> save a new provider order (runtime toggle, no redeploy)
//
// Both routes require is_admin = 1 on the session user. There's no broader
// role system in Bleepmo yet — this is deliberately narrow (one flag, one
// use) rather than building out a general permissions system prematurely.

import { getSessionUser } from '../shared/auth.js';
import { getAiProviderStatus, setAiProviderOrder } from '../shared/ai-gateway.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function ok(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requireAdmin(request, env) {
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return { error: badRequest('Not logged in.', 401) };
  if (!viewer.is_admin) return { error: badRequest('Admin access required.', 403) };
  return { viewer };
}

export async function handleAiSettingsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const { error } = await requireAdmin(request, env);
  if (error) return error;

  const status = await getAiProviderStatus(env);
  return ok(status);
}

export async function handleAiSettingsPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const { error } = await requireAdmin(request, env);
  if (error) return error;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  if (!Array.isArray(payload.order) || payload.order.length === 0) {
    return badRequest('order must be a non-empty array, e.g. ["anthropic","openai"].');
  }

  try {
    const saved = await setAiProviderOrder(env, payload.order);
    return ok({ order: saved });
  } catch (err) {
    return badRequest(err.message || 'Couldn\'t save that.', 400);
  }
}

// POST /api/admin/users/:id/suspend  -> { suspend: true|false }
export async function handleAdminSuspendUser(request, env, targetUserId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const { error, viewer } = await requireAdmin(request, env);
  if (error) return error;

  if (targetUserId === viewer.id) return badRequest('You can\'t suspend your own account.', 400);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetUserId).first();
  if (!target) return badRequest('User not found.', 404);

  const suspend = payload.suspend !== false;
  await env.DB
    .prepare(`UPDATE users SET suspended_at = ? WHERE id = ?`)
    .bind(suspend ? new Date().toISOString() : null, targetUserId)
    .run();

  // Suspending kicks them out of any active sessions immediately, rather
  // than waiting for those sessions to naturally expire.
  if (suspend) {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetUserId).run();
  }

  return ok({ suspended: suspend });
}

// DELETE /api/admin/users/:id
export async function handleAdminDeleteUser(request, env, targetUserId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const { error, viewer } = await requireAdmin(request, env);
  if (error) return error;

  if (targetUserId === viewer.id) return badRequest('You can\'t delete your own account.', 400);

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetUserId).first();
  if (!target) return badRequest('User not found.', 404);

  // The schema's ON DELETE CASCADE constraints handle everything else this
  // account touches — bleeps, follows, likes, comments, conversations,
  // sessions, store items, and so on.
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetUserId).run();

  return ok({ deleted: true });
}
