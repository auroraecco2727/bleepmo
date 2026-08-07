// src/routes/ai.js
// POST /api/ai/assist-post -> suggests a headline + lightly tightened body
// from the user's current draft, via the shared AI gateway (tries every
// configured provider in order — see src/shared/ai-gateway.js). Not set
// up yet in this environment; needs at least one of ANTHROPIC_API_KEY /
// OPENAI_API_KEY / GOOGLE_AI_API_KEY.

import { getSessionUser } from '../shared/auth.js';
import { callAiGateway } from '../shared/ai-gateway.js';

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

const SYSTEM_PROMPT = `You help Bleepmo users polish a short social post before they publish it.
Given their draft title (may be empty) and body, respond with STRICT JSON only,
no markdown fences, no commentary, in this exact shape:
{"suggestedTitle": "...", "suggestedBody": "..."}

Rules:
- suggestedTitle: a short, punchy headline (under 60 characters). If their body
  doesn't clearly support a headline, return an empty string for this field
  rather than inventing an unrelated one.
- suggestedBody: a lightly tightened version of their body text — same meaning,
  same voice, same claims. Fix awkward phrasing and trim filler. Do NOT add
  facts, statistics, or claims that aren't already in their draft. Do NOT
  change their opinion or add commentary of your own. If their draft is
  already clear and tight, you can return it close to unchanged.
- Never fabricate specifics (numbers, names, events) that weren't in the draft.`;

export async function handleAiAssistPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const title = (payload.title || '').toString().trim();
  const body = (payload.body || '').toString().trim();
  if (!body) return badRequest('Write a little something first — there\'s nothing to work with yet.');

  const userMessage = `Draft title: ${title || '(none)'}\nDraft body: ${body}`;

  let text;
  try {
    const result = await callAiGateway(env, { systemPrompt: SYSTEM_PROMPT, userMessage, maxTokens: 400 });
    text = result.text;
  } catch (err) {
    // callAiGateway's own error message already distinguishes "nothing
    // configured" from "every configured provider failed" — surface it
    // as-is rather than flattening both into one generic message.
    return badRequest(err.message || 'AI Assist isn\'t available right now.', 503);
  }

  let parsed;
  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return badRequest('Got an unexpected response from AI Assist. Try again.', 502);
  }

  return ok({
    suggestedTitle: (parsed.suggestedTitle || '').toString(),
    suggestedBody: (parsed.suggestedBody || '').toString(),
  });
}

