// src/shared/email.js
// Minimal transactional email helper. Bleepmo has no email provider account
// configured yet — there's no free/no-signup way to send real email from a
// Workers app (Cloudflare's old free MailChannels integration was
// discontinued in 2024). Resend is used here because it has the simplest
// API and a generous free tier, but nothing else in this file assumes
// Resend specifically beyond this one function — swap providers by editing
// only sendEmail().
//
// To go live: create a free account at resend.com, verify a sending
// domain (or use their shared onboarding domain for testing), then:
//   wrangler secret put RESEND_API_KEY
// Nothing else needs to change — callers of sendEmail() don't know or care
// which provider is behind it.
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
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_ADDRESS || 'Bleepmo <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      return { sent: false, reason: 'provider_error', status: res.status };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: String(err && err.message || err) };
  }
}
