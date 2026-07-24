// src/routes/calendar.js
// GET/POST  /api/calendar/events              -> list (by month) / create an Event
// GET       /api/calendar/events/:id          -> single Event detail
// POST      /api/calendar/events/:id/like     -> toggle like
// GET/POST  /api/calendar/events/:id/comments -> threaded comments (reuses the generic comments table)
// GET/POST  /api/vault                        -> list (by month) / create a private Vault entry
// DELETE    /api/vault/:id                    -> remove a Vault entry (owner only)

import { getSessionUser, newId } from '../shared/auth.js';
import { applyMentions } from '../shared/mentions.js';

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

function monthBounds(monthParam) {
  // monthParam like '2026-07' -> ['2026-07-01', '2026-08-01') as a half-open range
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam || '');
  const now = new Date();
  const year = m ? parseInt(m[1], 10) : now.getUTCFullYear();
  const month = m ? parseInt(m[2], 10) : now.getUTCMonth() + 1;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end };
}

// ────────────────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────────────────

export async function handleCalendarEventsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const url = new URL(request.url);
  const { start, end } = monthBounds(url.searchParams.get('month'));

  // Visible events: your own, plus anyone you follow.
  const { results } = await env.DB
    .prepare(
      `SELECT e.id, e.author_id, e.title, e.description, e.event_date, e.event_time, e.location, e.created_at,
              u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key,
              (SELECT COUNT(*) FROM event_likes el WHERE el.event_id = e.id) AS like_count,
              EXISTS(SELECT 1 FROM event_likes el2 WHERE el2.event_id = e.id AND el2.user_id = ?) AS liked_by_viewer,
              (SELECT COUNT(*) FROM comments c WHERE c.content_type = 'calendar_event' AND c.content_id = e.id AND c.hidden_at IS NULL) AS comment_count
       FROM calendar_events e
       JOIN users u ON u.id = e.author_id
       WHERE e.deleted_at IS NULL
         AND e.event_date >= ? AND e.event_date < ?
         AND (e.author_id = ? OR e.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
       ORDER BY e.event_date ASC, e.event_time ASC`
    )
    .bind(viewer.id, start, end, viewer.id, viewer.id)
    .all();

  return ok({ events: results.map((e) => ({ ...e, liked_by_viewer: !!e.liked_by_viewer })) });
}

export async function handleCalendarEventsPost(request, env) {
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
  const eventDate = (payload.eventDate || '').toString().trim();
  if (!title) return badRequest('Give your event a title.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return badRequest('eventDate must be YYYY-MM-DD.');

  const description = (payload.description || '').toString().trim() || null;
  const eventTime = (payload.eventTime || '').toString().trim() || null;
  const location = (payload.location || '').toString().trim() || null;

  const id = newId();
  await env.DB
    .prepare(
      `INSERT INTO calendar_events (id, author_id, title, description, event_date, event_time, location)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, viewer.id, title, description, eventDate, eventTime, location)
    .run();

  const event = await env.DB
    .prepare(
      `SELECT e.*, u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM calendar_events e JOIN users u ON u.id = e.author_id WHERE e.id = ?`
    )
    .bind(id)
    .first();

  return ok({ event: { ...event, like_count: 0, liked_by_viewer: false, comment_count: 0 } }, 201);
}

export async function handleEventDetailGet(request, env, eventId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const event = await env.DB
    .prepare(
      `SELECT e.id, e.author_id, e.title, e.description, e.event_date, e.event_time, e.location, e.created_at,
              u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key,
              (SELECT COUNT(*) FROM event_likes el WHERE el.event_id = e.id) AS like_count,
              EXISTS(SELECT 1 FROM event_likes el2 WHERE el2.event_id = e.id AND el2.user_id = ?) AS liked_by_viewer,
              (SELECT COUNT(*) FROM comments c WHERE c.content_type = 'calendar_event' AND c.content_id = e.id AND c.hidden_at IS NULL) AS comment_count
       FROM calendar_events e JOIN users u ON u.id = e.author_id
       WHERE e.id = ? AND e.deleted_at IS NULL`
    )
    .bind(viewer.id, eventId)
    .first();

  if (!event) return badRequest('Event not found.', 404);
  return ok({ event: { ...event, liked_by_viewer: !!event.liked_by_viewer } });
}

export async function handleEventLikeToggle(request, env, eventId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const event = await env.DB.prepare('SELECT id, author_id FROM calendar_events WHERE id = ? AND deleted_at IS NULL').bind(eventId).first();
  if (!event) return badRequest('Event not found.', 404);

  const existing = await env.DB.prepare('SELECT 1 FROM event_likes WHERE event_id = ? AND user_id = ?').bind(eventId, viewer.id).first();
  let liked;
  if (existing) {
    await env.DB.prepare('DELETE FROM event_likes WHERE event_id = ? AND user_id = ?').bind(eventId, viewer.id).run();
    liked = false;
  } else {
    await env.DB.prepare('INSERT INTO event_likes (event_id, user_id) VALUES (?, ?)').bind(eventId, viewer.id).run();
    liked = true;
    if (event.author_id !== viewer.id) {
      await env.DB
        .prepare(
          `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
           VALUES (?, ?, 'like', ?, 'calendar_event', ?)`
        )
        .bind(newId(), event.author_id, viewer.id, eventId)
        .run();
    }
  }

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM event_likes WHERE event_id = ?').bind(eventId).first();
  return ok({ liked, likeCount: countRow ? countRow.n : 0 });
}

export async function handleEventCommentsGet(request, env, eventId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const { results } = await env.DB
    .prepare(
      `SELECT c.id, c.parent_comment_id, c.body, c.created_at, c.edited_at,
              u.id AS author_id, u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.content_type = 'calendar_event' AND c.content_id = ? AND c.hidden_at IS NULL
       ORDER BY c.created_at ASC`
    )
    .bind(eventId)
    .all();

  return ok({ comments: results });
}

export async function handleEventCommentsPost(request, env, eventId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const event = await env.DB.prepare('SELECT id, author_id FROM calendar_events WHERE id = ? AND deleted_at IS NULL').bind(eventId).first();
  if (!event) return badRequest('Event not found.', 404);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const body = (payload.body || '').toString().trim();
  if (!body) return badRequest('Comment can\'t be empty.');
  const parentCommentId = payload.parentCommentId ? payload.parentCommentId.toString() : null;

  const id = newId();
  await env.DB
    .prepare(
      `INSERT INTO comments (id, content_type, content_id, author_id, parent_comment_id, body)
       VALUES (?, 'calendar_event', ?, ?, ?, ?)`
    )
    .bind(id, eventId, viewer.id, parentCommentId, body)
    .run();

  if (event.author_id !== viewer.id) {
    await env.DB
      .prepare(
        `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
         VALUES (?, ?, 'comment', ?, 'calendar_event', ?)`
      )
      .bind(newId(), event.author_id, viewer.id, eventId)
      .run();
  }

  try {
    await applyMentions(env.DB, { text: body, contentType: 'calendar_event', contentId: eventId, taggerUserId: viewer.id });
  } catch { /* mentions are best-effort */ }

  const comment = await env.DB
    .prepare(
      `SELECT c.id, c.parent_comment_id, c.body, c.created_at,
              u.id AS author_id, u.full_name, u.handle_symbol, u.handle, u.avatar_shape, u.main_pic_key, u.icon_pic_key
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`
    )
    .bind(id)
    .first();

  return ok({ comment }, 201);
}

// ────────────────────────────────────────────────────────────
// Vault — private, own-eyes-only
// ────────────────────────────────────────────────────────────

export async function handleVaultGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const url = new URL(request.url);
  const { start, end } = monthBounds(url.searchParams.get('month'));

  const { results } = await env.DB
    .prepare(
      `SELECT v.id, v.entry_date, v.reference_type, v.reference_url, v.key_takeaway, v.created_at,
              b.id AS bleep_id, b.content_type AS bleep_content_type, b.title AS bleep_title, b.body AS bleep_body, b.media_key AS bleep_media_key,
              bu.handle_symbol AS bleep_handle_symbol, bu.handle AS bleep_handle
       FROM vault_entries v
       LEFT JOIN bleeps b ON b.id = v.referenced_bleep_id
       LEFT JOIN users bu ON bu.id = b.author_id
       WHERE v.user_id = ? AND v.entry_date >= ? AND v.entry_date < ?
       ORDER BY v.entry_date ASC, v.created_at ASC`
    )
    .bind(viewer.id, start, end)
    .all();

  return ok({ vaultEntries: results });
}

export async function handleVaultPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const entryDate = (payload.entryDate || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return badRequest('entryDate must be YYYY-MM-DD.');

  const keyTakeaway = (payload.keyTakeaway || '').toString().trim();
  if (!keyTakeaway) return badRequest('Add a key takeaway explaining why this is significant.');

  const referenceType = payload.referencedBleepId ? 'bleep' : 'link';
  let referenceUrl = null;
  let referencedBleepId = null;

  if (referenceType === 'bleep') {
    referencedBleepId = payload.referencedBleepId.toString();
    const bleep = await env.DB.prepare('SELECT id FROM bleeps WHERE id = ? AND deleted_at IS NULL').bind(referencedBleepId).first();
    if (!bleep) return badRequest('That Bleep/Flick couldn\'t be found.', 404);
  } else {
    referenceUrl = (payload.referenceUrl || '').toString().trim();
    if (!referenceUrl) return badRequest('Add a link, or reference a Bleep/Flick instead.');
  }

  const id = newId();
  await env.DB
    .prepare(
      `INSERT INTO vault_entries (id, user_id, entry_date, reference_type, reference_url, referenced_bleep_id, key_takeaway)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, viewer.id, entryDate, referenceType, referenceUrl, referencedBleepId, keyTakeaway)
    .run();

  const entry = await env.DB.prepare('SELECT * FROM vault_entries WHERE id = ?').bind(id).first();
  return ok({ vaultEntry: entry }, 201);
}

export async function handleVaultDelete(request, env, vaultId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const entry = await env.DB.prepare('SELECT id FROM vault_entries WHERE id = ? AND user_id = ?').bind(vaultId, viewer.id).first();
  if (!entry) return badRequest('Vault entry not found.', 404);

  await env.DB.prepare('DELETE FROM vault_entries WHERE id = ?').bind(vaultId).run();
  return ok({ ok: true });
}
