// src/routes/engagement.js
// POST /api/engagement/events -> accepts a BATCH of passive engagement
// events and bulk-inserts them. Designed to be called rarely (client-side
// batches and flushes every ~10s or on page hide), not once per micro-event.
//
// Deliberately lenient: malformed individual events are skipped rather than
// failing the whole batch, and any DB error is swallowed rather than shown
// to the user — this is background instrumentation, not a user-facing
// feature, and should never be able to break the app or surface an error.

import { getSessionUser, newId } from '../shared/auth.js';

export async function handleEngagementEventsPost(request, env) {
  if (!env.DB) return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const events = Array.isArray(payload.events) ? payload.events.slice(0, 100) : [];
  let inserted = 0;

  for (const e of events) {
    const eventType = (e && e.eventType || '').toString().trim();
    if (!eventType) continue;
    const contentType = e.contentType ? e.contentType.toString() : null;
    const contentId = e.contentId ? e.contentId.toString() : null;
    const valueMs = Number.isFinite(e.valueMs) ? Math.round(e.valueMs) : null;
    let metadata = null;
    if (e.metadata && typeof e.metadata === 'object') {
      try { metadata = JSON.stringify(e.metadata).slice(0, 2000); } catch { metadata = null; }
    }

    try {
      await env.DB
        .prepare(
          `INSERT INTO engagement_events (id, user_id, event_type, content_type, content_id, value_ms, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(newId(), viewer.id, eventType, contentType, contentId, valueMs, metadata)
        .run();
      inserted++;
    } catch {
      // Skip this one, keep processing the rest of the batch.
      continue;
    }
  }

  return new Response(JSON.stringify({ ok: true, inserted }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
