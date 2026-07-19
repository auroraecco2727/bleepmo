// src/shared/oauth.js
// Shared plumbing for "Continue with Google" / "Continue with Apple":
//   - short-lived state/pending cookies (CSRF protection + carrying the
//     provider profile across the redirect while a new user picks a handle)
//   - Google authorization-code exchange + verified profile fetch
//   - Apple authorization-code exchange, including signing the ES256
//     "client secret" JWT Apple requires instead of a static secret

function base64url(bytes) {
  let str = '';
  if (typeof bytes === 'string') {
    str = btoa(bytes);
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + (4 - (b64url.length % 4)) % 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

export function shortCookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearShortCookie(name) {
  return `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

/** Build the absolute redirect_uri for a provider callback from the incoming request's own origin. */
export function redirectUriFor(request, provider) {
  const url = new URL(request.url);
  return `${url.origin}/api/auth/${provider}/callback`;
}

// ────────────────────────────────────────────────────────────
// Google
// ────────────────────────────────────────────────────────────

export function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode({ code, redirectUri, clientId, clientSecret }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Google token exchange failed: ' + (await res.text()));
  return res.json(); // { access_token, id_token, ... }
}

/**
 * Fetch the profile straight from Google's userinfo endpoint using the
 * access token — this is a direct authenticated call to Google, so unlike
 * decoding the id_token ourselves, it doesn't require us to also verify a
 * JWT signature to trust the result.
 */
export async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Google userinfo fetch failed: ' + (await res.text()));
  return res.json(); // { sub, email, email_verified, name, picture, ... }
}

// ────────────────────────────────────────────────────────────
// Apple
// ────────────────────────────────────────────────────────────

export function buildAppleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'name email',
    state,
    response_mode: 'form_post', // Apple POSTs back to redirectUri when requesting name/email
  });
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
}

/**
 * Apple doesn't accept a static client secret — it wants a short-lived
 * ES256-signed JWT, generated with your Apple Developer "Sign in with
 * Apple" private key (.p8 file), Key ID, and Team ID.
 */
export async function generateAppleClientSecret({ teamId, clientId, keyId, privateKeyPem }) {
  const header = { alg: 'ES256', kid: keyId };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 3600, // 1 hour — well under Apple's 6-month max, regenerated per request
    aud: 'https://appleid.apple.com',
    sub: clientId,
  };

  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;

  const pemBody = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const keyBytes = base64urlToBytes(pemBody.replace(/-/g, '+').replace(/_/g, '/'));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(signature)}`;
}

export async function exchangeAppleCode({ code, redirectUri, clientId, clientSecret }) {
  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Apple token exchange failed: ' + (await res.text()));
  return res.json(); // { access_token, id_token, ... }
}

/**
 * Decode (not cryptographically verify) the id_token payload. This is
 * received directly from Apple's token endpoint over a server-to-server
 * TLS call, not passed through the browser, so the transport itself is
 * the trust boundary here — same assumption the Google userinfo call
 * above makes. Full JWKS signature verification can be layered in later
 * if you want defense in depth.
 */
export function decodeIdTokenPayload(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');
  const json = new TextDecoder().decode(base64urlToBytes(parts[1]));
  return JSON.parse(json);
}

// ────────────────────────────────────────────────────────────
// Account matching — shared by both providers' callback handlers
// ────────────────────────────────────────────────────────────

const SUB_COLUMN = { google: 'google_sub', apple: 'apple_sub' };

export async function findUserByProviderSub(db, provider, sub) {
  const col = SUB_COLUMN[provider];
  return db.prepare(`SELECT * FROM users WHERE ${col} = ?`).bind(sub).first();
}

export async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first();
}

/** Link a provider sub onto an existing account found by email match. */
export async function linkProviderToUser(db, userId, provider, sub) {
  const col = SUB_COLUMN[provider];
  await db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(sub, userId).run();
}
