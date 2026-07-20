// src/routes/oauth-google.js
// GET /api/auth/google/start     -> redirect to Google's consent screen
// GET /api/auth/google/callback  -> exchange code, log in or hand off to "finish your profile"
//
// Requires these secrets (wrangler secret put ...), none of which are set yet:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

import { createSession, sessionCookie, readCookie } from '../shared/auth.js';
import {
  randomToken,
  shortCookie,
  redirectUriFor,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  findUserByProviderSub,
  findUserByEmail,
  linkProviderToUser,
} from '../shared/oauth.js';

function redirectTo(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

export async function handleGoogleAuthStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID) {
    return redirectTo('/?oauth=error&reason=not_configured');
  }
  const state = randomToken();
  const redirectUri = redirectUriFor(request, 'google');
  const authUrl = buildGoogleAuthUrl({ clientId: env.GOOGLE_CLIENT_ID, redirectUri, state });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': shortCookie('oauth_state_google', state, 600),
    },
  });
}

export async function handleGoogleAuthCallback(request, env) {
  if (!env.DB) return redirectTo('/?oauth=error&reason=server');
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return redirectTo(`/?oauth=error&reason=${encodeURIComponent(error)}`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = readCookie(request, 'oauth_state_google');

  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectTo('/?oauth=error&reason=state_mismatch');
  }

  try {
    const redirectUri = redirectUriFor(request, 'google');
    const tokens = await exchangeGoogleCode({
      code,
      redirectUri,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    });
    const profile = await fetchGoogleUserInfo(tokens.access_token);
    // profile: { sub, email, email_verified, name, picture, ... }

    let user = await findUserByProviderSub(env.DB, 'google', profile.sub);

    if (!user && profile.email && profile.email_verified) {
      const existingByEmail = await findUserByEmail(env.DB, profile.email);
      if (existingByEmail) {
        await linkProviderToUser(env.DB, existingByEmail.id, 'google', profile.sub);
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

    // Brand-new user: stash the verified provider profile in a short-lived
    // cookie and send them to the "finish your profile" step (pick a
    // handle, symbol, avatar) rather than guessing those on their behalf.
    const pendingPayload = JSON.stringify({
      provider: 'google',
      sub: profile.sub,
      email: profile.email || '',
      fullName: profile.name || '',
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
