// src/shared/email.js
// Minimal transactional email helper. Sends via Resend using plain fetch —
// no SDK dependency, works natively in the Workers runtime. Nothing else
// in this file assumes Resend specifically beyond this one function; swap
// providers by editing only sendEmail().
//
// Default sender is noreply@bleepmo.com (verified domain in Resend as of
// Aug 2026). Override per-environment with RESEND_FROM_ADDRESS if needed
// (e.g. a staging subdomain) without touching code.
//
//   wrangler secret put RESEND_API_KEY
//
// Until that secret exists, sendEmail() returns { sent: false } rather than
// throwing or pretending to succeed. Callers (see routes/password-reset.js)
// use that to fall back to an in-app "dev mode" flow instead of silently
// claiming an email went out when it didn't.

export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // Unverified whether Resend actually requires this — couldn't find
        // it in their docs or any working example — but it's harmless to
        // include, so keeping it in rather than arguing the point.
        'User-Agent': 'bleepmo/1.0',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_ADDRESS || 'Bleepmo <noreply@bleepmo.com>',
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      console.error('[sendEmail] Resend API returned an error', {
        status: res.status,
        statusText: res.statusText,
        body: errorBody,
      });
      return { sent: false, reason: 'provider_error', status: res.status, detail: errorBody };
    }
    return { sent: true };
  } catch (err) {
    console.error('[sendEmail] fetch to Resend threw', err);
    return { sent: false, reason: 'network_error', detail: String(err && err.message || err) };
  }
}
