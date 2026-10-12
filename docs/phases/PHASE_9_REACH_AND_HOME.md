# Phase 9: nearby reach for public Stories, and the Home mix

Date: 12 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`.

**Production-ready: no.** The server work is tested against a real PostgreSQL 16 and the app
work in component tests. Nothing has run on a device: the Android build is still blocked by the
network policy and there is no Mac for iOS. The release gate in the
[Phase 7 report](PHASE_7_PRODUCTION_HARDENING.md) is unchanged by this phase.

## What you asked for, and what was decided

Katkee stays Stories-only. A **public** account's Stories should reach people beyond its
followers, the way short videos do elsewhere: people **nearby first**, and **more reach when
people engage**. Home should be a **random mix of people you follow and new people**.
Your answers to the four questions before the phase:

| Question | Answer | Result |
|---|---|---|
| Taps on Home | Right = next (keep today's gestures) | Unchanged: tap right for the next Story, left for the previous one, swipe up for the next person, down for the previous one, hold to pause, double-tap to like |
| What "nearby" uses | Approximate location, opt-in | A city-sized area, never shown, can be turned off, with your time zone as the fallback region |
| Home mix | 60% people you follow, 40% new | 3 of every 5 places go to people you follow, in a new shuffle on every refresh |
| Next phase | Reach + Home mix | This phase |

## How it works

**Your area.** If you turn on Nearby Stories (a one-time invitation, or Settings, under
Privacy), the phone takes one low-accuracy reading, turns it into a 4-character geohash cell
(about 39 x 20 km) and sends only that cell. Coordinates never leave the phone. Android asks
for approximate location only; iOS asks with reduced accuracy by default. The device's time zone
is always sent, because it needs no permission and lets new Stories still come from your region.
Your area is readable only by you (`GET/PUT /api/v1/users/me/area`, never cached). It is never
part of a profile, search result, suggestion, feed, ad or Admin screen. It stops counting
after 30 days without a refresh and is then deleted. It is deleted at once when you turn
Nearby off (the cell) or delete your account.

**Reach stages.** Every public Story from a public account starts at stage 1:

| Stage | Who new it can reach | Test audience | Moves up when engagement is at least |
|---|---|---|---|
| 1 | people nearby (your cell and the 8 around it) | 50 people | 0.30 |
| 2 | the wider area (about 156 x 156 km and around it) | 300 people | 0.35 |
| 3 | people in the same time zone | 2,000 people | 0.40 |
| 4 | everyone | no limit | (last stage) |

- Followers always see your Stories, whatever the stage.
- Only people who did not follow you when they saw the Story count, each person once.
- Engagement counts:
  - completions (0.4 each);
  - likes (0.3);
  - comments and shares (0.6, counted once per person);
  - profile visits after seeing it (0.4);
  - follows after seeing it (1.0).
- It counts against:
  - "Not interested" (−1.0);
  - quick skips (−0.3).
- The score is smoothed so a handful of viewers can't decide it.
- When the test audience is used up, the Story is judged. It moves up if the viewers engaged,
  or is **held** (it keeps reaching followers but no new people) if they didn't.
- After two hours with enough viewers, it is judged on what it has.
- If too few people nearby saw it to tell, it **widens** anyway, so a Story from a quiet area
  still finds an audience.
- Where either person shares no area, the time zone stands in for it. Where neither has one,
  nothing narrows it.
- **Never any reach** for:
  - private accounts and followers-only Stories;
  - removed Stories, and restricted or suspended owners;
  - people blocked either way;
  - muted and "not interested" creators.
- All numbers are internal tuning (`REACH_CONFIG_JSON`), checked at startup, never promised to
  creators.

The **reach worker** judges up to 500 Stories a minute, the least recently judged first, under a
database advisory lock so only one instance works at a time (`REACH_ENABLED`,
`REACH_EVALUATE_SECONDS`, `REACH_BATCH_SIZE`; it runs in the worker process, or in the API process
when media work runs there).

**Home.** Your own Stories come first. People you follow and new people whose Stories have
reached you are mixed so that every five places hold three people you follow and two new
people, in a random arrangement:
- the first place is always someone you follow;
- never more than two new people in a row while people you follow are left;
- when either list runs out, the rest of the other follows.

Within each list, the order is a weighted shuffle: better-scoring creators tend to come
earlier, but the order changes on every refresh. New people nearby get a 1.6x weight, and the
wider area 1.25x. Paging keeps the order of the refresh you started with.

## Outcome by requirement

| Requirement | Status | Evidence |
|---|---|---|
| Public Stories reach beyond followers | IMPLEMENTED AND VERIFIED (server) | `reach.test.ts`: who each stage reaches, for viewers nearby, in the wider area, far away in the same time zone, with only a time zone, in another time zone and with no area; followers at every stage |
| Nearby first | IMPLEMENTED AND VERIFIED (server, component tests) / NOT VERIFIED (device) | Stage 1 reaches only nearby cells. Home favours nearer new people: in the final run, 504 of 800 loads (63%) put the nearby person first; about 62% is expected with the weight, 50% without it |
| More engagement, more reach | IMPLEMENTED AND VERIFIED | Evaluator end to end through the real API: engaged Story promoted with the exact expected score (4.9 / 13); unengaged one held; too-few-viewers one widened after two hours; follower views and other Stories' engagement not counted |
| Random mix of following and new (60/40) | IMPLEMENTED AND VERIFIED | `reachMath.test.ts` (200 seeded runs: exactly 3 of 5, first place followed, at most 2 new in a row, arrangements vary); `reach.test.ts` through the API: own Story first, 3 followed in each five, different order across loads |
| Home gestures (tap right next, left previous; swipe up/down between people) | Unchanged, as you chose | Existing `storyFeed.test.tsx` passes unchanged |
| Area privacy | IMPLEMENTED AND VERIFIED | Area never appears in profile, search, suggestions, Home or `/auth/me`; owner-only, `no-store`; invalid cells and time zones refused; deleted with the account immediately and by the retention scrub; stale areas and reach records of expired Stories deleted (`retention.test.ts`) |
| App: invitation, Settings switch, area refresh | IMPLEMENTED AND VERIFIED (component tests) / NOT VERIFIED (device) | `nearby.test.tsx` (13): only a cell and time zone are sent, never coordinates; approximate permission only on Android; refusal sends nothing and offers the phone's Settings; off clears the cell; a later refusal clears it; refresh at most every 6 hours; overlapping refreshes send once; the invitation waits 6 seconds, comes once, and "Not now" sends nothing |

### Decisions to confirm

- **The numbers** (test audiences 50 / 300 / 2,000; thresholds 0.30 / 0.35 / 0.40; two hours of
  patience) are a starting point. Change them with `REACH_CONFIG_JSON` without a release.
- **The time zone is always sent**, without asking, as the region fallback you chose. It is not
  location under the platform rules, but the App Store privacy answers below list coarse
  location for the cell.
- **The invitation** appears once, 6 seconds after you first use Katkee signed in, and never at
  launch. After "Not now", only Settings can turn Nearby on.
- **Portrait only** on both platforms (iPhone builds allowed landscape before). Stories are 9:16 and
  the viewer, editor and profile are laid out for portrait.

## Privacy, security and store findings (all fixed, with tests)

1. **A deleted account kept its area for up to 30 days.** The account scrub would have removed it,
   but the area is evidence of nothing, so deleting the account now deletes it in the same
   statement (`users.repository.ts`, test "goes with the account the moment the account is deleted").
2. **Google sign-in showed on builds that can't finish it.** The button appeared whenever the
   server allowed Google, including iOS builds without an iOS client ID, where tapping it only
   showed an error. App Review also expects Sign in with Apple beside Google (guideline 4.8),
   and Katkee has no Sign in with Apple yet. The button now shows only where the build can
   complete it (`username.test.tsx`).
3. **The location wording on iOS** described only the location sticker. It now explains Nearby
   Stories and the sticker. Reduced accuracy is the default, and standard encryption is declared
   (`ITSAppUsesNonExemptEncryption`), so each upload doesn't ask the export question.

## Performance (recorded, not a compliance claim)

100,000 people, about 1.5M follows, 10,000 live public Stories, 80,000 areas, 300,000 views.
One machine with 4 CPUs, Node and PostgreSQL together, warm cache, 7 runs each, median
(`docs/performance/2026-10-12-reach-and-home.json`, seed in `-seed.sql`, with one
`EXPLAIN (ANALYZE, BUFFERS)` per query).

| Case | Nearby on | Time zone only | No area |
|---|---|---|---|
| Reach query, 100 new people | 64 ms | 137 ms | 73 ms |
| Home, whole ranked list | 95 ms | 147 ms | 93 ms |
| Home, first page of 20 with its snapshot | 111 ms | 131 ms | 96 ms |

| Reach evaluator, one round of 500 Stories | Median |
|---|---|
| First version (one correlated count per signal, each re-reading every view) | 3,175 ms |
| Final version (one grouped pass, an index lookup per viewer) | 415 ms |

The reach query reads each live public Story once, so its cost grows with the number of live
Stories. Past roughly 50,000 live public Stories, candidate pools per area and time zone,
refreshed by the worker, would keep Home fast. That is not built; measure again before then.

## Deliberate breaks: each check must fail on a real defect

Each break was applied alone to the compiled code or app source, the tests that should catch it
were run, and the file was restored (`mutations.json` in the evidence folder).

- **Server: 27 of 27 caught**, after two test additions.
  - Reach rules:
    - stage 1 reaching everyone; the wider area at stage 1; the time zone ignored;
    - held Stories still reaching; test audiences ignored; private and restricted owners
      getting reach.
  - The evaluator:
    - follower views counted; other Stories' completions and likes counted; follows of
      other people counted;
    - counts not per Story; impressions not reset on promotion; the last reason forgotten;
    - engagement ignored; patience ignored.
  - Home: the nearby weight ignored; the first place new; three new in a row; never shuffled.
  - Area: deletion late; cells and time zones not checked or not canonical; the response
    cacheable; stale areas kept; the account scrub keeping it.
  - The first run missed "private owners get reach": Home was still safe, because a second check
    hides those Stories, but the reach query itself had no direct test. One now checks both
    layers. "Follows of other people counted" was missed until the evaluator test had a viewer
    follow someone else.
- **App: 14 of 14 caught**, after one test addition: coordinates sent, precise location asked,
  no refresh limit, a stale cell kept after a refusal, a withdrawn Android permission ignored
  (added), off keeping the cell, location read without opting in, overlapping refreshes, the
  invitation at once, asking again, a refusal not recorded, the Settings switch showing the
  wrong state offline or after a refusal, and Google on a build that can't finish it.

## Existing behaviour kept, and test changes

- Home's existing tests pass unchanged. "A followed creator ranks above an identical new one"
  holds because the first place is always someone you follow. "Real discovery" holds because
  an unknown area narrows nothing.
- No test was removed or loosened. Additions:
  - `helpers.ts` gained a `put` request;
  - `retention.test.ts` gained a test and two assertions;
  - `username.test.tsx` gained a test.
- `scripts/verify.cjs` also runs `reachMath.test.js` in its ranking step.
- The first verification run of the phase (`docs/test-runs/2026-10-12T12-02-04-290Z/`) failed two
  checks:
  - the invitation used an arrow character, which the icon rule forbids in controls;
  - the new test file had two typing errors.

  Both were fixed before the code commit.

## Commands and results (final run)

| Command | Result |
|---|---|
| `node scripts/verify.cjs --bundle` | **All 10 steps passed.** Evidence: `docs/test-runs/2026-10-12T12-14-48-185Z/`. <br>- backend build, app typecheck and test typecheck <br>- component tests: 12 suites, 51 tests (14 new) <br>- source checks: 121 <br>- ranking: 28 (14 new) <br>- infrastructure build, and 38 infrastructure tests <br>- Android and iOS release JavaScript bundles |
| `scripts/run-tests.cjs` as the `postgres` user (real PostgreSQL 16) | **418 / 418** tests in 43 files; 0 failed, 0 skipped. Log: `database-integration.log` in the evidence folder |
| First gate run of this phase | Failed two checks; `docs/test-runs/2026-10-12T12-02-04-290Z/`. Fixed as described above |
| Benchmark (100,000 users) | `docs/performance/2026-10-12-reach-and-home.json` |
| Deliberate breaks | Server 27/27, app 14/14 (after the test additions above): `mutations.json` in the evidence folder |

Backend tests grew from 393 to 418 (25 new):
- `reach` 10;
- `reachMath` 14;
- `retention` 1, plus two assertions.

App component tests grew from 37 to 51: `nearby` 13 and `username` 1.

## Builds

| Build | Status |
|---|---|
| Backend TypeScript | passed |
| App typecheck and test typecheck | passed |
| Android and iOS release JavaScript bundles | passed (final run) |
| Docker runtime and worker images | **BLOCKED**: `apt-get` needs `deb.debian.org` |
| Android APK/AAB | **BLOCKED**: `dl.google.com`, `repo.reactnative.dev` |
| iOS archive | **BLOCKED**: no Mac |

## Next phase

- **Phase 10**: the creator page (your profile and other people's) to Instagram and Snapchat
  quality, keeping Katkee's rules (Stories through the profile photo, portrait Highlights three
  per row, Insights owner-only).
- **Phase 11**: the rest of Edit Profile (photo take, crop and preview; Save and Discard; every
  screen updating after a change).
- **Phase 12**: final verification, the iOS and App Store guide, and the release ZIP.
- **Phase 5** (Android native build) whenever `dl.google.com`, `repo.reactnative.dev` and
  `deb.debian.org` are allowed.
