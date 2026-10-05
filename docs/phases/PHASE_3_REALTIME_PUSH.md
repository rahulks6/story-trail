# Phase 3 — Realtime, push notifications and reliable DMs

Date: 5 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`. Design and setup: `docs/REALTIME_AND_PUSH.md`.

## Outcome by requirement

| Requirement | Status | Evidence |
|---|---|---|
| Realtime delivery of DMs, receipts and Activity (WebSocket `/api/v1/realtime`), not 20-second polling | IMPLEMENTED AND VERIFIED (server) | `realtime.test.ts` (8): message, receipt and notification events reach both participants; events carry ids only |
| Works across API instances (no sticky sessions) | IMPLEMENTED AND VERIFIED | cross-instance test; benchmark with two API processes (below) |
| Connections end when the sign-in ends, the account is suspended or the token expires | IMPLEMENTED AND VERIFIED | sign-out closes the socket (4401) in under 3 s via a database trigger, suspension too; a 2 s token is closed with 4001 |
| Socket auth: Bearer or single-use 60 s ticket (stored hashed), per-user cap of 10, 4 KB frames, rate-limited upgrades, app-level ping/pong | IMPLEMENTED AND VERIFIED | ticket reuse and expiry refused; 11th socket evicts the oldest (4409); pong rate-limited |
| Push device registry: register, refresh, move to the newest account, unregister; devices disabled when their sign-in ends or the account is deleted | IMPLEMENTED AND VERIFIED | `push.test.ts` |
| Transactional push outbox (queued in the same statement as the message or notification), worker woken by NOTIFY, retries 15 s → 16 min (5 attempts), dead tokens disabled | IMPLEMENTED AND VERIFIED | `push.test.ts`: 503 retried with backoff; FCM `UNREGISTERED` and APNs 410 disable the token |
| FCM HTTP v1 (Android and iOS via FCM): OAuth2 JWT-bearer (RS256), cached access token, re-minted on 401 | IMPLEMENTED AND VERIFIED (protocol) / BLOCKED (live) | local OAuth and FCM servers **verify the RS256 assertion with the public key**; a deliberately broken signer makes the tests fail. Live delivery needs a Firebase project |
| Direct APNs (HTTP/2, ES256 provider token) | IMPLEMENTED AND VERIFIED (protocol) / BLOCKED (live) | local HTTP/2 server verifies the ES256 token. Not used by the shipped app, which registers FCM tokens on iOS too |
| Push text never contains DM text; blocked, suspended or deleted actors and turned-off preferences are skipped at send time | IMPLEMENTED AND VERIFIED | the test DM contains a secret code; it appears in no APNs/FCM payload |
| Push preferences: `pushEnabled`, `messagesEnabled` | IMPLEMENTED AND VERIFIED (server) / IMPLEMENTED BUT NOT VERIFIED (settings UI) | `push.test.ts`; Settings → Notifications |
| DM idempotency: `clientMessageId`, concurrent retries store one message, reuse with other content is 409, id shown to its sender only | IMPLEMENTED AND VERIFIED | `dmReliability.test.ts`: 6 concurrent sends → one 201, five 200, one row, one push |
| Stable history paging (`before`/`after` cursors, `hasMore`) | IMPLEMENTED AND VERIFIED | pages unchanged while new messages arrive; foreign cursors return nothing |
| Conversation search; `%` and `_` literal (also people search, Admin user search, Ads campaign search) | IMPLEMENTED AND VERIFIED | `dmReliability.test.ts` |
| Open a thread by id (push links) | IMPLEMENTED AND VERIFIED | participants only; malformed ids 404 |
| DM privacy: no Admin/moderation/Ads access to message text, no use for ads | IMPLEMENTED AND VERIFIED | `dmPrivacy.test.ts`: Super Admin crawl of all 22 Admin/moderation/Ads GET routes (24 URLs, both auth styles) finds no DM text; static guard fails if any other module reads DM tables |
| Mobile realtime client: tickets, backoff with jitter, handshake timeout, ping/pong, close-code policy, foreground-only | IMPLEMENTED AND VERIFIED (logic) / IMPLEMENTED BUT NOT VERIFIED (on device) | `verification/realtime-client.cjs` (8) |
| Mobile DM outbox: saved before sending, exactly once across crashes, ordered per thread, backoff, refusals wait for the person, cleared at sign-out | IMPLEMENTED AND VERIFIED (logic) / IMPLEMENTED BUT NOT VERIFIED (on device) | `verification/dm-outbox.cjs` (8) |
| Screens update live: thread (catch-up by cursor, live receipts), inbox (plus search), Activity, both badges; polling only as fallback | IMPLEMENTED BUT NOT VERIFIED (on device) | typecheck, both release bundles, `verification/dm-thread.cjs` (3) |
| Push in the app: Firebase Messaging 26.4.0, contextual permission (first visit to Messages/Activity), token refresh, sign-out cleanup, notification taps open `katkee://` links (allowlisted) | IMPLEMENTED AND VERIFIED (logic) / BLOCKED (native builds) | `verification/push-notifications.cjs` (7), `account-links.cjs`; Android Gradle blocked (task #9), iOS needs a Mac |
| Native setup: Android `POST_NOTIFICATIONS`, google-services plugin applied only when `google-services.json` exists, new link hosts; iOS Firebase init only when the plist exists, static frameworks, `aps-environment` entitlement | IMPLEMENTED BUT NOT VERIFIED | Android Gradle and Xcode builds are BLOCKED here |
| Retention of realtime/push records | IMPLEMENTED AND VERIFIED | `retention.test.ts`: expired tickets, finished pushes over 30 days and devices disabled over 90 days removed; queued pushes never dropped by age |
| Reporting a specific DM to moderators (documented safety workflow) | NOT IMPLEMENTED | Users can report the person. Phase 4 |

## Database migration

`0031_realtime_push.sql` (additive): `messages.client_message_id` with a unique index per
(conversation, sender) and a keyset index; `realtime_tickets`; `push_devices`; `push_outbox` with
`claim_push_batch()`; `notification_preferences.messages_enabled`, `push_enabled` (default on);
triggers: a NOTIFY when pushes are queued, revoked sessions disable their devices and close their
sockets, account suspension or deletion closes sockets (and deletion disables devices).
Rollback: the previous API ignores the new tables and columns; messages sent with ids remain valid rows.

## Behaviour changes (deliberate)

- `POST /conversations/:id/messages` answers **200** (not 201) when `clientMessageId` repeats an
  earlier send, with the original message; **409** if the content differs.
- Message lists break timestamp ties by id (`created_at DESC, id DESC`), matching the cursors.
- Malformed conversation ids are 404 (they were 500s), and a 36-dash `storyId` is 422.
- `%` and `_` in people, conversation, Admin user and Ads campaign searches match literally.
- Notification preferences gained `messagesEnabled` and `pushEnabled`. The existing test's
  expected defaults were extended, not removed (`notifications.test.ts`).
- The app connects to the realtime endpoint while open, asks for notification permission on the
  first visit to Messages or Activity, and on sign-out also unregisters push and clears unsent DMs.
- iOS pods default to static frameworks (required by Firebase); `USE_FRAMEWORKS` still overrides.
- `@grpc/grpc-js` (pulled in by the Firebase web SDK, never bundled into the app) is pinned to 1.14.5
  via `overrides`, clearing GHSA-m9gg-hp2v-232j and GHSA-f596-whhp-79r4.

## Files

- Backend, new: `migrations/0031_realtime_push.sql`; `src/realtime/{hub,realtime.routes}.ts`;
  `src/modules/push/{providers,dispatcher,push-worker,push.routes}.ts`;
  `src/modules/auth/session-check.ts`; `scripts/bench-realtime.cjs`; tests `realtime`, `push`,
  `dmReliability`, `dmPrivacy`.
- Backend, changed: `app.ts` (hub, routes), `http/server.ts` (shared session check), `worker.ts`
  and `index.ts` (push worker), `config/env.ts` (push config and production guards),
  conversations (repository, service, routes, dto), notifications (repository, dto),
  `shared/validation.ts` (`containsPattern`), users/admin/ads searches, `media/retention.ts`,
  `docker-compose.prod.yml` and `.env*.example` (push credentials), `package.json` (`ws` 8.22.0),
  `test/notifications.test.ts`, `test/retention.test.ts`.
- Mobile, new: `src/realtime/realtimeClient.ts`, `src/state/{RealtimeContext.tsx,useLiveCount.ts,dmOutbox.ts}`,
  `src/push/{pushNotifications,usePushRegistration}.ts`, `src/api/{push,realtime}.ts`,
  `src/screens/dm/threadState.ts`, `src/utils/serverTime.ts`, `ios/KatkeeMobile/KatkeeMobile.entitlements`.
- Mobile, changed: `App.tsx`, `index.js`, `ConversationScreen`, `DMInboxScreen`, `SendStoryScreen`,
  `ActivityScreen`, `NotificationSettingsScreen`, `AuthContext`, `DMContext`,
  `NotificationsContext`, `RootNavigator`, `profileLinks`, `types`, `DMStack`, `api/conversations`,
  `api/notifications`, Android manifest and Gradle files, iOS `AppDelegate.swift`, `Podfile`,
  `project.pbxproj` (entitlements), `.gitignore` (Firebase config files), `package.json`.
- Verification: `verification/{dm-outbox,realtime-client,dm-thread,push-notifications}.cjs` (new),
  `account-links.cjs` (extended), `scripts/verify.cjs` (wired in; not-verified list extended).
- Docs: `docs/REALTIME_AND_PUSH.md`, this report, superseded notes in `backend/README.md` and
  `mobile/README.md`, `RELEASE_READINESS.md`, `FINAL_SOURCE_STATUS.md`.

## Commands

```sh
node scripts/verify.cjs --bundle --integration      # build, typecheck, source tests, bundles, integration
npm --prefix backend test                           # backend integration suite only
TEST_FILTER='^(realtime|push|dm)' npm --prefix backend test
node --test verification/dm-outbox.cjs verification/realtime-client.cjs verification/dm-thread.cjs verification/push-notifications.cjs
PLAYWRIGHT_MODULE=/path/to/playwright node verification/run-admin-browser.cjs
node backend/scripts/bench-realtime.cjs              # after npm run build; writes docs/performance/<date>-realtime.json
```

## Tests and builds

Evidence: `docs/test-runs/2026-10-05T20-24-04-930Z/` (final run) and `docs/browser-runs/2026-10-05T20-19-22-127Z/`.

- Backend integration: **281 passed, 0 failed, 0 skipped** (256 before this phase + 25 new:
  `realtime` 8, `push` 7, `dmReliability` 7, `dmPrivacy` 2, `retention` +1).
- Source/unit: **89 passed** (62 before + 27 new).
- Admin console (Playwright, Chromium): **13 checks passed**, no page errors, with migration 0031 applied.
- Mobile typecheck and release JS bundles (Android, iOS), including Firebase: passed. The app
  bundle contains the native messaging module only, not the Firebase web SDK.
- Mutation checks (deliberately broken code must fail a test): wrong APNs signature encoding,
  removed UUID guard, 4409 treated as reconnect, outbox not holding later messages — each was caught.
- Bugs found and fixed during the phase: conversation routes returned 500 for malformed ids; a
  36-dash story id reached the database; a waiting message behind an earlier one could
  reschedule its retry at 0 ms in a tight loop (in my own first draft); a long disconnect could
  leave a hole in a thread; the API's Postgres timestamps (`2026-10-05 16:49:38.6+00`) are
  outside ECMAScript's date format, so the new DM code parses them explicitly.

## Security findings

- Fixed: 500s on malformed conversation ids; loose UUID checks on `storyId` and cursors;
  LIKE wildcards in four searches (baseline finding).
- By design and tested: events carry ids only; push text never includes DM text; tokens follow the
  newest account and die with the sign-in; tickets single-use, hashed, 60 s; sockets closed within
  about a second of sign-out or suspension; the app follows only four `katkee://` link shapes from
  notifications; `clientMessageId` is never shown to the recipient; Admin has no DM path.
- Dependencies: Firebase's `@grpc/grpc-js` advisories pinned away. The 20 high findings in the
  React Native build tooling chain (`metro`, `braces`) pre-date this phase and are unchanged
  (build-time only; tracked for Phase 7). Backend: 0 vulnerabilities.
- Open: Ads placements swallow every error (including invalid input) as `ad_insertion_failed`
  without detail; no per-message DM reporting (Phase 4). Android notifications use FCM's default
  channel and icon, and the iOS app badge only updates with the next push (Phase 6). Other screens
  still parse API timestamps with `new Date()` (Phase 6, needs a device to confirm).

## Performance (measured, `docs/performance/2026-10-05-realtime.json`)

4 vCPU Xeon 2.1 GHz, 16 GB; client, two API processes and Postgres 16 on the same machine;
200 users × 10 sockets = 2,000 sockets. Connected in 1.0 s (handshake p50 66 ms, p95 162 ms);
about 14 KB of server memory per socket. 1,000 DMs at concurrency 50 (678/s): event on all 10 of
the recipient's sockets on the **other** instance p50 53 ms, p95 87 ms, p99 105 ms, max 131 ms;
1,000/1,000 delivered. Not measured: push throughput to FCM/APNs, mobile battery and data use,
behavior across real networks.

## Blockers

- Firebase project / APNs key: live push delivery BLOCKED.
- Android Gradle build (`dl.google.com`, `repo.reactnative.dev`) and Xcode (no Mac): native builds
  with Firebase BLOCKED; push and realtime on devices not verified.
- Unchanged from earlier phases: AWS account (S3/CloudFront/SQS/SES), `deb.debian.org` for the
  runtime Docker images.

## Next phase

Phase 4 — trust and safety, Ads, analytics: complete moderation statuses and appeals, abuse
protection (limits on messages, follows, comments, reports), a documented DM reporting workflow
where the reporter attaches the messages, Ads lifecycle gaps (including the placements error
handling above), and DAU/WAU/MAU analytics.
