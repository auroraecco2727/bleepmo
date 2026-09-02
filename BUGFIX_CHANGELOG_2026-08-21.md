# Bleepmo bugfix session — 2026-08-21

Static code sweep (no live browser/console access this session). Root cause
first, then what it broke, then the fix. Migration for existing data is
separate and NOT auto-run — see the bottom of this file.

---

## 1. Trend-points were never lowercased at write time (root cause)

Every other place trendpoints get read (subscribed interests, location
matching, merch recommendations) assumes lowercase, per the convention in
`migrations/0008_onboarding.sql`. Bleep-authored trendpoints (from the
composer) were the one place that never enforced it — "Sustainable Tech"
got stored exactly as typed.

**Fixed in:**
- `src/routes/bleeps.js` — trendpoints lowercased + deduped at insert.
- `public/index.html` — both places a trendpoint chip gets added in the
  composer (`handleTrendInputKeydown`, and the "flush on step navigation"
  path) now lowercase on entry, so what's shown matches what's saved.

## 2. `COLLATE NOCASE` misplaced on an `IN` clause

`src/routes/bleeps.js`, the `/api/bleeps/similar` query, had:
`tp.topic IN (?,?,?) COLLATE NOCASE`. In SQLite, `COLLATE` binds to the
expression immediately to its left — attaching it after the whole `IN(...)`
doesn't apply it to the comparisons inside. Fixed to
`tp.topic COLLATE NOCASE IN (?,?,?)`.

## 3. Notification bell's "commerce" category silently broken

Downstream symptom of #1: `notifications.js` lowercases topics before
checking them against the merch map, but the merch map itself
(`getRecommendedMerchForTopics` in `store.js`) was keyed by whatever raw
case came in, so the lookup rarely matched. Fixed by #1 (topics are
lowercase going into the map now).

## 4. Bleep-owners couldn't moderate comments on their own posts

`comment-detail.js` already allows deletion by "the comment's author or
the Bleep's author" — but `public/index.html`'s `buildCommentRow` only
ever showed the Delete link to the comment's own author. The backend
capability was unreachable from the UI.

**Fixed:** `commentsScreenState` now tracks the open post's `author_id`
(pulled from the bleep-detail fetch already being made), and
`buildCommentRow` shows Delete if the viewer is either the comment author
or the post owner.

## 5. OAuth signups skipped handle-format validation entirely

`signup.js` and `update-profile.js` both enforce
`/^[A-Za-z0-9_]{2,30}$/` server-side, and signup has live availability
checking client-side. `oauth-complete.js` (Google/Apple "finish your
profile" flow) had neither — a handle outside that pattern could slip
through, breaking `renderBleepMentions`/`@`-mention parsing for that
account.

**Fixed:**
- `src/routes/oauth-complete.js` — added the same server-side format gate.
- `public/index.html` — generalized the debounced handle-availability-check
  code (previously hardcoded to the signup screen's element IDs) to take
  `(inputId, statusId)`, wired it to the finish-profile screen's handle
  field too, and added the matching submit-time gate.

## Housekeeping

- `schema.sql` had `app_settings` defined twice, verbatim identical, both
  as `CREATE TABLE IF NOT EXISTS` — harmless (second was a no-op) but
  removed the duplicate for clarity.

---

## Data migration — NOT run against production, needs your review

`migrations/0012_lowercase_trend_points.sql` backfills existing
`trend_points.topic` rows written before fix #1, so old posts benefit
too, not just new ones. It contains two dry-run `SELECT`s (commented out
at the top of the file) to run first, plus the `UPDATE` itself.

Suggested `wrangler d1 execute` commands (swap in your actual DB name/id
from `wrangler.toml` — omit `--remote` to test against local first):

```bash
# 1. Dry run — see what would change
wrangler d1 execute <YOUR_DB_NAME> --remote --command "SELECT id, bleep_id, topic, LOWER(topic) AS would_become FROM trend_points WHERE topic != LOWER(topic);"

# 2. Dry run — check for same-bleep collisions the UPDATE can't resolve alone
wrangler d1 execute <YOUR_DB_NAME> --remote --command "SELECT bleep_id, LOWER(topic) AS topic_lower, COUNT(*) AS n FROM trend_points GROUP BY bleep_id, LOWER(topic) HAVING COUNT(*) > 1;"

# 3. Only after reviewing both — run the actual migration file
wrangler d1 execute <YOUR_DB_NAME> --remote --file ./migrations/0012_lowercase_trend_points.sql
```

If dry-run #2 returns rows, decide which duplicate to keep per
`bleep_id`/`topic_lower` pair before running the `UPDATE` — otherwise it's
safe to run as-is (harmless leftover duplicates at worst, not data loss).

---

## Not yet done (carried over to next session)

- Migrations-vs-`schema.sql` drift check — **done, see #7 below**.
- Pass over `test-console.html` — **done, see below: no bugs found, verified
  clean against the current backend.**
- Pass over remaining screens (profile, settings) — **done, see #8 below.**

---

## 6. Progressive slowdown when switching tabs / scrubbing Flicks

Reported symptom: the app gets slower the more you switch between tabs —
most obvious on Firefox. Root cause: `<video>` elements in the Flicks
panes (main player, "up next" rail, "recommended" rail) were being
discarded via `innerHTML = ...` replacement instead of being explicitly
torn down first. Just removing a `<video>` from the DOM doesn't reliably
or immediately release its decoder/network resources — Firefox lags
noticeably behind Chrome on this — so every tab revisit, and every scrub
through Long-Flicks specifically (which rebuilds its rails on every
click, not just on tab switches), left behind a few not-yet-released
video decoders. That compounds fast, which matches "gets slower and
slower the more you use it."

**Fixed in `public/index.html`:** added a shared `releaseVideosIn(el)`
helper (`pause()` + clear `src` + `load()` on every `<video>` inside a
container) and called it at every spot that replaces video-containing
markup:
- `loadFlickPane()` — before rebuilding a Flicks pane's content
- `pauseFlickPane()` (via `teardownFlickPaneVideos`) — when leaving a
  Flicks tab
- `renderFlickUpNextRail()` and `renderFlickRecommendedRail()` — both
  rebuild on every scrub through Long-Flicks, not just on tab switches,
  so this was likely the higher-frequency contributor of the two

Verified with `node --check` on the extracted inline script (syntax
only — this needs a real browser session, ideally in Firefox with the
Memory/Performance dev tools open over several tab switches, to confirm
the fix actually holds the line under real use).

## 7. Migrations-vs-schema.sql drift check

Cross-referenced every table/column created across `migrations/0001`
through `0011` against `schema.sql`, plus checked schema.sql's git
history to see which tables were present from the very first commit
(meaning any live DB provisioned early wouldn't have anything added
later unless a catch-up migration exists for it — same situation
`migrations/0007_conversations.sql`'s own comment describes and fixes
for `conversations`/`messages`).

**Found: two tables were added to `schema.sql` after initial DB
provisioning but never got a catch-up migration, unlike
conversations/messages:**
- `follows` — the entire follow/followers feature. If missing on your
  live DB, every request against it would be erroring right now.
- `engagement_events` — dwell-time/view instrumentation, sent via
  `navigator.sendBeacon` on every card view (confirmed this is live,
  frequently-firing traffic, not dead code). `sendBeacon` swallows
  errors, so if this table were missing, you'd be silently losing all
  of this data with zero visible symptom.

**Fixed:** `migrations/0013_follows_and_engagement_catchup.sql` — safe,
idempotent (`CREATE TABLE IF NOT EXISTS`) catch-up migration for both.
Includes a read-only check command in its own header comment so you can
confirm whether either table is actually missing before running it:

```bash
wrangler d1 execute bleepmo-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('follows','engagement_events');"
```

If that returns both names, the migration is a no-op and safe to skip
(or run anyway — harmless either way).

**Also cleaned up while cross-referencing:**
- `schema.sql` had a leftover duplicate header comment sitting on top of
  the `app_settings` table (from the earlier session's de-duplication —
  I'd removed the redundant `CREATE TABLE` but left both comment blocks
  above it). Merged into one.
- `schema.sql`'s `trend_points.topic` column comment still showed a
  mixed-case example (`"Sustainable Tech"`), which contradicted the
  lowercase-everywhere convention fix #1 established. Updated to a
  lowercase example.
- Migration numbering has a gap (`0005` → `0007`, no `0006`). Not
  necessarily a bug — likely an abandoned/renamed migration — but worth
  knowing about if you ever wonder whether a file is missing.

## `test-console.html` — checked, no bugs found

Traced every endpoint call in the harness (`/api/login` field names,
`/api/bleeps` POST response shape incl. `tagsApplied`, `/api/notifications`
POST `markAllRead` support, `comment_count`/`actor_symbol`/`actor_handle`
field names) against the current backend, plus compared its local
`renderMentions` regex against the real one in `shared/mentions.js`.
Everything matches — no drift found, nothing to fix here.

## 8. Settings screen had the same handle-validation gap as OAuth signup

Same bug class as the OAuth fix from last session, found in the third and
last place a handle gets set: `update-profile.js` (used by the Settings
screen to change an existing account's handle) checked handle
**uniqueness** but never **format** — an existing user could save a
handle with spaces, symbols, or the wrong length as long as it wasn't
already taken by someone else, silently breaking `@`-mentions for that
account going forward.

**Fixed:**
- `src/routes/update-profile.js` — added the same
  `/^[A-Za-z0-9_]{2,30}$/` format gate signup.js and (now) oauth-complete.js
  already have.
- `public/index.html` — wired the Settings handle field to the same live
  debounced availability check used elsewhere, with one necessary
  wrinkle: Settings pre-fills the field with the user's *own* current
  handle (signup/oauth screens always start blank), and
  `/api/check-handle` has no concept of "current user" — it just checks
  whether any row has that handle. Retyping your own unchanged handle
  would otherwise come back "already taken" (true, but confusing — it's
  taken by you). Added `checkSettingsHandle()`, a small wrapper that
  short-circuits that one case before delegating to the shared check.
- Added the matching submit-time gate to `saveSettings()`.

Everything else checked in the profile/settings sweep — `openProfileScreen`,
the follow toggle (optimistic update + reconciliation), mutual-follow
gating for the message button, `/api/users/:id/relationship` (payload
matches what the frontend reads — its own doc comment was just stale/
incomplete, not wrong, left as-is since it's cosmetic), and profile tab
switching — checked out clean.

---

## 9. UI polish pass (Flicks screen)

Five items from a screenshot review of the live Flicks screen.

**Blinking dot on the "Breaking" badge** — removed. Was a small pulsing
dot (`.breaking-dot`, `breakingDotPulse` animation) rendered in front of
the "BREAKING" label on cards. Removed the element, its CSS, and the
keyframe animation entirely from `public/index.html`.

**Like button didn't work on the Flicks player (Short or Long)** — the
click handler itself was correctly wired (`setActiveFlick` sets
`likeAct.onclick` to call the same `toggleLike()` the main feed uses),
and the like was very likely being recorded server-side. But
`toggleLike()`'s shared UI-sync helpers (`setLikeButtonsState`) look for
markup conventions the flick player's like element didn't have — a
`like-btn` class, a `data-bleep-id` attribute, and a `.like-count-badge`
child — so the heart's fill and the count never visually updated even
though the request succeeded. From the outside this looked exactly like
"the button doesn't work." Fixed by giving the flick player's like
element the same classes the main feed uses, and setting
`data-bleep-id` + the initial fill state per-Flick in `setActiveFlick()`.

**Contextual Intelligence icon overlapping the rail-hide toggle** — both
`.flick-actions` (the heart-shaped "Contextual Intelligence" / BleepBot
button) and `.flick-rail-toggle-bar` were independently positioned at
`top: 50%` on the right edge for Short-Flicks, directly on top of each
other. Long-Flicks already had a special-case inline override moving its
copy of `.flick-actions` up to `top: 24px` — extended that same
positioning to the shared base CSS class so both Short and Long now use
it consistently, removing the redundant inline override. Also bumped the
icon from 18px to 22px and its button padding from 4px to 6px per the
request to size it up slightly.

**Rail-hide toggle bar drifting position when the rail is hidden** — the
toggle bar sits inside `.flick-player`, which has `flex: 1` and
therefore physically grows to fill the space `.flick-rail` leaves behind
once collapsed (`width: 0`). Since the toggle bar's `right: 8px` is
measured from `.flick-player`'s own edge, that edge moving ~90px
(the rail's width) when the rail hides drags the toggle bar too — a real
positional shift worth being aware of, though not one worth "fixing"
with compensation.

First attempt at a fix (now reverted) added a `:has()` rule that pulled
the toggle bar back inward by 90px once the rail was hidden, on the
assumption the desired "inner edge" meant staying at the old
video/rail boundary. That was backwards — screenshots with the actual
desired position marked showed the toggle bar should simply hug
`.flick-player`'s own current right edge in both states (the true edge
of the visible video, wherever that happens to be), not get pulled
toward a compensated position. Reverted to a plain `right` offset,
unconditional in both states.

Follow-up: even at a plain offset, `right: 8px` still left a visible gap
— not the flush, "snug to the edge" feel of the horizontal tab-menu
toggle bar (`.tab-bar-toggle`) elsewhere in the app. Rebuilt the bar's
two pseudo-elements with explicit absolute positioning (`right: 0` for
the always-visible primary bar, `right: 6.5px` for the second bar that
only fades in once the rail is hidden) instead of flex-centering the
container. Flex centering/`justify-content: flex-end` were both tried
and rejected: a hidden flex child still reserves its slot even at
`opacity: 0`, so the visible bar would've shifted position the moment
the second bar faded in. Pinning each bar independently means the
primary bar never moves at all — it's flush at the true edge in both
states, exactly matching the reference screenshots.

## 10. "Recommended by Bleepmo" visor bar showed inconsistently and never went away

Reported: the bar (the pill overlay mid-video reading "Recommended by
Bleepmo") didn't always show up, but once it did, it stayed for the
entire video with no way to dismiss it.

Root cause: the bar's visibility was driven by `state.recommended`, a
flag set exactly once per Flicks-pane load (`state.recommended =
!!data.usedTrendFallback`) — true only if the *initial* feed request for
the whole pane happened to fall back to trend-based recommendations.
That flag had nothing to do with which individual video was on screen or
how the person got there: it applied identically to every Flick in the
pane for the pane's entire session, and — since it only ever got set,
never cleared or timed — stayed in effect for as long as the pane stayed
loaded. That explains both halves of the report: it appeared only when
that one pane-wide condition happened to be true at load time, and
persisted indefinitely once it was, regardless of scrubbing to a
different video.

Fixed to match the behavior actually described as intended: the bar now
shows for 5 seconds, then fades out, specifically on the video the
person just landed on by clicking a thumbnail from the "Recommended by
Bleepmo" rail (`jumpToRecommendedFlick`) — not as a pane-wide, load-time
condition.
- `jumpToRecommendedFlick()` sets a one-shot `_justRecommended` flag on
  the specific bleep object being jumped to.
- `setActiveFlick()` checks that flag (consuming it immediately, so it
  only ever fires once per click, not on every later scrub back to the
  same video), shows the bar, and arms a 5-second timer
  (`visorTimer[paneKey]`) that fades it out via an opacity transition.
- The timer is cleared and reset on every flick change (so scrubbing
  quickly between videos can't leave a stale timer that hides the
  *next* video's bar early), and cleared entirely in `pauseFlickPane()`
  when leaving the tab, matching how `bingeTimer` is already handled
  there.
- Removed the now-dead `state.recommended` assignment in
  `loadFlickPane()` — nothing reads it anymore.
- The existing fallback (showing the video's trendpoints instead, when
  it wasn't reached via the recommended rail) is unchanged.




## 11. Contextual Intelligence panel — reorganized the quick-actions page

Not a bug fix — a design/polish pass on the panel's first (and currently
only) page, at the person's request. No AI/generated content added; this
is purely layout, grouping, and labeling of the buttons that were already
there.

Before: a single flat row of unlabeled 40×40 icon squares (3 for Bleeps;
6 for Flicks, since Short and Long share the same set), distinguishable
only by a hover `title` tooltip — which never shows on a touch device at
all, so mobile users had no way to know what an icon did before tapping
it blind.

After, in both `buildBleepCardInner` (real Bleep cards) and
`setActiveFlick` (Flicks, still shared between Short and Long):
- Every action now has a permanent, visible text label under its icon
  (`.bb-action-tile-label`), not just a hover tooltip — the tooltip is
  kept too, as extra detail for desktop/mouse users.
- Actions are grouped under small labeled headers instead of one flat
  row: Bleeps get a single "Creator" group (Bleeps / Flicks / Profile).
  Flicks get "Creator" plus a second "This Flick" group (Binge / Vault /
  Tip) — the first real visual differentiation between what a Bleep's
  panel and a Flick's panel offer, even though the underlying action set
  itself is unchanged.
- Admin-only Edit/Delete now sit in their own separate "Manage" group at
  the end (only rendered when at least one applies), rather than tacked
  onto the end of the same row as everything else — putting the
  destructive action in its own clearly-labeled cluster rather than
  next to routine navigation.
- Replaced the fixed-size icon-square grid with a responsive CSS grid
  (`repeat(auto-fill, minmax(64px, 1fr))`) and a 44px minimum tap-target
  height, rather than a flex row that could wrap unpredictably as the
  Flicks panel's button count grew.
- Renamed `.bb-action-btn` → `.bb-action-tile` throughout (no old
  references left — confirmed via a full-file grep) since the element
  now contains an icon + label rather than being a bare icon square.

This only touches `public/index.html` — no backend, no schema, no
migration.

## 12. Flick player — moved the mute button into the info row, upgraded to a real volume control

Design/polish request, not a bug fix. Two changes to the Flicks player
(`buildFlickPlayerHtml`, shared by Short and Long):

**Moved:** the mute button used to float over the top-left corner of the
video as its own circular badge. Moved it into the same row as Like /
Comment / Share, as the last (rightmost) item — which, as a natural side
effect of appending a new item to that row, is what shifts the existing
icons left, exactly as requested rather than needing any explicit
per-icon repositioning.

**Upgraded from a plain mute toggle to a real volume control:**
- The icon now reflects three states instead of two — muted (X), low
  volume (single wave), high volume (double wave) — based on actual
  `video.volume`, not just whether it's muted.
- Added a small drag slider (`.flick-volume-slider`) next to the icon,
  wired to `video.volume` directly via a new `handleFlickVolumeInput()`.
  Dragging to 0 mutes; dragging up from muted un-mutes — matching how
  most video players handle the mute/volume relationship.
- Clicking the icon itself still does a simple mute toggle (unchanged
  core behavior) — unmuting at 0 volume now bumps to full volume rather
  than un-muting into silence, which would've looked broken.
- Removed the now-dead `.flick-mute-btn` CSS rule (the old floating
  top-left position no longer exists).

Both the icon and slider share the video element's actual state, and
since the `<video>` element persists across scrubbing within a pane
(rather than being recreated per Flick), volume/mute settings carry over
between Flicks in the same session — no extra sync code needed for that.

## 12. Flick volume control — reconciled a live/working-copy mismatch, then simplified

Reported: a standalone mute-only icon in the video's top-left corner
(live site), separate from a 3-icon bottom row (heart/comment/share).
Ask: move the mute button into that bottom row (after share), and turn
it into a volume control.

On inspection, the working copy already had a `flick-volume-act` element
— icon + drag slider, in exactly that position (after share) — that the
top-left icon on the live site doesn't match at all. Traced the entire
`buildFlickPlayerHtml` function fresh, top to bottom, twice: there is no
separate top-left mute element anywhere in this codebase. Most likely
explanation: this bottom-row control predates this conversation entirely
(probably from before the very first handoff) and was simply never
deployed — the live site has been running the older top-left-icon-only
version this whole time, unrelated to anything fixed in this session.
Practical result: once this file is copied over, the repositioning asked
for is already in effect — `like → comment → share → mute` was already
the order in the working copy.

With a real slider already present (0–100, and dragging to 0 already set
`video.muted = true` per existing `handleFlickVolumeInput` logic), a
separate click-to-toggle mute button was redundant — flagged by the
person, and correct: two controls doing the same job. Simplified:
- Removed the `onclick`/`toggleFlickMute()` call and the "Unmute" title
  from the icon — it's now a passive state indicator only (still swaps
  between muted/low/high glyphs via `updateFlickVolumeIcon`, still
  updates its tooltip, just isn't clickable itself).
- Deleted `toggleFlickMute()` entirely — confirmed via grep it had no
  other callers before removing it.
- Fixed a related one-time cosmetic mismatch this surfaced: the slider's
  hardcoded default was `value="100"` (implies full volume) while the
  `<video>` tag's `muted` attribute means it's always actually silent on
  first load (required for autoplay). Changed the default to
  `value="0"` so the slider honestly reflects the true starting state.
  This only matters on the very first flick a pane ever shows — since
  the video element and slider persist across scrubbing (not rebuilt per
  flick), whatever the person sets stays in sync naturally after that
  first interaction.

## 13. "Trend-points" → "Trendpoint" — user-facing terminology only

At the person's request: unified the term users actually see to
"Trendpoint" / "Trendpoints" (no hyphen) everywhere in the app — labels,
placeholders, onboarding copy, composer step text, and prose comments in
this changelog and the SQL files.

Deliberately scoped to display text and comments only. Left every
internal identifier untouched — `trend_points` (the real table/column
name in `schema.sql` and every migration), `trendPoints`/
`subscribedTrendPoints`/`composeTrendPoints` (JS variable names),
`slugifyTrendPoint` (function name), and the `trendPoints`/
`subscribedTrendPoints` API field names the backend actually parses by
that exact string (`form.get('trendPoints')` etc. in `bleeps.js`,
`update-profile.js`). Renaming any of those would mean coordinated
frontend+backend changes and, for the database table itself, a real
migration on live data — explicitly out of scope per "I don't want to
break production." "Trendpoint" and "trend_points" are the same concept
under two different names now: one for people, one for the code.

Confirmed via grep before and after: all ~30 internal identifier
references are untouched; only hyphenated display/comment text changed.

## 14. New feature: Mute a creator

First of three planned moderation/preference tools (mute → block →
negative-trendpoint "not interested"), scoped and built as the easiest
win of the three.

**What it does:** a soft, one-directional, silent content preference —
explicitly NOT a block. Muting someone only affects the muter's own
passive feeds going forward (main feed, Flicks panes, trend-browsing,
similar-posts). It does not notify the muted person, does not stop them
from following/messaging/commenting, and does not hide their content if
the muter visits their profile directly (deliberate visits still show
everything — mute is about what surfaces passively, not a full removal
from view). Full scope documented in the migration file's header.

**New file:** `migrations/0014_muted_users.sql` — `muted_users(muter_id,
muted_id, created_at)`, composite primary key, one index on `muter_id`.

**New file:** `src/routes/mute.js` — `POST /api/users/:id/mute` (toggle,
returns `{ muted }`), `GET /api/me/muted` (list, for a future "Muted
accounts" management screen — not built yet, this just gives that screen
something to call whenever it lands). Wired into `src/index.js`.

**Query filtering — `src/routes/bleeps.js`:** added
`AND b.author_id NOT IN (SELECT muted_id FROM muted_users WHERE
muter_id = ?)` to every passive-browsing query:
- The main feed / Flicks-pane query in `handleBleepsGet` (skipped when
  `authorFilter` is set — a deliberate profile visit stays unaffected,
  matching the "don't hide on deliberate visits" scope above)
- Its trend-fallback branch (same function)
- `handleBleepsSimilar` (the "similar posts" composer step)

Since the Flicks recommended-pool fetch (`loadLongRecommendedPool` in
`public/index.html`) calls the same `/api/bleeps?contentType=...`
endpoint as the main feed, this one change covers the main feed, both
Flicks panes, and the recommended rail in one place — no separate fix
needed there.

**UI — `public/index.html`:** added a "Mute" tile to the Contextual
Intelligence panel's "Creator" group, in both `buildBleepCardInner`
(real Bleep cards) and `setActiveFlick` (Flicks) — guarded by a new
`canMuteCreator` flag (`currentUser.id !== b.author_id`) so it doesn't
show on your own posts, matching how the existing Edit/Delete tiles are
already gated. New `toggleMuteCreator()` function calls the endpoint and
gives immediate visible confirmation: a toast, the tile's own label
flips between "Mute"/"Unmute", and — since otherwise it'd look like
nothing happened until the feed next reloads from scratch — every one of
that creator's posts currently visible on screen (found via the existing
`data-author-id` attribute on `.creator-row`) fades out and is removed
immediately, not just the one post the mute was triggered from.

Known v1 simplification, called out in the code comment: the tile always
starts labeled "Mute" on a fresh page load rather than checking the
creator's actual mute state ahead of time — re-encountering an
already-muted creator is a rare edge case (their posts are filtered out
of passive feeds; it mainly happens via a deliberate profile visit,
where mute intentionally doesn't hide anything anyway), so a full
ahead-of-time synced state per-post wasn't worth the extra backend
lookup for a first version.

---

## Block — design discussion (not yet built)

Talked through scope for the second tool. Bigger and more invasive than
mute — it's the actual safety feature, not a content-quality one — so
recording the design questions raised, to revisit before building:

- Bidirectional by nature: if A blocks B, B shouldn't see A's content
  either, not just the reverse. Content queries would need an OR against
  both `blocks.blocker_id = viewer` and `blocks.blocked_id = viewer`.
- Should block auto-force an unfollow both directions, and prevent a new
  follow being created in either direction afterward? (Leaning yes.)
- Should a block retroactively hide the blocked person's existing
  comments on the blocker's posts, or only prevent new ones going
  forward? (Open question — softer option avoids surprising data loss.)
- Should a blocked person be able to open/send a new DM thread? (Leaning
  no — prevent new messages, but keep existing conversation history
  rather than deleting it.)
- Should a blocked person be able to view the blocker's profile at all,
  or see a "this account is unavailable" state? (Full block
  implementations elsewhere usually do the latter.)
- Notifications: unlike mute, a block should suppress notifications
  from that person's actions (likes/comments/follows) — the two features
  differ here on purpose.

No code written for this yet — deliberately staged as a discussion
first, per request, before deciding a concrete schema/enforcement plan.
