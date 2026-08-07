// src/routes/notifications.js
import { getSessionUser } from '../shared/auth.js';

function badRequest(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleNotificationsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  const { results } = await env.DB
    .prepare(
      `SELECT n.id, n.type, n.source_type, n.source_id, n.read_at, n.created_at,
              a.id AS actor_id, a.full_name AS actor_name, a.handle_symbol AS actor_symbol, a.handle AS actor_handle,
              t.amount_cents AS tip_amount_cents, t.message AS tip_message,
              b.recommended_merch AS bleep_recommended_merch,
              (SELECT GROUP_CONCAT(tp.topic) FROM trend_points tp WHERE tp.bleep_id = b.id) AS bleep_topics
       FROM notifications n
       JOIN users a ON a.id = n.actor_id
       LEFT JOIN tips t ON n.type = 'tip' AND t.id = n.source_id
       LEFT JOIN bleeps b ON n.source_type = 'bleep' AND b.id = n.source_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`
    )
    .bind(user.id)
    .all();

  // Same classification the feed cards use (cardCategory() in
  // public/index.html) — kept independent rather than shared, since one
  // is a DB row shape and the other a rendered-card shape, but the actual
  // matching rule (local beats interest, both need the bleep's own
  // trend-points) is identical on purpose. Notifications without a
  // resolvable bleep (follows, comments, tips) just get category: null —
  // the bell has nothing content-colored to say about those, honestly.
  let subscribed = [];
  if (user.subscribed_trend_points) {
    try { subscribed = JSON.parse(user.subscribed_trend_points); } catch { subscribed = []; }
    if (!Array.isArray(subscribed)) subscribed = [];
  }
  const subscribedSet = new Set(subscribed.map((s) => String(s).toLowerCase()));
  const locSlug = user.location_anchor ? String(user.location_anchor).toLowerCase() : null;

  const notifications = results.map((n) => {
    let category = null;
    if (n.bleep_recommended_merch) {
      category = 'commerce';
    } else if (n.bleep_topics) {
      const topics = n.bleep_topics.split(',').map((t) => t.toLowerCase());
      if (locSlug && topics.includes(locSlug)) category = 'local';
      else if (topics.some((t) => subscribedSet.has(t))) category = 'interest';
    }
    const { bleep_recommended_merch, bleep_topics, ...rest } = n;
    return { ...rest, category };
  });

  return new Response(JSON.stringify({ notifications }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleNotificationsPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  const user = await getSessionUser(request, env.DB);
  if (!user) return badRequest('Not logged in.', 401);

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // no body is fine, treat as markAllRead
  }

  if (payload.markAllRead) {
    await env.DB
      .prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`)
      .bind(user.id)
      .run();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
