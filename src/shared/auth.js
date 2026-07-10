// shared/auth.js
// Password hashing (PBKDF2 via Web Crypto — no external deps, works natively
// in the Cloudflare Workers/Pages Functions runtime) + session helpers.

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

const PBKDF2_ITERATIONS = 100000;

/**
 * Hash a plaintext password. If saltHex is omitted, a new random salt is
 * generated (use this path on signup). Pass the stored saltHex back in on
 * login to verify against it.
 */
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(password, storedHash, storedSaltHex) {
  const { hash } = await hashPassword(password, storedSaltHex);
  // Constant-time-ish comparison
  if (hash.length !== storedHash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hash.length; i++) {
    mismatch |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return mismatch === 0;
}

export function newId() {
  return crypto.randomUUID();
}

export function newSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

const SESSION_TTL_DAYS = 30;

export async function createSession(db, userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt)
    .run();
  return { token, expiresAt };
}

export function sessionCookie(token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  // Secure + HttpOnly + SameSite=Lax keeps this out of reach of JS/XSS and
  // off third-party requests, while still working for normal navigation.
  return `session=${token}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Resolves the current request's session token to a user row, or null.
 * Also lazily deletes expired sessions.
 */
export async function getSessionUser(request, db) {
  const token = readCookie(request, 'session');
  if (!token) return null;

  const session = await db
    .prepare('SELECT * FROM sessions WHERE token = ?')
    .bind(token)
    .first();

  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }

  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(session.user_id)
    .first();

  return user || null;
}

/** Strip fields that should never leave the server. */
export function publicUser(user) {
  if (!user) return null;
  const { password_hash, password_salt, ...safe } = user;
  return safe;
}
