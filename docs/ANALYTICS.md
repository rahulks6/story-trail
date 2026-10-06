# Product analytics

Spec section 15. Implemented in Phase 4 (October 2026). Report: `docs/phases/PHASE_4_MODERATION_ADS_ANALYTICS.md`.

## Principles

- **Aggregates only.** The Admin Console shows daily totals. No screen or endpoint lists a
  person, a Story or a message, and nothing here is shared with advertisers.
- **No free text.** Events carry a name, a platform, a session id and a few allowlisted
  booleans, bounded numbers or fixed choices. Captions, comments, messages, search queries,
  links, file names and error messages never reach analytics. Unknown properties are dropped
  by the server.
- **Counted once.** Every app event has a stable id chosen on the phone; a batch that is resent
  after a lost response is stored once (`ON CONFLICT DO NOTHING`).
- **Never in the way.** The app queues events on the phone and sends them in the background;
  playback, uploads, DMs and navigation never wait for analytics. The server records activity
  after the response and never delays a request.
- **No double systems.** Most metrics come from rows the features already write (Stories,
  views, likes, comments, shares, follows, DMs, Highlights, reports, ad events, the
  recommendation signals). The app only sends what the server cannot see.

## Where each metric comes from

| Metric | Source |
|---|---|
| DAU, WAU, MAU; platform split; returning users | `analytics_active_days`: one row per person, day and platform, written from authenticated API requests (header `X-Katkee-Platform`, sent by the app) and from app events. Admin Console traffic is not counted |
| New registrations | `users.created_at` |
| Active creators, Stories published | `stories` |
| Stories viewed, viewers, Stories watched per viewer | `story_views` (one per viewer and Story) |
| Completion rate, replays, average watch time | `recommendation_events` (`story_complete`, `story_replay`, `watch_duration`), sent by the Story player for ranking already |
| Likes, comments, shares, follows | `story_likes`, `story_comments`, `story_shares`, `follows` (likes and follows are the ones still standing: an undo deletes the row) |
| Highlights created | `highlights` |
| DMs sent, senders, delivered | `messages`; delivered = the recipient's app confirmed delivery (`conversation_reads.last_delivered_at`). Counts and timestamps only; the rollup never reads message text (tested) |
| Reports filed and resolved; backlog | `reports` (backlog is live: OPEN, UNDER_REVIEW, APPEALED, open appeals, oldest open report) |
| Ad requests, renders, impressions, qualified views, completions, clicks, hides, reports | `ad_events` |
| App sessions, crash-free sessions, crashes | app events `app_session_started`, `app_crash` |
| Upload success rate | app events `upload_succeeded`, `upload_failed` (per attempt, with stage and coarse reason); processing failures from `media.status = 'failed'` |
| Stories started in the editor, Highlight views, profile views, searches | app events `story_created`, `highlight_viewed`, `profile_viewed` (other people's only), `search_performed` (never the words) |

### App events and their allowed properties

| Event | Properties |
|---|---|
| `app_session_started` | `coldStart` (boolean) |
| `app_crash` | `fatal` (boolean) |
| `story_created` | `mediaKind` (`photo`/`video`), `source` (`camera`/`library`) |
| `highlight_viewed`, `profile_viewed`, `search_performed` | none |
| `upload_succeeded` | `mediaKind`, `attempts` (1–100), `durationMs` (0–3,600,000) |
| `upload_failed` | `mediaKind`, `stage` (`upload`/`processing`/`publish`), `reason` (`network`/`server`/`rejected`/`timeout`/`unknown`), `attempts` |

`POST /api/v1/analytics/events` (signed in): `{ platform?, appVersion?, events: [{ id, name, occurredAt, sessionId?, properties? }] }`,
1–50 events, 60 batches a minute per person. Events older than 7 days or more than 10 minutes
in the future are refused; up to 10 minutes ahead is treated as now (clock drift). Response:
`{ accepted, duplicates, rejected }`.

## Definitions

- **Day**: a calendar day in `ANALYTICS_TIME_ZONE` (default UTC). Choose it before launch.
- **Active**: made at least one signed-in request in the app that day (any platform), or sent
  an app event for that day (events queued offline count for the day they happened).
- **DAU / WAU / MAU** for day D: distinct active people on D / D−6…D / D−29…D.
- **Returning**: active on D and signed up before D.
- **Retention (D1, D7, D30)** for signup day C: of the people who signed up on C, the share
  active exactly on C+1, C+7, C+30. Pending (NULL) until that day has finished. Cohorts from
  before tracking started are not shown (they would read as 0%).
- **Session**: the app's time in the foreground, split after 30 minutes in the background.
- **Crash-free sessions**: 1 − sessions with an `app_crash` ÷ sessions started. Counts fatal
  JavaScript errors (noted on the phone before the app closes and sent on the next launch) and
  render crashes the error boundary caught. **Native (Java/Kotlin/Objective-C) crashes are not
  counted**: that needs a native crash reporter (for example Firebase Crashlytics), which is
  not installed.
- **Completion rate**: distinct (viewer, Story) completions ÷ Story views that day.
- **Upload success rate**: per attempt, so a failed attempt followed by a successful retry
  counts one of each.
- Rates are shown as "–" when there is nothing to divide by, never as 0%.

## Aggregation

The worker (leader-locked hourly runner, `src/modules/media/retention.ts`) runs:

- `analytics_rollup`: `analytics_rollup_day(day, tz)` for today and the previous 7 days (events
  arrive up to 7 days late) and for any missing day in the last 35 since tracking started; then
  `analytics_rollup_retention(...)` for the last 38 signup days. Both are SQL functions
  (migration `0035_analytics.sql`), idempotent, with JIT off (it cost ~0.5 s per call for ~1 ms
  of work). They run on a dedicated connection with a 15-minute statement timeout.
- `analytics_raw_retention`: deletes app events and per-person activity days older than
  `ANALYTICS_RAW_RETENTION_DAYS` (default 90, minimum 40). Daily totals are kept.

Deleting an account removes its analytics rows when the account is purged (30 days after
deletion, with the rest of its data). Totals already computed are unaffected and identify nobody.

Small BRIN indexes on the time columns of the feature tables keep the per-day scans cheap
without slowing writes. At large scale, raw events would move to a stream and a warehouse;
the ingestion module is the single place to change.

## Admin Console

**Analytics** (permission `analytics.read`): live DAU/WAU/MAU, new registrations, returning
users and active creators; an active-users chart over the selected period (7/30/90 days);
period totals for Stories, engagement and DMs, app health, platforms, moderation and Sponsored
Stories; a table by day; retention by signup day; **Refresh now** (runs the worker's rollup,
twice a minute at most per operator).

`GET /api/v1/admin/analytics?days=30` returns `{ timeZone, today, days, live, backlog, period: { counts, rates, latestUsers }, daily: [{ day, metrics, rates, computedAt }], retention: [{ cohortDay, cohortSize, d1, d7, d30, d1Rate, d7Rate, d30Rate }], computedAt }`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ANALYTICS_ENABLED` | `true` | `false`: nothing new is recorded or rolled up; the app's batches are acknowledged and dropped |
| `ANALYTICS_TIME_ZONE` | `UTC` | IANA zone; validated at startup |
| `ANALYTICS_RAW_RETENTION_DAYS` | `90` | at least 40 (monthly actives and D30 need 31 days) |

## In the app

`mobile/src/analytics/analytics.ts`: started on sign-in (`useAnalytics` in `RootNavigator`),
stopped on sign-out. Events are queued per person on the phone (at most 300; unsent events wait
for that person's next sign-in and are never sent with someone else's token), flushed after
10 s, at 20 events, when the app goes to the background, and retried with backoff (10 s, 30 s,
2 min, 10 min). A refused batch (invalid) is dropped rather than retried forever.
`index.js` installs the crash note (`src/crashReporting.ts`) and tells the API client the
platform. App version is not sent: the version is set at native build time and the app has no
native module to read it.

## Verification

- `backend/test/analytics.test.ts` (6): activity recorded once per day and platform, never for
  Admin traffic or blocked accounts; idempotent ingestion with property allowlisting; one day
  aggregated **exactly** from real API activity (users, Stories, views, completions, replays,
  watch time, likes, comments, shares, follows, DMs sent and delivered, sessions, crashes,
  uploads, reports); D1/D7/D30 retention including pending values; Admin access and privacy;
  worker rollup and raw-data retention.
- `backend/test/dmPrivacy.test.ts`: the rollup counts DMs without reading their content.
- `backend/test/retention.test.ts`: the two worker tasks run; analytics rows are purged with a
  deleted account.
- `verification/analytics-client.cjs` (7) and `verification/upload-queue.cjs` (upload events).
- `verification/admin-browser.cjs`: the Analytics page in Chromium, including Refresh.
