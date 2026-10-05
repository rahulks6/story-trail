# Katkee baseline report — 5 October 2026

Repository takeover baseline, written **before any code change** in this branch.
Source: `Katkee-Android-iOS-Audit-Checkpoint-2026-10-01-v3.zip`, imported verbatim as
commit `5d2951e`. Every later change in this branch is a diff against that commit.

**Production-readiness status: NOT PRODUCTION-READY.** Of the 30 final release gates
(end of this file), 4 have server-side test evidence (12–15) and none has device
evidence; the remainder are failing, unimplemented, unverified or blocked.

## Labels

| Label | Meaning in this report |
|---|---|
| IMPLEMENTED AND VERIFIED | Code exists and an automated test executed in *this* run proves the behavior (cited). |
| IMPLEMENTED BUT NOT VERIFIED | Code exists, compiles/bundles, but no test or device run proves it works. |
| PARTIAL | Some required parts exist; named parts are missing. |
| BLOCKED | Cannot be completed or verified without something outside this environment (credentials, macOS, devices, cloud account). |
| NOT IMPLEMENTED | No code for it. |

"Mocked" marks evidence that passed only against a test double (for example, an injected
provider gateway), never against a real third-party service.

## Environment used for this baseline

| Item | Value |
|---|---|
| Host | Linux x86_64 container, 4 vCPU, 15 GB RAM |
| Node / npm | v22.22.0 / 10.9.4 |
| PostgreSQL | 16.14 (local throwaway cluster, test-only role `katkee_test`) |
| JDK | OpenJDK 21.0.11 |
| Android SDK | Not installed. `dl.google.com` is denied by this environment's egress policy (HTTP 403). |
| macOS / Xcode | Not available (Linux host) |
| Physical devices | None |

## Commands run (baseline, unmodified source)

```sh
npm --prefix backend ci        # exit 0
npm --prefix mobile ci         # exit 0
PGHOST=localhost PGUSER=katkee_test PGPASSWORD=*** node scripts/verify.cjs --bundle --integration   # exit 0
```

Evidence: `docs/test-runs/2026-10-05T10-20-18-440Z/` (results.json plus one log per step).

| Step | Result | Detail |
|---|---|---|
| Backend TypeScript build | passed | `tsc -p tsconfig.json` |
| Mobile TypeScript check | passed | `tsc --noEmit` |
| Source regressions | passed | 44/44 (`verification/*.cjs`) |
| Ranking unit tests | passed | 14/14 |
| Android production JS bundle | passed | Metro bundle only — **not** a native build |
| iOS production JS bundle | passed | Metro bundle only — **not** a native build |
| PostgreSQL integration suite | passed | **191/191 tests, 57 suites, 0 failed, 0 skipped**; migrations 0001–0027 applied twice (second run a no-op) |
| Android Gradle build | not run | No Android SDK (blocked host) |
| iOS Xcode build | not run | No macOS |

Tests failed: **0**. Tests skipped: **0**. Native builds: **none executed in this environment**.
The checkpoint's own record shows a 3 Oct debug APK built elsewhere with **105 native
library entries below 16 KB ELF alignment** (`docs/current-audit/apk-inspection.json`).

## Inventory by area

### Architecture (as found)

- `backend/` — Node 22 + TypeScript, zero-framework HTTP server (`node:http` + a small router),
  `pg` pool with a `:'name'` literal-escaping query helper, 27 additive SQL migrations,
  hand-rolled HS256 JWT + scrypt passwords, in-memory rate limiters.
- `mobile/` — React Native **0.75.4**, React 18.3, React Navigation 6, old architecture
  (`newArchEnabled=false`), Hermes, vision-camera 4, react-native-video 6, keychain storage.
- `admin/` — separate static Admin console (vanilla JS, CSP, cookie session + CSRF) served
  by the backend under `/admin` behind `ADMIN_CONSOLE_ENABLED`.
- No consumer web application exists (only the Admin console is web).
- No infrastructure-as-code; Docker Compose + Caddy single-VPS deployment files only.

### 2. Locked product rules

| Rule | Status | Evidence / files |
|---|---|---|
| Six tabs exactly: Home, Search, Create, Activity, DM, Profile | IMPLEMENTED BUT NOT VERIFIED | `mobile/src/navigation/MainTabs.tsx`; no device run |
| No Discover tab, no Reels, no music | IMPLEMENTED BUT NOT VERIFIED | No such routes/deps found by source search |
| Stories expire after 24 h | IMPLEMENTED AND VERIFIED | "really expires…1-second TTL" test; `STORY_TTL_SECONDS` default 86400 |
| Tap right/left, swipe up/down, hold, double-tap like | IMPLEMENTED BUT NOT VERIFIED | `mobile/src/screens/story/StoryFeed.tsx` PanResponder; no device run |
| Right rail Like/Comment/Share/More | IMPLEMENTED BUT NOT VERIFIED | `StoryFeed.tsx` |
| Username, **Follow button** and caption visible in Story | **PARTIAL** | Username + caption render; **no Follow button in the Story footer**; avatar is an initial placeholder |
| Highlights portrait cards, exactly 3 per row | IMPLEMENTED BUT NOT VERIFIED | `HighlightsRow.tsx`, `DraggableGrid.tsx` |
| Public aggregate view count; identities owner-only | IMPLEMENTED AND VERIFIED | "the view count is visible to any viewer…but who they are is owner-only" |
| Admin/Ads absent from consumer navigation | IMPLEMENTED BUT NOT VERIFIED | Admin is a separate web console; consumer nav has no admin route |
| Sponsored Stories labelled | IMPLEMENTED BUT NOT VERIFIED | `mobile/src/screens/ads/SponsoredStory.tsx` |
| No client-only authorization | PARTIAL | Server checks found throughout; **but** legacy `/api/v1/moderation/*` endpoints let an admin act with a plain consumer bearer token, bypassing the Admin console session/CSRF/reauth (and any future MFA) |

### 3. Professional UX

| Item | Status | Notes |
|---|---|---|
| Design tokens (colors/type/spacing) | IMPLEMENTED BUT NOT VERIFIED | `mobile/src/theme/*`; locked palette `#0B0B0B` / `#FFC800` |
| Loading / empty / error states | PARTIAL | Present on most screens; Home loading is plain text; no global offline banner |
| Offline state | NOT IMPLEMENTED | No connectivity detection; a cold start while offline drops the user to the sign-in screen |
| Accessibility labels | PARTIAL | Many controls labelled; Story gesture surface exposes accessibility actions |
| Reduced motion | IMPLEMENTED BUT NOT VERIFIED | `useReducedMotion` used for like pulse |
| Deep links | PARTIAL | Only `katkee://user/<name>` is routed. Share sheet emits `katkee://story/<id>`, which **no route or Android intent filter handles** (broken deep link) |

### 4. Home and Stories

| Item | Status | Notes |
|---|---|---|
| Ranked Home feed, creator grouping, ordering | IMPLEMENTED AND VERIFIED | home-feed and ranking tests; cursor snapshots |
| Like / comment / share / counts | IMPLEMENTED AND VERIFIED | likes, comments, sharing suites |
| Report / Block / Mute / Not Interested | IMPLEMENTED AND VERIFIED (server) / NOT VERIFIED (UI) | moderation, blocking, mute, not-interested suites; `StoryMoreMenu.tsx` |
| Progress bars, hold-to-pause, resume, playback restoration | IMPLEMENTED BUT NOT VERIFIED | `StoryFeed.tsx` |
| Next Story / next creator preloading | NOT IMPLEMENTED | Each Story waits for two API calls (detail + media) before rendering |
| Poster-first / adaptive loading | NOT IMPLEMENTED | No posters or renditions exist server-side |
| Network recovery | PARTIAL | Manual retry buttons only |
| Expired / removed content handling | IMPLEMENTED AND VERIFIED (server) | expiry and moderation tests; UI shows "Story unavailable" |
| Organic fallback when ad unavailable | IMPLEMENTED BUT NOT VERIFIED | placements endpoint returns `[]` on failure |

### 5. Create, camera, editor

| Item | Status | Notes |
|---|---|---|
| Camera/mic/gallery permissions, flip, flash, timer, focus, pinch + record-drag zoom, capture | IMPLEMENTED BUT NOT VERIFIED | `CameraScreen.tsx` (vision-camera 4); no device |
| Text, captions, mentions, stickers, location, date/time, filters, crop | IMPLEMENTED BUT NOT VERIFIED (UI) / VERIFIED (persistence) | "overlays, filter, and drawing survive publish", crop round-trip tests |
| Pen/marker/highlighter/eraser, undo/redo, layer order, delete target | IMPLEMENTED BUT NOT VERIFIED | `DrawingCanvas.tsx`, `DraggableCanvasObject.tsx` |
| Draft save/restore, discard confirmation | IMPLEMENTED BUT NOT VERIFIED | `draftStorage.ts`, `validateSavedDraft.ts` (source regressions cover validation) |
| Publish progress / retry / failure recovery | PARTIAL | Durable outbox retries while the app is open; states are queued/uploading/publishing/failed/published — no "Processing" state because there is no processing |
| Original audio mute/unmute | IMPLEMENTED AND VERIFIED (persistence) | audioMuted tests |
| Preview/export parity | NOT VERIFIED | Overlays are rendered live at view time, never baked |

### 6. Upload and media infrastructure

| Item | Status | Notes |
|---|---|---|
| MIME / magic-byte validation, size limits | IMPLEMENTED AND VERIFIED | media upload suites |
| Duration / video dimension limits | NOT IMPLEMENTED | Video width/height/duration always `null` |
| Object storage (S3) | NOT IMPLEMENTED | `LocalDiskMediaStorage` only — production stores media on local disk |
| Secure upload URLs (presigned) | NOT IMPLEMENTED | Uploads stream through the API process |
| Processing, posters, thumbnails, renditions, transcoding | NOT IMPLEMENTED | `media.status` is always `ready` |
| CDN delivery (CloudFront) / private media authorization | PARTIAL | Authorized byte-range streaming from the API (verified); no CDN |
| Resumable uploads, background uploads | NOT IMPLEMENTED | Whole-file POST; OS background transfer absent |
| Retry/backoff, offline queue, duplicate prevention, idempotent publish | PARTIAL | Idempotent publish VERIFIED ("replays concurrent publish retries once"); queue retries only while app open, manual retry |
| Expired-story cleanup, temp-file cleanup, retention jobs | NOT IMPLEMENTED | No scheduled jobs exist |

### 7. Profile, Search, social graph

| Item | Status | Notes |
|---|---|---|
| Follow/unfollow/requests, followers/following, block, mute | IMPLEMENTED AND VERIFIED | follow, blocking, mute suites |
| Display name, bio (150), interests (≤5), username change | IMPLEMENTED AND VERIFIED | profile metadata tests incl. concurrent username claims |
| Avatar choose/upload | IMPLEMENTED AND VERIFIED (server) | avatar persistence/foreign-avatar tests |
| Avatar crop | NOT IMPLEMENTED | |
| Username availability endpoint | NOT IMPLEMENTED | Only discovered on save (409) |
| Reserved names | PARTIAL | 5 hard-coded names |
| Profanity protection | NOT IMPLEMENTED | |
| Username change rules (cooldown/history) | NOT IMPLEMENTED | Unlimited renames; old handle immediately claimable by others |
| Immutable internal IDs | IMPLEMENTED AND VERIFIED | follows/DMs/mentions keyed by UUID; mention re-resolution test |
| Search by username/display name, debounce | IMPLEMENTED AND VERIFIED (server) / NOT VERIFIED (UI) | search suite; `useDebouncedValue` |
| Suggested users before typing, recent searches, inline Follow | NOT IMPLEMENTED | |
| Search cancellation | PARTIAL | Stale results ignored, request not aborted |
| Share profile / report profile / other-user More menu | PARTIAL | Report profile exists; share-profile link not found in UI |

### 8. Highlights and Archive

| Item | Status | Notes |
|---|---|---|
| Create/name/select/cover/add/remove/reorder, survive expiry | IMPLEMENTED AND VERIFIED | Highlights suites (incl. "survive a Story's normal 24h expiry") |
| Long-press drag, cross-row drag | IMPLEMENTED BUT NOT VERIFIED | `DraggableGrid.tsx` |
| Owner-only Archive, month grouping, multi-select | IMPLEMENTED BUT NOT VERIFIED (UI) | `ArchiveScreen.tsx`; archive endpoint verified |
| Delete permanently from Archive | PARTIAL | Soft delete only; no purge of media bytes |

### 9. Activity and notifications

| Item | Status | Notes |
|---|---|---|
| Likes, comments, follows, follow requests, mentions, preferences | IMPLEMENTED AND VERIFIED | notifications suites |
| Replies, Story replies as Activity types | NOT IMPLEMENTED | |
| Today/Earlier grouping, unread state, badge | IMPLEMENTED BUT NOT VERIFIED | `ActivityScreen.tsx` |
| Push notifications | NOT IMPLEMENTED | No device-token registry, no FCM/APNs |
| Realtime updates | NOT IMPLEMENTED | 20 s polling only |

### 10. Direct messages

| Item | Status | Notes |
|---|---|---|
| Inbox, 1:1 chat, Story share into chat, read state, unread count, membership authorization, block enforcement | IMPLEMENTED AND VERIFIED | conversations suites |
| Delivery states sent/delivered/read | IMPLEMENTED AND VERIFIED | "progresses sent -> delivered -> read" |
| Optimistic send, retry | IMPLEMENTED BUT NOT VERIFIED | `ConversationScreen.tsx` |
| Idempotent send (client message id) | NOT IMPLEMENTED | A retried send after a lost response duplicates the message |
| Offline send queue | NOT IMPLEMENTED | |
| Realtime delivery, push | NOT IMPLEMENTED | 4 s polling while a thread is open |
| Pagination | PARTIAL | Offset pagination (shifts as new messages arrive) |
| Conversation search | NOT IMPLEMENTED | |

### 11. Authentication and account security

| Item | Status | Notes |
|---|---|---|
| Email signup/login/logout, refresh rotation, revocation on suspension | IMPLEMENTED AND VERIFIED | signup/login/refresh suites |
| Google login | IMPLEMENTED AND VERIFIED (Mocked) / BLOCKED (live) | Test uses an injected gateway; no OAuth client IDs |
| Phone OTP, cooldown, attempt limits | IMPLEMENTED AND VERIFIED (Mocked) / BLOCKED (live) | Twilio Verify integration; no credentials |
| Password reset / account recovery | NOT IMPLEMENTED | |
| Account deletion, reauthentication, provider linking/unlinking | IMPLEMENTED AND VERIFIED | deletion and linking suites |
| Secure token storage | IMPLEMENTED BUT NOT VERIFIED | Keychain/Keystore adapter; mocked adapter tests only |
| Brute-force / rate limits | PARTIAL | Per-IP in-memory limiter (resets on restart, not shared across instances); no per-account lockout |
| Suspicious-login controls, session list/revoke-all | NOT IMPLEMENTED | |
| Sign in with Apple (App Store 4.8 when Google login offered) | NOT IMPLEMENTED | |

### 12. Admin and Super Admin

| Item | Status | Notes |
|---|---|---|
| Separate console, server-enforced ADMIN/SUPER_ADMIN + permission list, CSRF, origin checks, 30 min sessions, reauth for critical actions | IMPLEMENTED AND VERIFIED | "rejects USER, missing sessions, CSRF violations and self-escalation" |
| Add/disable admin, assign/remove permissions (Super Admin only) | IMPLEMENTED AND VERIFIED | adminAds suite |
| Append-only audit table (DB trigger) | IMPLEMENTED BUT NOT VERIFIED | Trigger exists in 0020; no test attempts UPDATE/DELETE |
| Audit-log filtering | NOT IMPLEMENTED | List only |
| Real MFA (TOTP) enrollment/challenge, backup codes | NOT IMPLEMENTED | `admin_grants.mfa_required` flag only blocks login; no TOTP |
| Login rate limit | IMPLEMENTED BUT NOT VERIFIED | In-memory |
| Suspicious admin-login alerts | NOT IMPLEMENTED | |
| No admin DM access | IMPLEMENTED BUT NOT VERIFIED | No DM routes in admin |

### 13. Moderation and safety

| Item | Status | Notes |
|---|---|---|
| Report story/comment/profile/ad, categories, queue, priority, claim, keep/remove/restrict/suspend/restore, concurrent-review protection, immutable action log, appeals | IMPLEMENTED AND VERIFIED | "moderation is atomic, concurrent-safe…allows explicit restoration and appeals" |
| Status vocabulary OPEN/UNDER_REVIEW/ACTIONED/DISMISSED/APPEALED/CLOSED | PARTIAL | Stored lowercase (`pending` used for OPEN); appeal decisions do not move reports to APPEALED/CLOSED |
| Moderator notes, report history panel | PARTIAL | Resolution note only |
| Evidence retention, policy-based cleanup | NOT IMPLEMENTED | |
| Spam/bot/fake-view/mass-like/mass-comment protection | PARTIAL | Report rate limit + global per-IP limiter only |
| Malicious-link protection | NOT IMPLEMENTED | |
| Impersonation reporting | PARTIAL | Ads only |

### 14. Ads and Sponsored Stories

| Item | Status | Notes |
|---|---|---|
| Advertisers, campaigns, creative, statuses DRAFT…COMPLETED, independent review, caps (user/daily/session), organic gap, hide, report, events | IMPLEMENTED AND VERIFIED | "ads require independent approval, enforce caps/ownership/hide…" |
| CTA set | PARTIAL | "View Profile" CTA missing |
| Audience controls (broad, non-sensitive) | NOT IMPLEMENTED | No targeting fields at all (no sensitive targeting either) |
| Lifecycle wizard Details→Creative→Audience→Budget/Schedule→Preview→Review→Activate | PARTIAL | Single form in Admin console |
| Automatic completion at end date / budget | NOT IMPLEMENTED | Manual `complete` transition only |

### 15. Analytics and DAU

| Item | Status | Notes |
|---|---|---|
| Recommendation events (impressions, views, completions, etc.) | IMPLEMENTED AND VERIFIED | events suite |
| General product analytics (sessions, DM, uploads, crashes) with stable event IDs | NOT IMPLEMENTED | |
| DAU/WAU/MAU, retention, Admin analytics dashboard | NOT IMPLEMENTED | Admin dashboard shows moderation counts only |

### 16. Database and backend

| Item | Status | Notes |
|---|---|---|
| Migrations, indexes, bounded pool (max 10), statement timeout | IMPLEMENTED AND VERIFIED | migration runner applied twice in test |
| Transactions | PARTIAL | Critical paths use single-statement CTEs or plpgsql functions; no general transaction helper |
| Structured errors and logs | PARTIAL | JSON request logs; no request IDs |
| Health check | IMPLEMENTED AND VERIFIED | health suite |
| Readiness check, graceful shutdown (drain + pool close) | NOT IMPLEMENTED | SIGTERM closes the listener only |
| Backups, restore testing, retention jobs | NOT IMPLEMENTED | |
| Migration rollback plan | NOT IMPLEMENTED | |
| Staging/production separation, secrets management | PARTIAL | Env-based config with strong-secret checks; no environment definitions |

### 17–19. Infrastructure, performance, release

| Item | Status | Notes |
|---|---|---|
| AWS Mumbai (ECS, RDS, S3, CloudFront, SQS) | NOT IMPLEMENTED | Only single-VPS Compose files |
| Monitoring, billing alerts | NOT IMPLEMENTED | |
| Performance measurements on devices | BLOCKED | No devices |
| Android 16 KB alignment | NOT IMPLEMENTED (failing) | 105 misaligned native entries recorded 3 Oct |
| Android debug APK | NOT VERIFIED here | Built elsewhere 3 Oct on RN 0.75.4; cannot rebuild without SDK |
| Signed release APK / AAB | NOT IMPLEMENTED | Release check intentionally fails; no upload key |
| iOS archive / TestFlight | BLOCKED | No macOS/Xcode; AppIcon images and privacy declarations incomplete |
| Web consumer app | NOT IMPLEMENTED | |
| Admin web console | IMPLEMENTED AND VERIFIED (API) / NOT VERIFIED (browser) | |

## Security findings at baseline

1. **Admin power reachable without the Admin console session.** `POST /api/v1/moderation/reports/:id/resolve`, `/users/:username/suspend` and `/unsuspend` accept a normal consumer access token for any user with an admin grant. These bypass the console's cookie session, CSRF, origin check, reauthentication — and would bypass MFA once added.
2. **No Admin MFA**; a stolen admin password is sufficient.
3. **Rate limits are in-memory per process**; counters reset on deploy and are not shared across instances.
4. **Search wildcards are not escaped** (`%`/`_` in a query match broadly) — a correctness issue, not injection (values are escaped).
5. **Access tokens are not revoked on suspension/deletion** (bounded by the 15-minute TTL; the server does re-check `is_active` on every bearer request, which closes most of this).
6. **Media is served by the API process from local disk**; no object storage isolation.
7. **Retried DM sends duplicate messages** (no idempotency key).

## Final release gate at baseline

| # | Gate | Baseline |
|---|---|---|
| 1 | Android 16 KB alignment | FAIL (105 misaligned entries) |
| 2 | Signed AAB | NOT BUILT |
| 3 | iOS archive or BLOCKED | BLOCKED (no macOS) — acceptable label, not a pass |
| 4 | Web production build | Admin console is static; no consumer web build |
| 5 | Google login in production | BLOCKED (credentials) |
| 6 | Phone OTP in production | BLOCKED (credentials) |
| 7 | Password recovery | NOT IMPLEMENTED |
| 8 | Story creation | Server VERIFIED; device NOT VERIFIED |
| 9 | Upload on Wi-Fi/mobile/offline/reconnect | NOT VERIFIED |
| 10 | Background/resumable uploads | NOT IMPLEMENTED |
| 11 | Video processing and CDN | NOT IMPLEMENTED |
| 12 | Story expiration | VERIFIED |
| 13 | Highlights survive expiration | VERIFIED |
| 14 | Public aggregate view counts | VERIFIED |
| 15 | Viewer identities private | VERIFIED |
| 16 | Realtime DMs | NOT IMPLEMENTED |
| 17 | Push notifications | NOT IMPLEMENTED |
| 18 | Admin MFA | NOT IMPLEMENTED |
| 19 | Unauthorized Admin access blocked | PARTIAL (console yes; legacy moderation API bypass) |
| 20 | Moderation and appeals | VERIFIED (server) |
| 21 | Audit logs immutable and complete | PARTIAL (trigger untested) |
| 22 | Ads lifecycle | VERIFIED (server); delivery on device NOT VERIFIED |
| 23 | Failed ads fall back to organic | NOT VERIFIED |
| 24 | DAU/WAU/MAU and retention | NOT IMPLEMENTED |
| 25 | Backups restore | NOT IMPLEMENTED |
| 26 | Security and IDOR tests | PARTIAL (many authorization tests; no dedicated IDOR sweep) |
| 27 | Performance measured | BLOCKED (no devices) |
| 28 | Crash/error monitoring | NOT IMPLEMENTED (local ErrorBoundary only) |
| 29 | Privacy policy, Terms, deletion process | PARTIAL (drafts in `legal/`, need legal review) |
| 30 | Store metadata and screenshots | PARTIAL (`STORE_LISTING.md` text; no screenshots) |

Counted as passing with evidence: 12, 13, 14 and 15 are server-verified; 3 is an accepted
BLOCKED label. **Production-ready: no.**

## Blockers that this environment cannot remove

- `dl.google.com` is denied by the network policy, so the Android SDK cannot be installed
  from Google directly. (Docker Hub, Maven Central, `maven.google.com` and the Gradle
  distribution host are reachable.)
- No macOS/Xcode: iOS build, archive and TestFlight are BLOCKED.
- No physical devices: all device, camera, gesture, permission and performance acceptance
  is BLOCKED.
- No AWS account, Google OAuth client IDs, Twilio credentials, FCM/APNs keys, Apple team or
  Play Console: live provider verification is BLOCKED; integrations can be built and tested
  against local doubles only and must be labelled that way.

## Next phase

Phase 1 — authentication, account security, Admin RBAC/MFA and audit immutability
(password reset, TOTP MFA + backup codes, admin re-auth/expiry, closing the legacy
moderation-API bypass, audit-trigger tests, session management).
