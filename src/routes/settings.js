// Account settings: profile identity, persisted preferences, and password changes.
import { getSessionUser, hashPassword, publicUser, verifyPassword } from '../shared/auth.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function ensureSettingsTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      in_app_notifications INTEGER NOT NULL DEFAULT 1,
      email_updates INTEGER NOT NULL DEFAULT 0,
      searchable INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();
}

async function settingsFor(db, userId) {
  await db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').bind(userId).run();
  return db.prepare('SELECT in_app_notifications, email_updates, searchable FROM user_settings WHERE user_id = ?').bind(userId).first();
}

function cleanHandle(value) {
  return String(value || '').trim();
}

function cleanName(value) {
  return String(value || '').trim();
}

const SHAPES = new Set(['circle', 'square', 'hex', 'star', 'triangle']);
const SYMBOLS = new Set(['@', '*', '~', '^', '>', '&']);

export async function handleSettingsGet(request, env) {
  if (!env.DB) return json({ error: 'DB binding not configured.' }, 500);
  const user = await getSessionUser(request, env.DB);
  if (!user) return json({ error: 'Not logged in.' }, 401);
  await ensureSettingsTable(env.DB);
  return json({ user: publicUser(user), settings: await settingsFor(env.DB, user.id) });
}

export async function handleSettingsPatch(request, env) {
  if (!env.DB) return json({ error: 'DB binding not configured.' }, 500);
  const user = await getSessionUser(request, env.DB);
  if (!user) return json({ error: 'Not logged in.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Expected JSON body.' }, 400); }
  await ensureSettingsTable(env.DB);
  // Existing accounts predate this table, so ensure an editable preference row
  // before a first-time preference save.
  await settingsFor(env.DB, user.id);

  if (body.action === 'profile') {
    const fullName = cleanName(body.fullName);
    const handle = cleanHandle(body.handle);
    const email = String(body.email || '').trim().toLowerCase();
    const handleSymbol = String(body.handleSymbol || '@').trim();
    const avatarShape = String(body.avatarShape || 'circle').trim();
    if (!fullName || fullName.length > 80) return json({ error: 'Choose a name up to 80 characters.' }, 400);
    if (!/^[A-Za-z0-9_]{2,30}$/.test(handle)) return json({ error: 'Your Bleepmo ID must be 2–30 letters, numbers, or underscores.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!SYMBOLS.has(handleSymbol) || !SHAPES.has(avatarShape)) return json({ error: 'That profile option is not valid.' }, 400);
    const taken = await env.DB.prepare('SELECT id FROM users WHERE (handle = ? OR email = ?) AND id != ?').bind(handle, email, user.id).first();
    if (taken) return json({ error: 'That Bleepmo ID or email is already in use.' }, 409);
    await env.DB.prepare('UPDATE users SET full_name = ?, handle = ?, email = ?, handle_symbol = ?, avatar_shape = ? WHERE id = ?')
      .bind(fullName, handle, email, handleSymbol, avatarShape, user.id).run();
  } else if (body.action === 'preferences') {
    await env.DB.prepare(
      `UPDATE user_settings SET in_app_notifications = ?, email_updates = ?, searchable = ?, updated_at = datetime('now') WHERE user_id = ?`
    ).bind(body.inAppNotifications ? 1 : 0, body.emailUpdates ? 1 : 0, body.searchable ? 1 : 0, user.id).run();
  } else if (body.action === 'password') {
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 8) return json({ error: 'Your new password must be at least 8 characters.' }, 400);
    if (!await verifyPassword(currentPassword, user.password_hash, user.password_salt)) return json({ error: 'Your current password is incorrect.' }, 401);
    const { hash, salt } = await hashPassword(newPassword);
    await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').bind(hash, salt, user.id).run();
  } else {
    return json({ error: 'Unknown settings update.' }, 400);
  }

  const refreshed = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return json({ user: publicUser(refreshed), settings: await settingsFor(env.DB, user.id) });
}
