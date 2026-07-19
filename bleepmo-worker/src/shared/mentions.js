// functions/_shared/mentions.js
// Parses @, *, ~, ^, >, & mentions out of text, resolves them against real
// users, and writes tag + notification rows. Shared by bleeps and comments
// so caption tags and comment tags behave identically.

import { newId } from './auth.js';

const MENTION_SYMBOLS = ['@', '*', '~', '^', '>', '&'];
const ESCAPED_SYMBOLS = MENTION_SYMBOLS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');

// Matches one of the six symbols followed by 2-30 handle characters, as
// long as it's not glued to the middle of another word (e.g. "email@x.com"
// shouldn't trigger a mention).
const MENTION_REGEX = new RegExp('(?:^|[^A-Za-z0-9_])([' + ESCAPED_SYMBOLS + '])([A-Za-z0-9_]{2,30})', 'g');

export function extractMentions(text) {
  if (!text) return [];
  const found = [];
  const seen = new Set();
  let match;
  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const symbol = match[1];
    const handle = match[2];
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ symbol, handle });
  }
  return found;
}

/**
 * Resolves parsed mentions against real users and writes tags +
 * notifications. Unknown handles are silently skipped — a typo in a
 * mention should never fail the whole post/comment.
 *
 * Returns the list of tags actually created.
 */
export async function applyMentions(db, { text, contentType, contentId, taggerUserId }) {
  const mentions = extractMentions(text);
  if (mentions.length === 0) return [];

  const applied = [];
  for (const { symbol, handle } of mentions) {
    const user = await db
      .prepare('SELECT id FROM users WHERE handle = ? COLLATE NOCASE')
      .bind(handle)
      .first();
    if (!user) continue;            // no such handle — skip quietly
    if (user.id === taggerUserId) continue; // no self-tag notifications

    const tagId = newId();
    await db
      .prepare(
        `INSERT INTO tags (id, content_type, content_id, tagged_user_id, tagged_by_user_id, symbol_used, position_type, approved)
         VALUES (?, ?, ?, ?, ?, ?, 'inline', 0)`
      )
      .bind(tagId, contentType, contentId, user.id, taggerUserId, symbol)
      .run();

    const notifId = newId();
    await db
      .prepare(
        `INSERT INTO notifications (id, user_id, type, actor_id, source_type, source_id)
         VALUES (?, ?, 'tag', ?, ?, ?)`
      )
      .bind(notifId, user.id, taggerUserId, contentType, contentId)
      .run();

    applied.push({ tagId, userId: user.id, symbol });
  }
  return applied;
}
