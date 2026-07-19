// src/routes/oauth-apple.js
// GET  /api/auth/apple/start     -> redirect to Apple's consent screen
// POST /api/auth/apple/callback  -> Apple posts here (response_mode=form_post),
//                                    not a GET redirect like Google's.
//
// Requires these secrets (wrangler secret put ...), none of which are set yet:
//   APPLE_CLIENT_ID     — your Services ID, e.g. com.bleepmo.web
//   APPLE_TEAM_ID        — from your Apple Developer account
//   APPLE_KEY_ID         — the Key ID of your "Sign in with Apple" key
//   APPLE_PRIVATE_KEY    — the full contents of the .p8 private key file

import { createSession, sessionCookie, readCookie } from '../shared/auth.js';
import {
  randomToken,
  shortCookie,
  redirectUriFor,
  buildAppleAuthUrl,
  generateAppleClientSecret,
  exchangeAppleCode,
  decodeIdTokenPayload,
  findUserByProviderSub,
  findUserByEmail,
  linkProviderToUser,
} from '../shared/oauth.js';

function redirectTo(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

export async function handleAppleAuthStart(request, env) {
  if (!env.APPLE_CLIENT_ID) {
    return redirectTo('/?oauth=error&reason=not_configured');
  }
  const state = randomToken();
  const redirectUri = redirectUriFor(request, 'apple');
  const authUrl = buildAppleAuthUrl({ clientId: env.APPLE_CLIENT_ID, redirectUri, state });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': shortCookie('oauth_state_apple', state, 600),
    },
  });
}

export async function handleAppleAuthCallback(request, env) {
  if (!env.DB) return redirectTo('/?oauth=error&reason=server');

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirectTo('/?oauth=error&reason=bad_callback');
  }

  const error = form.get('error');
  if (error) return redirectTo(`/?oauth=error&reason=${encodeURIComponent(error.toString())}`);

  const code = form.get('code');
  const state = form.get('state');
  const cookieState = readCookie(request, 'oauth_state_apple');

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectTo('/?oauth=error&reason=state_mismatch');
  }

  // Apple only sends the user's name on the very first authorization —
  // it comes as a JSON string in the 'user' field, not from the id_token.
  let firstTimeName = '';
  const userField = form.get('user');
  if (userField) {
    try {
      const parsed = JSON.parse(userField.toString());
      const n = parsed.name || {};
      firstTimeName = [n.firstName, n.lastName].filter(Boolean).join(' ');
    } catch {
      // Ignore malformed 'user' field — fall back to no name below.
    }
  }

  try {
    const redirectUri = redirectUriFor(request, 'apple');
    const clientSecret = await generateAppleClientSecret({
      teamId: env.APPLE_TEAM_ID,
      clientId: env.APPLE_CLIENT_ID,
      keyId: env.APPLE_KEY_ID,
      privateKeyPem: env.APPLE_PRIVATE_KEY,
    });

    const tokens = await exchangeAppleCode({
      code: code.toString(),
      redirectUri,
      clientId: env.APPLE_CLIENT_ID,
      clientSecret,
    });

    const payload = decodeIdTokenPayload(tokens.id_token);
    // payload: { sub, email, email_verified, is_private_email, ... }

    let user = await findUserByProviderSub(env.DB, 'apple', payload.sub);

    if (!user && payload.email && (payload.email_verified === true || payload.email_verified === 'true')) {
      const existingByEmail = await findUserByEmail(env.DB, payload.email);
      if (existingByEmail) {
        await linkProviderToUser(env.DB, existingByEmail.id, 'apple', payload.sub);
        user = existingByEmail;
      }
    }

    if (user) {
      const { token, expiresAt } = await createSession(env.DB, user.id);
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/?oauth=success',
          'Set-Cookie': sessionCookie(token, expiresAt),
        },
      });
    }

    const pendingPayload = JSON.stringify({
      provider: 'apple',
      sub: payload.sub,
      email: payload.email || '',
      fullName: firstTimeName,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/?oauth=finish',
        'Set-Cookie': shortCookie('oauth_pending', pendingPayload, 600),
      },
    });
  } catch (err) {
    return redirectTo('/?oauth=error&reason=exchange_failed');
  }
}
