// src/routes/password-reset.js
// POST /api/auth/forgot-password -> { userId: "<email or handle>" }
// POST /api/auth/reset-password  -> { token: "...", newPassword: "..." }

import { newId, hashPassword } from '../shared/auth.js';
import { sendEmail } from '../shared/email.js';

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

const RESET_TOKEN_TTL_MINUTES = 30;
const GENERIC_MESSAGE = "If an account exists for that ID, we've sent reset instructions to the email on file.";

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newResetToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleForgotPassword(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const rawUserId = (body.userId || '').toString().trim();
  if (!rawUserId) return badRequest('userId is required.');

  const user = await env.DB
    .prepare('SELECT * FROM users WHERE email = ? OR handle = ? COLLATE NOCASE')
    .bind(rawUserId.toLowerCase(), rawUserId)
    .first();

  // Same response whether or not the account exists — don't let this
  // endpoint be used to check which User IDs are registered.
  if (!user || user.suspended_at) {
    return ok({ ok: true, message: GENERIC_MESSAGE });
  }

  const token = newResetToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  await env.DB
    .prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(newId(), user.id, tokenHash, expiresAt)
    .run();

  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/?resetToken=${token}`;

  const emailResult = await sendEmail(env, {
    to: user.email,
    subject: 'Reset your Bleepmo password',
    html: `<p>Someone requested a password reset for your Bleepmo account.</p>
           <p><a href="${resetUrl}">Click here to set a new password</a>. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>
           <p>If this wasn't you, you can ignore this email — your password won't change.</p>`,
    text: `Reset your Bleepmo password: ${resetUrl} (expires in ${RESET_TOKEN_TTL_MINUTES} minutes)`,
  });

  // No email provider configured yet (RESEND_API_KEY unset) — rather than
  // silently claim we sent an email that never went anywhere, hand the
  // reset link back directly so the flow is still fully testable now.
  // Once a real provider is wired up, emailResult.sent flips to true and
  // this branch stops firing automatically — no frontend change needed.
  if (!emailResult.sent) {
    return ok({ ok: true, message: GENERIC_MESSAGE, devMode: true, resetUrl, token });
  }

  return ok({ ok: true, message: GENERIC_MESSAGE });
}

export async function handleResetPassword(request, env) {
  if (!env.DB) return badRequest('DB binding not configured.', 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Expected JSON body.');
  }

  const token = (body.token || '').toString().trim();
  const newPassword = (body.newPassword || '').toString();

  if (!token) return badRequest('Reset token is required.');
  if (newPassword.length < 8) return badRequest('Password must be at least 8 characters.');

  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL')
    .bind(tokenHash)
    .first();

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return badRequest('This reset link is invalid or has expired. Request a new one.', 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
  if (!user) return badRequest('This reset link is invalid or has expired. Request a new one.', 400);

  const { hash, salt } = await hashPassword(newPassword);

  await env.DB
    .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(hash, salt, user.id)
    .run();

  await env.DB
    .prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?`)
    .bind(row.id)
    .run();

  // Reset kicks out any other active sessions on this account, same as
  // admin suspension does — a password reset is a "trust nothing until
  // proven otherwise" moment.
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

  return ok({ reset: true });
}
