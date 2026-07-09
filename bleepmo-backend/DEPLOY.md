# Deploying the Bleepmo backend on Cloudflare

You're already serving `index.html` (the renamed `bleepmo_v8.html`) as a
Cloudflare Pages project. This backend bolts onto that *same* project —
Pages Functions live alongside your static site, so nothing about your
current deployment needs to move.

## What you're setting up

- **D1** — a real SQL database, for user accounts and sessions
- **R2** — object storage, for profile pictures and voice-verification clips
- **Pages Functions** — the `/api/*` and `/media/*` routes that talk to both

## 0. Prerequisites

```bash
npm install -g wrangler
wrangler login
```

## 1. Create the D1 database

```bash
wrangler d1 create bleepmo-db
```

This prints a `database_id`. Copy it into `wrangler.toml` in place of
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Then load the schema:

```bash
wrangler d1 execute bleepmo-db --remote --file=./schema.sql
```

## 2. Create the R2 bucket

```bash
wrangler r2 bucket create bleepmo-media
```

The binding name (`MEDIA`) is already set in `wrangler.toml` — no further
config needed there.

## 3. Project layout

Merge this backend folder with your existing Pages project so it looks like:

```
your-pages-project/
├── index.html          ← your renamed bleepmo_v8.html
├── wrangler.toml
├── schema.sql
└── functions/
    ├── _shared/
    │   └── auth.js
    ├── api/
    │   ├── signup.js
    │   ├── login.js
    │   ├── logout.js
    │   ├── me.js
    │   └── upload-voice-clip.js
    └── media/
        └── [[path]].js
```

Cloudflare Pages auto-detects anything under `functions/` and wires it up
as routes — `functions/api/signup.js` becomes `POST /api/signup`,
`functions/media/[[path]].js` becomes `GET /media/*`, etc. Nothing extra to
configure there.

## 4. Bindings

If you deploy via `wrangler pages deploy`, the bindings in `wrangler.toml`
are picked up automatically. If you deploy via the Cloudflare **dashboard**
(git-connected Pages project) instead, add the bindings manually:

**Pages project → Settings → Functions → Bindings**
- D1 database binding: variable name `DB` → select `bleepmo-db`
- R2 bucket binding: variable name `MEDIA` → select `bleepmo-media`

Do this for both the **Production** and **Preview** environments if you
use preview deployments.

## 5. Deploy

```bash
wrangler pages deploy . --project-name=bleepmo
```

(Or push to your connected git branch, if you're using Cloudflare's git
integration instead of the CLI.)

## 6. Test it

Once deployed:

```bash
curl -i https://your-project.pages.dev/api/me
```

You should get a `401` with `{"user":null}` — that's correct, it means the
route is live and just says "nobody's logged in yet."

Then try creating an account through the actual signup form in the app.
If it works, `wrangler d1 execute bleepmo-db --remote --command="SELECT id, full_name, email, handle FROM users;"`
should show your new row.

## What's real now vs. still to do

**Now real:**
- Passwords are hashed (PBKDF2, 100k iterations) — never stored in plain text
- Sessions are server-side, tied to an `HttpOnly` cookie (can't be read or
  stolen by client-side JS/XSS)
- Profile pictures and voice clips upload to R2 and are referenced from D1
- `/media/*` requires a valid session before serving anything — no public
  bucket, no random internet access to people's faces or voice clips
- A returning, still-logged-in user skips the auth screen automatically

**Still cosmetic / not wired to this backend:**
- Google and Apple sign-in buttons — still call the old placeholder flow.
  Real OAuth is a separate, meaningfully sized piece of work (registering
  OAuth client IDs with Google/Apple, handling the redirect + token
  exchange) — happy to scope that next once account creation is confirmed
  working end-to-end.
- The feed, polls, BleepBot's "Ask Another AI," e-Store, and Calendar are
  still static/local — this milestone was scoped to accounts + private
  data + media only, per your instructions.

## A note on the R2 storage cost

R2 has a generous free tier (10GB storage, no egress fees), so this won't
cost anything meaningful during beta testing. Just flagging it since video
clips are the heaviest thing you're storing.
