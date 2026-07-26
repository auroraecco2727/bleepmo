// src/routes/ai.js
// POST /api/ai/assist-post -> suggests a headline + lightly tightened body
// from the user's current draft, using the Anthropic API.
//
// Requires a secret (wrangler secret put ANTHROPIC_API_KEY), not set yet.
// Get a key from console.anthropic.com. This call happens entirely
// server-side — the key must never be sent to the browser.

import { getSessionUser } from '../shared/auth.js';

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

  if (!env.ANTHROPIC_API_KEY) {
    return badRequest('AI Assist isn\'t configured yet — an ANTHROPIC_API_KEY secret is needed.', 503);
  }

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

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
  } catch (err) {
    return badRequest('Couldn\'t reach the AI service.', 502);
  }

  if (!anthropicRes.ok) {
    return badRequest('AI Assist failed to respond. Try again in a moment.', 502);
  }

  const data = await anthropicRes.json();
  const rawText = (data.content || [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  let parsed;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return badRequest('Got an unexpected response from AI Assist. Try again.', 502);
  }

  return ok({
    suggestedTitle: (parsed.suggestedTitle || '').toString(),
    suggestedBody: (parsed.suggestedBody || '').toString(),
  });
}
