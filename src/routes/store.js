// src/routes/store.js
// GET/POST  /api/store/items          -> list (by category/owner) / create a store item
// GET       /api/store/items/:id      -> single item detail
// POST      /api/orders               -> placeholder "checkout" (no real payment yet — see note below)
// POST      /api/tips                 -> placeholder tip/gift (same caveat)
//
// IMPORTANT: orders/tips here are demo placeholders. No card data is ever
// collected or stored by this backend — that's a deliberate, permanent rule,
// not just a "not built yet" gap. When real payments are wired in, this
// should call Stripe Checkout (hosted page) or Stripe Elements, and these
// endpoints should create a Stripe session rather than an instantly-"paid"
// row. Status stays 'demo_placeholder' until that's in place.
//
// ACCESS NOTE: category access control is intentionally loose right now
// (any logged-in user can create any category of item). Before this goes
// out to real users with real money, 'platform_upgrade' and 'bleepmo_gear'
// creation should be restricted to an admin, not any authenticated user.

import { getSessionUser, newId } from '../shared/auth.js';

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

const VALID_CATEGORIES = ['platform_upgrade', 'creator_merch', 'bleepmo_gear'];

// ────────────────────────────────────────────────────────────
// Contextual Merch Algorithm
// ────────────────────────────────────────────────────────────

/**
 * Given a list of topic strings (e.g. a page of Bleeps' trend_points),
 * returns a Map of topic -> best-matching active store_item, in a single
 * batched query rather than one query per post. "Best match" here is just
 * "most recently created active item whose tags contain this topic" —
 * simple and predictable, not a ranking model.
 */
export async function getRecommendedMerchForTopics(db, topics) {
  const clean = [...new Set(topics.filter(Boolean))];
  const map = new Map();
  if (clean.length === 0) return map;

  const clauses = clean.map(() => 'tags LIKE ?').join(' OR ');
  const binds = clean.map((t) => '%' + t + '%');

  const { results } = await db
    .prepare(
      `SELECT id, owner_id, category, title, description, price_cents, currency, image_key, tags
       FROM store_items
       WHERE is_active = 1 AND (${clauses})
       ORDER BY created_at DESC`
    )
    .bind(...binds)
    .all();

  // Assign each topic its first (most recent) matching item.
  for (const topic of clean) {
    const match = results.find((item) => (item.tags || '').toLowerCase().includes(topic.toLowerCase()));
    if (match) map.set(topic, match);
  }
  return map;
}

/** Single-post convenience wrapper around the batched version above. */
export async function getRecommendedMerch(db, postContent, tags) {
  const topics = (tags || []).length ? tags : [];
  if (topics.length === 0 && postContent) {
    // Very light fallback: no trend tags on this post, so there's nothing
    // reliable to match against. Deliberately not doing free-text keyword
    // scanning of postContent here — that's a much fuzzier, noisier match
    // and better left for a future pass than guessed at now.
    return null;
  }
  const map = await getRecommendedMerchForTopics(db, topics);
  for (const topic of topics) {
    if (map.has(topic)) return map.get(topic);
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Store items
// ────────────────────────────────────────────────────────────

export async function handleStoreItemsGet(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const owner = url.searchParams.get('owner');

  let query = 'SELECT * FROM store_items WHERE is_active = 1';
  const binds = [];
  if (category) {
    query += ' AND category = ?';
    binds.push(category);
  }
  if (owner) {
    query += ' AND owner_id = ?';
    binds.push(owner);
  }
  query += ' ORDER BY created_at DESC LIMIT 100';

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return ok({ items: results });
}

export async function handleStoreItemDetailGet(request, env, itemId) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  const item = await env.DB.prepare('SELECT * FROM store_items WHERE id = ? AND is_active = 1').bind(itemId).first();
  if (!item) return badRequest('Item not found.', 404);
  return ok({ item });
}

export async function handleStoreItemsPost(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const category = (payload.category || '').toString();
  if (!VALID_CATEGORIES.includes(category)) {
    return badRequest('category must be one of: ' + VALID_CATEGORIES.join(', '));
  }
  const title = (payload.title || '').toString().trim();
  if (!title) return badRequest('Give the item a title.');
  const priceCents = parseInt(payload.priceCents, 10);
  if (!Number.isFinite(priceCents) || priceCents < 0) return badRequest('priceCents must be a non-negative number.');

  if (category === 'creator_merch' && !viewer.has_store) {
    return badRequest('Your account doesn\'t have storefront access yet.', 403);
  }

  const ownerId = category === 'creator_merch' ? viewer.id : null;
  const description = (payload.description || '').toString().trim() || null;
  const tags = (payload.tags || '').toString().trim().toLowerCase() || null;
  // Only platform-authored items (no owner) can be configured to grant
  // storefront access — a creator selling their own merch shouldn't be able
  // to hand out storefront access to buyers.
  const grantsStoreAccess = ownerId === null && payload.grantsStoreAccess ? 1 : 0;

  const id = newId();
  await env.DB
    .prepare(
      `INSERT INTO store_items (id, owner_id, category, title, description, price_cents, currency, tags, grants_store_access)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, ownerId, category, title, description, priceCents, (payload.currency || 'usd').toString(), tags, grantsStoreAccess)
    .run();

  const item = await env.DB.prepare('SELECT * FROM store_items WHERE id = ?').bind(id).first();
  return ok({ item }, 201);
}

// ────────────────────────────────────────────────────────────
// Orders & Tips — placeholder/demo only, see file header note
// ────────────────────────────────────────────────────────────

export async function handleOrderCreate(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const storeItemId = (payload.storeItemId || '').toString();
  const item = await env.DB.prepare('SELECT * FROM store_items WHERE id = ? AND is_active = 1').bind(storeItemId).first();
  if (!item) return badRequest('Item not found.', 404);

  const id = newId();
  await env.DB
    .prepare(
      `INSERT INTO orders (id, buyer_id, store_item_id, price_cents, currency, status)
       VALUES (?, ?, ?, ?, ?, 'demo_placeholder')`
    )
    .bind(id, viewer.id, storeItemId, item.price_cents, item.currency)
    .run();

  let storeAccessGranted = false;
  if (item.grants_store_access && !viewer.has_store) {
    await env.DB.prepare('UPDATE users SET has_store = 1 WHERE id = ?').bind(viewer.id).run();
    storeAccessGranted = true;
  }

  return ok({
    order: { id, storeItemId, priceCents: item.price_cents, currency: item.currency, status: 'demo_placeholder' },
    storeAccessGranted,
    note: 'No real payment was processed — checkout is a placeholder until Stripe is connected.',
  }, 201);
}

export async function handleTipCreate(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);
  const viewer = await getSessionUser(request, env.DB);
  if (!viewer) return badRequest('Not logged in.', 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const recipientId = (payload.recipientId || '').toString();
  if (!recipientId) return badRequest('recipientId is required.');
  if (recipientId === viewer.id) return badRequest('You can\'t tip yourself.');

  const recipient = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(recipientId).first();
  if (!recipient) return badRequest('That user doesn\'t exist.', 404);

  const amountCents = parseInt(payload.amountCents, 10);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return badRequest('amountCents must be a positive number.');

  const id = newId();
  await env.DB
    .prepare(
      `INSERT INTO tips (id, sender_id, recipient_id, amount_cents, currency, message, source_type, source_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo_placeholder')`
    )
    .bind(
      id,
      viewer.id,
      recipientId,
      amountCents,
      (payload.currency || 'usd').toString(),
      (payload.message || '').toString().trim() || null,
      (payload.sourceType || '').toString() || null,
      (payload.sourceId || '').toString() || null
    )
    .run();

  await env.DB
    .prepare(
      `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
       VALUES (?, ?, 'tip', ?, 'tip', ?)`
    )
    .bind(newId(), recipientId, viewer.id, id)
    .run();

  return ok({
    tip: { id, recipientId, amountCents, status: 'demo_placeholder' },
    note: 'No real payment was processed — tipping is a placeholder until Stripe is connected.',
  }, 201);
}
