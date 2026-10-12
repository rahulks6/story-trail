# Phase 12: final verification, the iOS guide and the release package

Date: 12 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`.

**Production-ready: no.** The code is verified as far as this environment allows: a real
PostgreSQL 16 for the server, component tests and a browser render for the app, and
deliberate breaks proving the tests catch defects.

What stands between this and the stores is outside the code:
- **Android**: the build hosts are denied by this environment's network policy (403).
- **iOS**: there is no Mac.
- **No AWS account and no provider credentials** (Google, SMS, FCM/APNs, SES, Safe Browsing).
- **No approved app icon and no published legal pages.**

## What the last four phases delivered

| Phase | Commits | Result |
|---|---|---|
| 9 Nearby reach and the Home mix | `29e131f`, `a680865` | Public Stories reach people nearby first and more people as they engage, in four stages. Home mixes people you follow (3 of every 5 places, always first) with new people, nearest weighted up, shuffled on every refresh. Approximate area is opt-in and never shown. [Report](PHASE_9_REACH_AND_HOME.md) |
| 10 Creator page | `3f1bf17` | An Instagram/Snapchat-quality profile for you and for others. Story ring, counts, Follows you, Follow back, More (share, copy link, mute, block, report), the private-account card, portrait Highlights three per row. The Like heart's malformed drawing is fixed. [Report](PHASE_10_CREATOR_PAGE.md) |
| 11 Edit Profile | `ace0b4d` | Take, choose or remove a photo. Move and scale it in a circle, cut on the phone so only that square is uploaded. Save and Discard with a confirmation. Home refreshes after a save. [Report](PHASE_11_EDIT_PROFILE.md) |
| 12 Final | this commit | The iOS and App Store guide; App Store readiness in the code; final verification; the release ZIP |

## App Store readiness work in this phase

- **Privacy manifest** (`PrivacyInfo.xcprivacy`): it was empty. It now declares the 11 kinds of
  data Katkee collects, each linked to the person, none used for tracking, with purposes. The
  release check refused iOS builds while it was empty.
- **App icon set**: changed to Xcode's single 1024 x 1024 format, so you add one PNG
  (`AppIcon-1024.png`). The release check refuses builds until it exists.
- **Terms at sign-up and onboarding**: "By signing up, you agree to Katkee's Terms and Privacy
  Policy. Katkee has no tolerance for objectionable content or abuse: you can report and block
  anyone." The links open the pages set in `build-config.json`. App Review 1.2 expects this of
  apps with user posts. Tested in `username.test.tsx`.
- **Earlier in Phases 9 to 11**:
  - location wording, reduced accuracy by default, standard encryption declared, portrait only;
  - camera and photo wording that mentions the profile photo;
  - Google hidden on iPhone builds without an iOS client ID (App Review 4.8).
- **The guide**: [docs/IOS_APP_STORE_DEPLOYMENT.md](../IOS_APP_STORE_DEPLOYMENT.md), every step
  from the developer account to submission, with the App Privacy answers and the App Review
  notes.

`npm run check:ios-release` now lists only what you must supply:
- the Privacy Policy, Terms and Support URLs;
- the production API URL;
- the permanent bundle ID, and confirming it;
- the icon.

## Release gate (30 gates)

Changes since the [Phase 7 report](PHASE_7_PRODUCTION_HARDENING.md) are in bold.

| # | Gate | Status | Evidence or blocker |
|---|---|---|---|
| 1 | Android 16 KB alignment | BLOCKED | `dl.google.com`, `repo.reactnative.dev` denied (403, rechecked 12 Oct) |
| 2 | Signed AAB | BLOCKED | Same hosts, and the upload key |
| 3 | iOS archive | BLOCKED (no Mac) | **Guide written; privacy manifest, icon set and terms notice done; the release check lists only owner-supplied items** |
| 4 | Web production build | IMPLEMENTED AND VERIFIED | Admin console |
| 5 | Google login in production | BLOCKED | Needs OAuth client IDs |
| 6 | Phone OTP in production | BLOCKED | Needs Twilio Verify |
| 7 | Password recovery | VERIFIED (server) / BLOCKED (live SES) / NOT VERIFIED (device) | Phase 1 |
| 8 | Story creation | VERIFIED (server) / NOT VERIFIED (device) | |
| 9 | Upload on Wi-Fi, mobile data, offline, reconnect | IMPLEMENTED BUT NOT VERIFIED | Needs devices |
| 10 | Background/resumable uploads | PARTIAL | OS-managed background transfer not implemented |
| 11 | Video processing and CDN | VERIFIED (local S3/SQS) / BLOCKED (live CloudFront) | Phase 2 |
| 12 | Story expiration | VERIFIED | |
| 13 | Highlights survive expiration | VERIFIED | |
| 14 | Public aggregate view counts | VERIFIED | |
| 15 | Viewer identities private | VERIFIED | |
| 16 | Realtime DMs | VERIFIED (server) / NOT VERIFIED (device) | Phase 3 |
| 17 | Push notifications | VERIFIED (protocol) / BLOCKED (live, native) | Phase 3 |
| 18 | Admin MFA | VERIFIED | |
| 19 | Unauthorized Admin access blocked | VERIFIED | |
| 20 | Moderation and appeals | VERIFIED (server, console) / NOT VERIFIED (device) | |
| 21 | Audit logs immutable and complete | VERIFIED | |
| 22 | Ads lifecycle | VERIFIED (server, console) / NOT VERIFIED (device) | |
| 23 | Failed ads fall back to organic | VERIFIED (server) / NOT VERIFIED (device) | |
| 24 | DAU/WAU/MAU and retention | VERIFIED | |
| 25 | Backups restore | PARTIAL | Local drill verified; AWS restore BLOCKED |
| 26 | Security and IDOR tests | VERIFIED (server) | **Phase 9 area endpoints owner-only and never in other responses (tested)** |
| 27 | Performance measured | BLOCKED (devices) | **Server: Home 93-147 ms and the reach evaluator 415 ms per 500 Stories at 100,000 people (`docs/performance/2026-10-12-reach-and-home.json`)** |
| 28 | Crash/error monitoring | PARTIAL | Native crash reporter not implemented (Sentry stub ready) |
| 29 | Privacy policy, Terms, deletion process | PARTIAL | Deletion verified; **terms notice at sign-up; privacy manifest declared**; the policy and terms pages must be written, reviewed and published |
| 30 | Store metadata and screenshots | PARTIAL | **Guide has the metadata, privacy answers and review notes**; store screenshots need device builds. The browser previews in the phase reports are not store screenshots |

**Fully passing:** 4, 12-15, 18, 19, 21, 24 and 26 (server scope), as in Phase 7.
**Server-verified, device pending:** 7, 8, 11, 16, 17, 20, 22, 23.
**Blocked:** 1, 2, 3, 5, 6, 27, and the live parts of 25. **Partial:** 9, 10, 25, 28, 29, 30.

### Spec section 43 (10/10 gate): what changed

- **Discovery**: IMPLEMENTED AND VERIFIED (server). Phase 9 replaced "unfollowed public creators
  reach feeds" with staged reach. Nearby first, more reach for engagement, test audiences and
  holds, measured at 100,000 people.
- **Visual**: still PARTIAL.
  - Done: the creator page and Edit Profile were redesigned, and checked in a browser render;
    the malformed Like heart was fixed; a new check keeps every icon path well-formed.
  - Still needed: visual acceptance on devices, the approved launcher icon, and the final
    notification icon.
- **Accessibility**: still PARTIAL.
  - Done: new controls have roles and labels; the photo cropper has zoom buttons as well as
    pinch; counts are read exactly; backdrops are labelled.
  - Still needed: a touch-target audit and screen-reader runs on devices.
- Everything else is unchanged from Phase 7.

## Final verification

| Command | Result |
|---|---|
| `node scripts/verify.cjs --bundle` | **All 10 steps passed.** Evidence: `docs/test-runs/2026-10-12T12-52-09-058Z/`. <br>- backend build, app typecheck and test typecheck <br>- component tests: 15 suites, 78 tests <br>- source checks: 123 <br>- ranking: 28 <br>- infrastructure build, and 38 infrastructure tests <br>- Android and iOS release JavaScript bundles |
| `scripts/run-tests.cjs` as the `postgres` user (real PostgreSQL 16) | **418 / 418** tests in 43 files; 0 failed, 0 skipped. Log: `database-integration.log` in the evidence folder |
| Deliberate breaks, Phases 9 to 11 | **78 of 78 caught** after test additions: server 27, app 14 + 18 + 19. The first runs missed 5; each now has a test (phase reports) |
| Benchmarks | `docs/performance/2026-10-12-reach-and-home.json` (Phase 9). The earlier phases' files are unchanged |
| Browser render | `tools/screen-preview`: creator page, Edit Profile and the cropper, no runtime errors |
| Network recheck (12 Oct) | `dl.google.com`, `repo.reactnative.dev`, `deb.debian.org`: 403 from the network policy |

Since Phase 8 (6 October):
- **Backend tests**: 393 to 418.
- **App component tests**: 37 to 78.
- **Source checks**: 121 to 123 (the icon-path check).

## The release package

`Katkee-Release-Candidate-2026-10-12.zip` is a `git archive` of the commit that contains this
report, on branch `claude/katkee-production-audit-kuexra`. It has only what is in git: no
`node_modules`, no build output, no secrets. `.env` files, keys and keystores are git-ignored.

To rebuild after unpacking:
- `npm ci` in `mobile/`, `backend/` and `infra/`;
- then `npm run verify:bundle` from the root.

What's inside:

| Folder | What it is |
|---|---|
| `mobile/` | The React Native app: Android and iOS projects, source, component tests, `build-config.json` |
| `backend/` | API, worker and migrations (0001 to 0039), tests, scripts |
| `admin/` | The Admin console (static build served by the API) |
| `infra/` | AWS ap-south-1 infrastructure as code, with tests and the runbook |
| `legal/` | Draft Privacy Policy and Terms, matching the app, for legal review |
| `docs/` | Phase reports, the iOS guide, evidence (`test-runs/`), benchmarks, the approved spec |
| `verification/`, `scripts/` | Source checks and the verification script |
| `tools/screen-preview/` | Browser render of the app's screens for design checks |

## What unblocks the rest

1. **Android**: allow `dl.google.com`, `repo.reactnative.dev` and `deb.debian.org`. In the
   cloud environment's settings, open Network access, choose Custom, add them and keep the
   default package-manager list (https://code.claude.com/docs/en/cloud-environments#network-access).
   Then Phase 5 builds and aligns the APK and AAB.
2. **iOS**: a Mac with Xcode and the steps in
   [docs/IOS_APP_STORE_DEPLOYMENT.md](../IOS_APP_STORE_DEPLOYMENT.md).
3. **AWS**: an account, then `infra/README.md` (the stack is code and tested, never deployed).
4. **Provider credentials**: Google OAuth, Twilio Verify, Firebase/APNs, SES production access,
   Safe Browsing.
5. **Content**: the approved icon, published Privacy Policy, Terms and Support pages, store
   screenshots, and a demo account for App Review.
