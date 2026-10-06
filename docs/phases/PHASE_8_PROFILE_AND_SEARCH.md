# Phase 8: usernames, people search and suggestions (spec sections 10 and 23)

Date: 6 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`.

**Production-ready: no.** Everything here is tested against a real PostgreSQL 16 and in app
component tests, but nothing has run on a device: the Android build is still blocked by the
network policy and there is no Mac for iOS. The release gate in the
[Phase 7 report](PHASE_7_PRODUCTION_HARDENING.md) is unchanged by this phase.

## What this phase did

| Part | Commit | Result |
|---|---|---|
| 8a Username rules (spec 23) | `470d330` | One policy for sign-up, Google/phone onboarding and profile edits: format, reserved staff/system/page words, the Katkee name in any disguise, and profanity and slurs after undoing common disguises. A live availability check. A 14-day hold on a name someone renamed away from, and at most two renames in 14 days, enforced by database triggers so every path obeys them. Profiles can be opened by the permanent account ID. |
| 8b People search and suggestions (spec 10) | `4878481` | Search also matches interests, ranks the best matches first and says on each result whether you follow them, have asked to, or they follow you. "Suggested for you" before typing, from facts you can already see. Measured at 100,000 users. |
| 8c App, docs and final run | this commit | Sign up, Edit Profile and onboarding check a username as it's typed. Search shows suggestions before typing, follows in place, cancels superseded requests and loads more as you scroll. Shared profile links carry the account ID. |

## Outcome by requirement

| Requirement (spec) | Status | Evidence |
|---|---|---|
| Username uniqueness server-side (23) | IMPLEMENTED AND VERIFIED | Unique index (from before), plus a per-name lock so a rename and a claim of the same name wait for each other. `usernamePolicy.test.ts`: concurrent rename vs claim (6 rounds) and a claim made while a rename is held open in a transaction |
| Debounced availability (23) | IMPLEMENTED AND VERIFIED (server, component tests) / NOT VERIFIED (device) | `GET /api/v1/usernames/availability`: available, yours, taken, held, invalid, reserved, not_allowed; never cached. App: `useUsernameAvailability` on Sign up, Edit Profile and onboarding; 400 ms debounce; a newer name cancels the older request. `username.test.tsx` (5) |
| Reserved and profanity rules (23) | IMPLEMENTED AND VERIFIED | `username-policy.ts`, applied by all three paths. Digits read as letters, separators and stretched letters undone. Short words count only as a whole part, so "nigeria", "classic", "therapist", "assam_tea" and "badminton" stay allowed |
| Immutable user ID preserves links (23) | IMPLEMENTED AND VERIFIED (server, component tests) | `GET /api/v1/users/<id>` finds the account after a rename (blocks, suspension and deletion still 404). Share Profile links are `katkee://user/<name>?id=<id>`; the app opens by ID when present, and the ID decides because the old name may belong to someone else by then. Older app versions ignore `?id=` and open by name |
| People-only search, autofocus and keyboard (10) | IMPLEMENTED AND VERIFIED (component tests) | The box is focused on open and again when the Search tab is pressed; taps work while the keyboard is up; scrolling dismisses it. `search.test.tsx` |
| Suggested for you before typing (10) | IMPLEMENTED AND VERIFIED | `GET /api/v1/search/suggestions`. In order: people who follow you; people followed by people you follow; people sharing an interest; new public accounts with a public Story up. `peopleSearch.test.ts` (6 suggestion tests) |
| Search username, display name and interests; inline Follow (10) | IMPLEMENTED AND VERIFIED | Interests matched one by one, never the JSON around them. Results carry `isPrivate` and the follow relationship; the app shows Follow / Requested / Following / Follow back and updates in place |
| Debounce, cancellation, pagination, privacy and block enforcement (10) | IMPLEMENTED AND VERIFIED | 300 ms debounce. AbortController per query; superseded and unmounted searches are cancelled and their late answers dropped. Pages of 20 load as the list ends. Blocked either way, suspended and deleted accounts never appear. "Following" filters on the server instead of a 500-account client fetch |
| No Explore, trending or Reels grid (10) | Unchanged (none exists) | |

### Decisions to confirm

These are new behaviour, chosen to protect people. Say if any should change.

- **Renames:** at most two in 14 days (the response says the date of the next one). The name
  someone renamed away from is held for 14 days, and only they can take it back, so nobody
  can grab a recognisable handle straight away and pose as its owner.
- **Deleting an account still frees its name at once**, as before (an existing test requires it).
- **Names chosen before these rules** still save unchanged with other edits. The original five
  reserved names (admin, katkee, moderator, support, superadmin) are refused even unchanged, as
  before. The new rules apply when the name changes.
- **One- and two-letter searches** list usernames starting with the letters first, then every
  other match alphabetically, without the full ranking (see the measurements below).
- **Known false positives** of the profanity rules: words that contain a blocked word, such as
  "Scunthorpe" or "shiitake". The lists are in `backend/src/modules/users/username-policy.ts`.

## Privacy and security findings (all fixed, with tests)

1. **A database restore would have silently changed a rule.** The rename-history trigger
   compared `citext` values with `IS DISTINCT FROM`. A dump restores trigger conditions with an
   empty search path, where `citext`'s operator isn't visible, so the restored copy would have
   compared case-sensitively. The Phase 7 restore drill caught the difference; the condition now
   compares `lower(text)` and restores identically.
2. **Suggestions reveal only what you can already see.** "Followed by" names only people you
   follow (accepted, not pending) and never a suspended or deleted account. Pending requests
   reveal nothing. Blocked (either way), muted and "not interested" people, and restricted,
   suspended or deleted accounts, are never suggested. Each rule has a test and was proven by a
   deliberate break.
3. **Interest search can't match the storage format.** `[`, `]`, `,` and quotes never match
   the JSON array; `%`, `_` and `\` are literal.
4. **Impersonation:** staff, system and page words, and the Katkee name with digits,
   separators or stretched letters ("k4tkee", "kat.kee", "katkeee"), are reserved; the rename
   hold covers handles people recognise.
5. **Availability** answers are never cached. They reveal only what a profile lookup already
   does, plus "used recently" for a held name; never who held it or their new name.

## Performance (recorded, not a compliance claim)

Timed through the backend's own query code against a seeded throwaway database: 100,000 users,
1,499,984 follows, 2,000 live Stories. Node and PostgreSQL 16 shared this sandbox (4 vCPU), with
a warm cache. These are not production numbers. Plans and the seed script:
`docs/performance/2026-10-06-people-search.json` and `-seed.sql`.

| Case | Median | Before Phase 8 |
|---|---|---|
| search "rahul" | 11.0 ms | 85 ms |
| search "rahul", page 5 | 11.6 ms | |
| search "priya_sharma_1" | 2.8 ms | |
| search "ra" (two letters) | 2.6 ms | 0.6 ms |
| search "a" (one letter) | 19.3 ms | |
| search "sha" (common fragment) | 68.5 ms | |
| search "photo" (interest) | 43.2 ms | |
| search "zzqx" (no match) | 1.6 ms | |
| Suggested for you (20) | 45.4 ms | |

The first ranked version took 211 ms for "ra" and 331 ms for "a": trigram indexes need three
characters, so ranking had to read every user. Short terms now read the username index in order
and stop after a page (index `users_username_lower_c_idx`). Building the viewer's interest list
once (`MATERIALIZED`) took suggestions from 69 ms to 45 ms.

Limits at larger scale:
- Common three-letter fragments cost grows with the number of matches.
- The shared-interest source reads every account sharing one of your interests (8,000 here).
- A rare one- or two-letter term walks the whole username index, as it did before Phase 8.

Beyond a few million accounts, a dedicated search index would be the next step.

## Deliberate test failures: each check must fail on a real defect

Every new check was run against a deliberately broken copy, one defect at a time:
- **8a server (17 of 17 caught):**
  - the hold, the rename limit, either name lock, held availability and the history trigger;
  - the profanity list and the stretch bound;
  - the policy on profile edits, sign-up and onboarding;
  - names from before the rules refused;
  - Retry-After, the account scrub, ID links, "yours" and the no-store header.
- **8b server (23 of 24 caught):**
  - interest matching and its per-element check, ranking, followed-first and the server-side
    filter;
  - follow state on results;
  - suspended accounts;
  - each suggestion exclusion: requested, muted, dismissed, restricted, blocked, a suspended
    friend named, a pending request treated as a follow;
  - private and old "new" accounts, suggestion order, the "+ N more" count, limit and scope
    validation;
  - the short-term path: prefix first, the page window, and the path switched off.

  The one not caught removes the `MATERIALIZED` hint. Results are identical, so only the
  benchmark shows it (69 ms vs 45 ms).
- **8c app (22 of 22 caught):**
  - Search: cancellation (on a newer query and on leaving), late answers shown, more pages,
    the next page offset, the server-side filter, the Requested label, follow state kept,
    failure messages, the "+ N more" text, autofocus and refocus on the tab;
  - the availability hook: stale answers, cancellation, checking your own name;
  - the three screens ignoring a refusal, onboarding lowercasing;
  - profile links: ID ignored, acting on the old name, `?id=` parsing and validation.

  The first app run missed one: cancellation when leaving Search. A test for it was added and
  the break is now caught.

## Existing behaviour kept, and test changes

- **Kept:**
  - Deleting an account frees its name at once.
  - Names from before the rules still save unchanged.
  - The search result shape only gained fields; the DM, Send Story and mention pickers use the
    same endpoint and now get ranked results.
  - Push notification links are unchanged: installed apps check them strictly and would ignore
    a link with `?id=`.
- **Test changes:**
  - No assertion was removed or loosened.
  - Three source-check harnesses load a module with a fixed map of the dependencies it may
    import, and those modules now import the username policy:
    - `verification/release-hardening.cjs`: the profile service and the sign-up parser use the
      real policy module (pure, no I/O);
    - `verification/regressions.cjs`: the auth service, with stubs for `DatabaseError` and the
      policy's messages.
  - `retention.test.ts` now also checks that the account scrub deletes rename history.
  - `account-links.cjs` gained a test for `?id=` links.

## Commands and results (final run)

| Command | Result |
|---|---|
| `node scripts/verify.cjs --bundle` | **All 10 steps passed.** Evidence: `docs/test-runs/2026-10-06T20-13-13-443Z/`. <br>- backend build, app typecheck and test typecheck <br>- component tests: 11 suites, 37 tests (13 new) <br>- source checks: 121 (1 new) <br>- ranking: 14 <br>- infrastructure build, and 38 infrastructure tests <br>- Android and iOS release JavaScript bundles |
| `scripts/run-tests.cjs` as the `postgres` user (real PostgreSQL 16) | **393 / 393** tests in 41 files; 0 failed, 0 skipped. Log: `database-integration.log` in the evidence folder |
| First gate run of this phase | Failed seven source checks; `docs/test-runs/2026-10-06T20-05-00-062Z/`. Fixed as described under "Existing behaviour kept, and test changes" |
| Benchmark (100,000 users, 1.5M follows) | `docs/performance/2026-10-06-people-search.json` |
| Deliberate breaks | 17/17, 23/24 and 22/22: `mutations.json` in the evidence folder |
| Network recheck (6 Oct, 20:05 UTC) | `dl.google.com`, `repo.reactnative.dev`, `deb.debian.org`: 403 from the network policy |

Backend tests grew from 367 to 393 (26 new):
- `usernamePolicy` 15;
- `peopleSearch` 11.

`retention` also gained an assertion. App component tests: `search` 8, `username` 5.

## Builds

| Build | Status |
|---|---|
| Backend TypeScript | passed |
| App typecheck and test typecheck | passed |
| Android and iOS release JavaScript bundles | passed (final run) |
| Docker runtime and worker images | **BLOCKED**: `apt-get` needs `deb.debian.org` |
| Android APK/AAB | **BLOCKED**: `dl.google.com`, `repo.reactnative.dev` (403 at 20:05 UTC) |
| iOS archive | **BLOCKED**: no Mac |

## Next phase

- **Phase 5** (Android native upgrade, 16 KB alignment, APK and AAB) as soon as `dl.google.com`,
  `repo.reactnative.dev` and `deb.debian.org` are allowed. In the cloud environment's settings,
  open Network access and choose Custom, then add them and keep the default package-manager
  list (https://code.claude.com/docs/en/cloud-environments#network-access).
- Until then, **Phase 9** continues the remaining Edit Profile work in spec section 23:
  - avatar capture, crop and preview, with the old avatar kept until the save commits;
  - Save and Discard with a confirmation when there are unsaved changes;
  - every cached surface updating after a username, avatar or bio change.
