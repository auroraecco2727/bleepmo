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
