# Phase 6 — Mobile UX audit and fixes

Date: 6 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`. Push design: `docs/REALTIME_AND_PUSH.md` (updated).

Method: the screens were read end to end (Home feed and Story viewer, Create: camera, editor and
upload queue, Profile, Search, Highlights, Activity, DM inbox and thread, settings, auth). Each
defect was fixed with a test that drives the real component or code path (Jest with React Native's
preset, `node:test` source checks, or the backend integration suite). Each test was mutation-
checked: it fails against the previous code. Nothing here ran on a phone. The Android build
is blocked by the network policy and there is no Mac, so device behaviour is labelled
IMPLEMENTED BUT NOT VERIFIED wherever it matters.

## Locked product rules (now enforced by tests)

| Rule | Status | Evidence |
|---|---|---|
| Navigation is exactly Home, Search, Create, Activity, DM, Profile (no Admin or Ads tab) | IMPLEMENTED AND VERIFIED | `navigation.test.tsx` renders the real navigator |
| Home: tap right/left within a creator, swipe up/down between creators, hold pauses, double-tap likes | IMPLEMENTED AND VERIFIED (logic) / NOT VERIFIED on devices | `storyFeed.test.tsx` drives the real feed's responder |
| Right rail is Like, Comment, Share, More | IMPLEMENTED AND VERIFIED | `storyFeed.test.tsx` |
| View count is public; viewers and Insights are owner-only | IMPLEMENTED AND VERIFIED | `storyFeed.test.tsx` (client), existing backend tests (server) |
| Highlights are permanent portrait cards, three per row | IMPLEMENTED AND VERIFIED | `highlights.test.tsx` measures sizes and positions |

## Defects found and fixed

| # | Defect | Fix | Status | Evidence |
|---|---|---|---|---|
| 1 | Tab bar had no tab semantics and sat under the home indicator and the Android navigation bar | Tab list with selected state; safe-area padding | IMPLEMENTED AND VERIFIED | `navigation.test.tsx` |
| 2 | No safe-area handling on edge-to-edge screens: progress bars under the status bar; close button overlapping them | `useScreenInsets` on Home and Story viewer overlays, Sponsored Stories, Camera, Editor, Highlight and archive viewers, Activity, Profile | IMPLEMENTED BUT NOT VERIFIED (devices) | typecheck; insets hook test |
| 3 | Log in and Sign up: no keyboard handling, autofill hints or field chaining; username rule not shown | Shared form fields, password-manager hints, Next/submit keys, live password rules | IMPLEMENTED AND VERIFIED | `auth.test.tsx` (5) |
| 4 | **Android crash** on Like or double-tap: vibration without `VIBRATE` throws a SecurityException | Permission declared; guard checks every native capability is declared | IMPLEMENTED BUT NOT VERIFIED (Android build blocked) | `native-permissions.cjs` |
| 5 | View count showed the icon's name ("viewers 12") | Eye icon | IMPLEMENTED AND VERIFIED | `storyFeed.test.tsx` |
| 6 | Highlight cards, New and Reorder had no accessible names | Buttons named "Food, Highlight", "New Highlight", "Reorder Highlights" | IMPLEMENTED AND VERIFIED | `highlights.test.tsx` |
| 7 | Server timestamps parsed with `Date`: Hermes may show "Invalid Date" | Everything goes through `serverTime.ts` | IMPLEMENTED AND VERIFIED | `server-time.cjs` fails on any raw parse |
| 8 | Android notifications landed in "Miscellaneous", and the colour launcher icon showed as a white blob | "Messages" and "Activity" channels, sent per push; monochrome icon, tinted with the accent | IMPLEMENTED BUT NOT VERIFIED (Android build) | `push.test.ts`, `notification-config.cjs` |
| 9 | iPhone badge stayed stale after reading Activity or a conversation | Silent badge push after a read that lowers the total (iPhones only, coalesced, push switch honoured); badge applied in the foreground | IMPLEMENTED AND VERIFIED (server, local APNs/FCM) / NOT VERIFIED (iPhone) | `push.test.ts` (6 new) |
| 10 | **Keyboard covered inputs on Android**: the app is edge-to-edge, so the window is no longer resized, and every keyboard view did nothing on Android | `KeyboardAvoider` applies the same behaviour on both platforms (RN still reports the keyboard) | IMPLEMENTED AND VERIFIED (logic, with RN's own `KeyboardAvoidingView` and Android keyboard events) / NOT VERIFIED (devices) | `keyboardAvoider.test.tsx`, `dmThread.test.tsx`, `keyboard-avoidance.cjs` |
| 11 | Story editor: the caption field sat under the keyboard on **both** platforms | The caption panel rises above the keyboard; the canvas and stickers stay put | IMPLEMENTED BUT NOT VERIFIED (devices) | `keyboardAvoider.test.tsx` ("position"), guard |
| 12 | DM thread: keyboard offset hard-coded to 90; Edit Profile, Appeals and Account security had none | Real header height (`useHeaderHeight`) | IMPLEMENTED AND VERIFIED (logic) | `dmThread.test.tsx` |
| 13 | Report sheet, Delete-account sheet and phone sign-in had no keyboard handling | Wrapped; fields labelled; buttons with roles and busy state | IMPLEMENTED BUT NOT VERIFIED (devices) | `keyboard-avoidance.cjs` |
| 14 | DM thread: reporting only by long-press; bubbles didn't say who sent them; emoji panel stacked on the keyboard; composer unlabelled | Report is an accessibility action; "@alice: hello"; the panel replaces the keyboard | IMPLEMENTED AND VERIFIED | `dmThread.test.tsx` (3) |
| 15 | Activity: a failed first load spun forever; a failed page retried on every scroll; unread was invisible to screen readers; full locale timestamps | Error with Try again; banner; footer retry; "2h ago"; row labels with "Unread"; filters are tabs | IMPLEMENTED AND VERIFIED | `activity.test.tsx` (3); writing them caught a doubled full stop |
| 16 | Every list showed initials; photos appeared only on profile pages | `avatarMediaId` added to 12 list responses; shared `Avatar` | IMPLEMENTED AND VERIFIED (server, component) | `avatars.test.ts` (2), `avatar.test.tsx` (3) |
| 17 | 72 tappable controls had no accessibility role | 63 buttons (3 hits were doc-comment text); DM bubbles are buttons only where a tap acts; Archive thumbnails labelled | IMPLEMENTED AND VERIFIED (static) | `accessibility-roles.cjs` |
| 18 | No single app version | `build-config.json` feeds analytics, Android `versionName` and the iOS check | IMPLEMENTED AND VERIFIED (source) / NOT VERIFIED (native builds) | release config checks |

Carry-overs from Phase 4 are all closed: the Android channel and icon (8), iPhone badge
clearing (9), Hermes-safe timestamps (7), and the app version for analytics (18).

Checked and already sound: a denied camera shows an explanation, Open Settings and a gallery
fallback. The DM inbox shows an error with Try again. Background side effects (marking read,
recording a view) deliberately don't interrupt the UI when they fail.

## Database migration (additive)

`0036_push_badge.sql`:
- Widens the `push_outbox.kind` check with `badge`.
- Adds a partial unique index, so at most one not-yet-attempted badge update waits per person;
  a retry never collides with a newer one.
- Adds `queue_badge_update(uuid)`, which does nothing for people with no active iPhone, so it
  never wakes the push worker for them.

No data rewritten.

## API changes (additive, backward-compatible)

- `avatarMediaId` (null when none) on:
  - search results, followers and following, follow requests, muted accounts;
  - comments; DM conversations (list, open, single); notification actors; Story viewers;
  - the following feed and the home feed.

  Blocked accounts are left out, because their photos are never served. The app treats the field
  as optional, for older servers.
- Push: FCM `android.notification.channel_id` is `messages` or `activity`. A `badge` push carries
  no text and no sound, and goes out at APNs priority 5 with collapse id `badge`.

## Behaviour changes (deliberate)

- Reading Activity or an unread conversation sends the reader's iPhones a silent badge update
  about 3 seconds later. Several reads in a row send one.
- `mobile/firebase.json` is new:
  - default Android channel `activity`;
  - notification colour `@color/notification_accent`, the accent from `colors.ts`, `#FFC800`;
  - iOS foreground presentation `["badge"]`: the badge updates, but still no banner while the app
    is open.
- On Android, content moves above the keyboard once it has opened (it snaps; React Native's
  `KeyboardAvoidingView` has no per-frame Android animation).
- The Android status-bar icon is a **provisional** white "K" (`res/drawable/ic_notification.xml`),
  because no approved symbol exists (BRAND.md). Replace that one file with the approved symbol.
- Noted, not changed: BRAND.md lists the accent as `#FCB020`, while `colors.ts` ("locked master
  spec palette") and the running app use `#FFC800`. Notifications follow the app.

## Files

- **Backend:**
  - `migrations/0036_push_badge.sql`
  - `modules/push/{providers,dispatcher}.ts`
  - read paths in `modules/notifications/notifications.repository.ts` and
    `modules/conversations/conversations.repository.ts`
  - avatar fields in the users, social, comments (repository and route), conversations,
    notifications, stories and recommendations modules
  - tests `push.test.ts` (6 new) and `avatars.test.ts` (new)
- **Mobile:**
  - new components `KeyboardAvoider`, `Avatar`; `utils/serverTime.ts` (`serverDate`, `timeAgo`)
  - the screens and components named above
  - `android/app/src/main/{AndroidManifest.xml, java/com/katkee/MainApplication.kt, res/drawable/ic_notification.xml, res/values/{colors,strings}.xml}`
  - `firebase.json`; `package.json`: `@react-navigation/elements` declared at the version already
    installed
  - 9 Jest suites in `__tests__/`
- **Verification:**
  - `server-time.cjs`, `native-permissions.cjs`, `notification-config.cjs`, `keyboard-avoidance.cjs`,
    `accessibility-roles.cjs`
  - `scripts/verify.cjs` (Jest, test typecheck, new checks)
- **Docs:** `docs/REALTIME_AND_PUSH.md`; this report.

## Commands

```sh
node scripts/verify.cjs --bundle      # backend build, mobile + test typechecks, Jest, source checks, ranking tests, both bundles
sudo -u postgres env PGHOST=/var/run/postgresql PGUSER=postgres node backend/scripts/run-tests.cjs   # integration (peer auth)
TEST_FILTER='^(push|avatars)\.test' npm --prefix backend test
(cd mobile && npx jest --ci)
```

## Tests and builds

Evidence: `docs/test-runs/2026-10-06T09-22-59-297Z/`:
- `results.json` and one log per step;
- `database-integration.log` and its `.json` summary;
- `mobile-component-tests.json`, per-test Jest results. `verify.cjs` now writes this on every run.

- **Backend integration:** **315 passed, 0 failed, 0 skipped** in 32 files (307 after Phase 4 + 8 new: `push` 6, `avatars` 2), run as the local `postgres` OS account over the Unix socket (peer authentication); `database-integration.json` is computed from the log.
- **Mobile component tests (Jest):** 24 passed in 9 suites: navigation 2, auth 5, smoke 1,
  storyFeed 3, highlights 2, dmThread 3, keyboardAvoider 2, activity 3, avatar 3.
- **Source and unit checks:** 114 passed (101 after Phase 4 plus the new checks listed under
  Files). Ranking unit tests passed.
- **Builds:**
  - Backend build: passed.
  - Mobile typecheck and test typecheck: passed.
  - Android and iOS release JavaScript bundles: passed (about 1.98 MB each).
- **Mutation checks**, each failing the test that should catch it:
  - DM thread and Activity reverted to the previous screen: 3/3 and 3/3 tests fail.
  - `KeyboardAvoider` made iOS-only: the 3 Android tests fail.
  - Highlights and timestamps reverted: their tests fail.
  - Badge enqueue removed (conversation read, single Activity read), Android channel removed,
    badge sent to Android, unique index blocking retries: each fails the matching push test.
  - `StoryMoreMenu` reverted: the role guard fails.
- **Bugs caught by writing the tests:**
  - Comment responses dropped the new avatar field (route allowlist).
  - Activity row labels read "you.. 2h ago".
  - A stale root-owned `/tmp` media directory broke an existing media test when run as `postgres`
    (environment; ownership fixed).

## Security and privacy findings

- Avatar IDs in lists are opaque version keys. The image is still served only by the
  access-checked endpoint, which hides avatars between blocked people (tested) and from
  signed-out callers.
- Badge pushes carry a number and nothing else, go only to the person's own active iPhones, and
  honour the push switch. DM text still never leaves the server in a push (existing test).
- Dependencies:
  - Added: `@react-navigation/elements`, declared at 2.9.44, already installed through React
    Navigation. Jest 30 tooling (development only), added earlier in this phase.
  - Backend production dependencies: 0 vulnerabilities.
  - Mobile: the same 20 high findings in build tooling as Phase 4, plus 8 in the Jest tooling
    (development only, not shipped).

## Performance

- Badge updates add one row per person per burst of reads, and none for people without an
  iPhone, so the worker is not woken for them. The read statements gain one function call.
- Avatar fields add one column to existing queries; no joins.
- The app fetches each visible row's thumbnail-sized avatar.
- Not measured: image loading, scrolling and keyboard timing on devices. No performance
  compliance is claimed.

## Blockers

- **Android builds:** the egress proxy still rejects `dl.google.com`, `repo.reactnative.dev` and
  `deb.debian.org` (`connect_rejected`, rechecked 6 October 09:2x UTC). Phase 5 (APK/AAB, 16 KB)
  cannot start.
- **iOS:** no Mac, so iOS is BLOCKED.

So every native change in this phase is untested as a build:
- Kotlin channels, manifest, resources;
- `firebase.json` merge;
- keyboard behaviour inside Android Modal windows (the comment, report and delete sheets),
  which needs a device check;
- foreground badge presentation.

Live FCM/APNs delivery needs credentials.

## Known gaps

- After sign-out an iPhone keeps its last badge, and Android keeps already-shown notifications
  after the thread is read. Clearing either needs a small native call that can't be built here.
- The notification icon is provisional artwork; launcher icons are still the template's.
- The BRAND.md accent value disagrees with the app's palette (see above).

## Next phase

**Phase 7**:
- web production build;
- Admin console updates;
- infrastructure as code;
- the final release-gate report.

Phase 5 (Android native upgrade, 16 KB alignment, debug/release APK and AAB) resumes when the
blocked hosts are allowed.
