// src/shared/ai-gateway.js
//
// A single entry point — callAiGateway() — that every AI feature in Bleepmo
// should call through, instead of hitting a provider's API directly. Adding
// a new feature that needs AI, or switching which provider handles it,
// should never require touching more than this file plus config.
//
// Providers are tried in order (AI_PROVIDER_ORDER), skipping any without a
// configured API key, and falling through to the next on failure. This
// means: if Anthropic has an outage, or you remove its key and add OpenAI's,
// nothing in ai.js (or any future caller) needs to change.
//
// Configuration (wrangler.toml [vars] + secrets):
//   AI_PROVIDER_ORDER = "anthropic,openai,google"   (plain var, has a default)
//   ANTHROPIC_API_KEY   (secret)   ANTHROPIC_MODEL  (optional var, has a default)
//   OPENAI_API_KEY      (secret)   OPENAI_MODEL     (optional var, has a default)
//   GOOGLE_AI_API_KEY   (secret)   GOOGLE_MODEL     (optional var, has a default)

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
};

// NOTE on model defaults: these are reasonable choices as of this writing,
// but AI providers ship new model names faster than this code will get
// revisited. Override any of them at any time via ANTHROPIC_MODEL /
// OPENAI_MODEL / GOOGLE_MODEL vars in wrangler.toml — no code change needed.

function isConfigured(env, provider) {
  if (provider === 'anthropic') return !!env.ANTHROPIC_API_KEY;
  if (provider === 'openai') return !!env.OPENAI_API_KEY;
  if (provider === 'google') return !!env.GOOGLE_AI_API_KEY;
  return false;
}

function modelFor(env, provider) {
  if (provider === 'anthropic') return env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
  if (provider === 'openai') return env.OPENAI_MODEL || DEFAULT_MODELS.openai;
  if (provider === 'google') return env.GOOGLE_MODEL || DEFAULT_MODELS.google;
  return null;
}

async function callAnthropic(env, { systemPrompt, userMessage, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelFor(env, 'anthropic'),
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error('Anthropic API error: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  return (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

async function callOpenAi(env, { systemPrompt, userMessage, maxTokens }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.OPENAI_API_KEY,
    },
    body: JSON.stringify({
      model: modelFor(env, 'openai'),
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!res.ok) throw new Error('OpenAI API error: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  return ((data.choices || [])[0] || {}).message?.content?.trim() || '';
}

async function callGoogle(env, { systemPrompt, userMessage, maxTokens }) {
  const model = modelFor(env, 'google');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_AI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) throw new Error('Google AI API error: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  const candidate = (data.candidates || [])[0];
  const parts = candidate?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

const ADAPTERS = { anthropic: callAnthropic, openai: callOpenAi, google: callGoogle };
const KNOWN_PROVIDERS = Object.keys(ADAPTERS);

/**
 * Provider order is DB-backed (app_settings table) so it can be changed from
 * an admin UI at runtime — no redeploy, no touching wrangler.toml. Falls
 * back to the AI_PROVIDER_ORDER var (and then a hardcoded default) if no
 * DB setting has been saved yet.
 */
async function resolveProviderOrder(env) {
  let raw = null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'ai_provider_order'").first();
      if (row) raw = row.value;
    } catch {
      // app_settings may not exist yet on a fresh/un-migrated DB — fall through.
    }
  }
  if (!raw) raw = env.AI_PROVIDER_ORDER || 'anthropic';

  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((p) => KNOWN_PROVIDERS.includes(p));
  return parsed.length ? parsed : ['anthropic'];
}

/**
 * Call through the gateway. Tries each provider in the resolved order
 * (skipping any without an API key configured), falling through to the next
 * on failure. Returns { text, providerUsed }. Throws only if every provider
 * in the order is either unconfigured or failed.
 */
export async function callAiGateway(env, { systemPrompt, userMessage, maxTokens = 500, preferredProvider }) {
  let order = await resolveProviderOrder(env);
  if (preferredProvider) {
    order = [preferredProvider, ...order.filter((p) => p !== preferredProvider)];
  }

  const attempted = [];
  for (const provider of order) {
    if (!isConfigured(env, provider)) continue;
    attempted.push(provider);
    try {
      const text = await ADAPTERS[provider](env, { systemPrompt, userMessage, maxTokens });
      return { text, providerUsed: provider };
    } catch (err) {
      // Try the next configured provider rather than failing the whole request.
      continue;
    }
  }

  if (attempted.length === 0) {
    throw new Error('No AI provider is configured. Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY.');
  }
  throw new Error('All configured AI providers failed (' + attempted.join(', ') + ').');
}

/** For the admin settings UI: which providers have a key configured, their current model, and the active order — never exposes key values. */
export async function getAiProviderStatus(env) {
  const order = await resolveProviderOrder(env);
  return {
    order,
    providers: KNOWN_PROVIDERS.map((p) => ({ provider: p, configured: isConfigured(env, p), model: modelFor(env, p) })),
  };
}

/** For the admin settings UI: save a new provider order to the DB (runtime toggle, no redeploy). */
export async function setAiProviderOrder(env, orderArray) {
  const cleaned = (orderArray || [])
    .map((p) => (p || '').toString().trim().toLowerCase())
    .filter((p) => KNOWN_PROVIDERS.includes(p));
  if (!cleaned.length) throw new Error('Provide at least one valid provider: ' + KNOWN_PROVIDERS.join(', '));
  await env.DB
    .prepare("INSERT INTO app_settings (key, value) VALUES ('ai_provider_order', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(cleaned.join(','))
    .run();
  return cleaned;
}
