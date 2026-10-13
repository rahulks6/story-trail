# Phase 14: India launch: adults only (18+), the Grievance Officer, and India's rules

13 October 2026. You asked for: 18 and older ("1st yes"), a launch across the whole of India
("2nd whole India"), Katkee run by your sole proprietorship, **Rahul Katakdhond** as Grievance
Officer, and the steps to launch.

Nothing here is deployed. Native builds and devices are still unavailable here, so everything on
the phone is tested in component tests and a browser preview, not on an iPhone or Android phone.

## What you asked for, and where it stands

| Item | Now | Status |
|---|---|---|
| 18 and older | Sign-up with email, and finishing sign-up with Google or a phone number, ask for a date of birth. The **server** refuses anyone under 18 on today's date in India, before anything is stored | IMPLEMENTED AND VERIFIED (9 new server tests on real PostgreSQL, 6 app tests, 38 deliberate breaks caught) / NOT VERIFIED on devices |
| The whole of India | Store availability: India only (both guides); phone sign-in for Indian numbers (`IN`, already the default); servers, database, files and logs in AWS Mumbai | Guides and settings done. Choosing India in each store is yours: **BLOCKED** until you have the store accounts |
| Sole proprietorship | "Katkee is operated by Rahul Katakdhond, a sole proprietorship registered in India": Terms, Privacy Policy, website footer | IMPLEMENTED AND VERIFIED (consistency check). Trade name and address: not given, so not published |
| Grievance Officer: Rahul Katakdhond | Terms section 12, Privacy Policy section 11, Help Center contact card: name, grievance@katkee.com, response times, the appeal to the Grievance Appellate Committee | IMPLEMENTED AND VERIFIED (consistency check, rendered pages). **Live: BLOCKED** until you deploy |
| Steps to launch | `LAUNCH.md`, new section "India: the rules that apply"; the store guides; and the answer in chat | Documented |

## What changed

### 18 and older, enforced on the server

- **`backend/migrations/0040_minimum_age.sql`** (additive):
  - `users.birth_date` (nullable date; accounts made before this have none, and there are none in
    production);
  - `complete_provider_proof` takes the date of birth and refuses a new account without one
    (`BIRTH_DATE_REQUIRED`); returning people need nothing new;
  - a new report reason, `under_18` ("May be under 18"), ranked with nudity and violence;
  - `deleted_account_records` (below).
- **`backend/src/modules/auth/age.ts`**: the rule, in one place. `MINIMUM_AGE = 18`, fixed in code
  rather than configurable so it can't drift from the published Terms. Age is counted on today's
  date in India (UTC+05:30), so a birthday counts from midnight in India; someone born on 29
  February turns a year older on 1 March in other years. A date must be real, from 1 January
  1900, and not in the future.
- **Sign-up** (`POST /api/v1/auth/signup`): `birthDate` (YYYY-MM-DD) is required; a problem comes
  back as `fields.birthDate` with the other field errors. Nothing is stored for a refused
  sign-up.
- **Google and phone sign-up** (`POST /api/v1/auth/provider/complete`): same rule. Someone under
  18 is refused and their verified sign-in (Google email and name, or phone identity) is
  **deleted at once**, not left to expire.
- **Never returned.** The date of birth is stored but not selected back: tests check sign-up,
  `/auth/me`, a profile seen by its owner and by someone else, search, and a profile edit (which
  also can't change it).
- **Deleted accounts**: the scrub clears the date of birth.

### India's rules found on the way

Not in your request, but needed to launch in India:

- **IT Rules 2021, rule 3(1)(h)**: an intermediary keeps what a person registered with for 180
  days after the account is deleted. The scrub (30 days after deletion) now copies the username
  and earlier usernames, email, display name, date of birth and sign-in identifiers into
  `deleted_account_records`, and retention deletes each record 180 days after deletion
  (`RETENTION_DELETED_ACCOUNT_RECORD_DAYS`). Nothing in the API or the Admin console reads it.
- **CERT-In directions (2022)**: logs kept 180 days in India. Every log group, the database's
  exported logs, the WAF's logs and the access-log bucket went from 30 or 90 days to 180
  (`infra/lib/katkee-stack.ts`, `LOG_RETENTION_DAYS`). All in Mumbai.
- **"May be under 18"** in the app's report sheet, the server's reasons, the database constraint
  and the Admin console's filter.
- **Privacy Policy corrections**: phone sign-in keeps only a keyed fingerprint of the number, not
  the number (the policy said "we keep the number"); backups are kept 35 days (daily) and a year
  (monthly), not 14 days; logs 180 days, not 30; Twilio, Google and Apple may process data
  outside India.

### The app

- `mobile/src/utils/birthDate.ts`: the server's rule and messages, mirrored (checked to match),
  and a DD/MM/YYYY field that adds the slashes as people type.
- **Sign up**: a "Date of birth" field after Email. Nothing shows while it's being typed; a
  finished date that is impossible, in the future or under 18 shows why, and Sign up stays off.
  The server's answer shows on the field. Not offered to autofill (it could fill another
  format).
- **Google or phone onboarding**: the same field; "Create your account". If the server refuses
  (the phone's clock can disagree), the onboarding closes, the pending sign-in is cleared from
  the keychain, and the reason shows.
- The report sheet lists "May be under 18".

### Legal pages and website

- **Terms**: "Katkee is operated by Rahul Katakdhond, a sole proprietorship registered in India";
  section 2 "Eligibility: 18 and older"; "harmful to children" added to the content rules;
  section 12 names the Grievance Officer, how to complain, the 24-hour and 15-day times, removal
  within 72 hours, intimate or morphed images within 24 hours, and the appeal to the Grievance
  Appellate Committee within 30 days (gac.gov.in).
- **Privacy Policy**: Katkee as the Data Fiduciary; the date of birth (why, never shown, never
  for ads, correct it by email); section 9 "Katkee is for adults (18 and older)"; the 180-day
  records; your rights under the DPDP Act 2023, the Data Protection Board, and the policy in
  Eighth Schedule languages on request; the contacts by name.
- **Website**: "for people 18 and older" on the home page and in the footer with the operator;
  the Help Center's age answer, a new "I think someone on Katkee is under 18" answer, and the
  Grievance Officer card with the appeal; the account deletion page's retention facts corrected.
  `website/site.json` holds `minimumAge`, `operator` and `grievanceOfficer`.
- **The website build now refuses a link to a section that doesn't exist** (it found one in this
  phase: `/terms#12-grievances`, which is `/terms#grievances`).

### Store answers

- **Google Play**: target audience **18 and over** only; Data safety lists the date of birth
  under Personal info, Other info; the description says 18 and older; Countries: India only;
  personal or organization account for a sole proprietorship.
- **Apple**: App Privacy adds Other Data Types (date of birth), matched in
  `PrivacyInfo.xcprivacy`; availability India only; a sole proprietor enrols as an individual,
  and the App Store shows your name as the seller; reviewer notes mention the 18+ sign-up.
- `STORE_LISTING.md`, `legal/README.md` and `LAUNCH.md` updated to match.

### Checks

- `verification/minimum-age.cjs` (5 tests): the server and the app use the same age and messages
  and count the day in India; the Terms, Privacy Policy, website and guides say 18 and older, and
  nothing younger remains anywhere; the operator and Grievance Officer are named the same in
  every place; the store answers declare the date of birth; the report reason is the same in the
  app, the server and the database.
- The tests that sign people up give an adult date of birth (`ADULT_BIRTH_DATE`).
- The screen preview renders the sign-up screen (`?screen=signup`), filled in and refused:
  `assets/phase14-signup.png` and `assets/phase14-signup-under-18.png`. The Help Center's
  Grievance Officer card: `assets/phase14-help-center-grievance-officer.png`. (A browser
  preview with the app's real screen code, not a device.)

## Decisions to confirm

1. **The date of birth is stored**, not just "is 18 or older". It is the record that the person
   declared their age, which matters if a complaint says an account belongs to a child. It's
   never shown or used for ads, and is cleared 30 days after deletion (kept in the 180-day
   record until then).
2. **18 is fixed in code**, not a setting, so it can't differ from the Terms. A later launch with
   another age needs a code change and new legal pages.
3. **Birthdays count on the date in India.**
4. **No lockout on the phone after an under-18 answer.** The server stores nothing for a refused
   sign-up, and a refused Google or phone sign-in has to start again. A lock on the phone is easy
   to get around (reinstall) and punishes typing mistakes. It can be added if you want it.
5. **The date of birth can't be changed in the app.** Mistakes are corrected by email to
   privacy@katkee.com, so the age check can't be undone by editing a profile.
6. **Promises on the pages that you must keep**: removal within 72 hours of a request about
   content that breaks the rules (stricter than the law requires for some kinds of content), and
   the policy in an Eighth Schedule language on request.
7. **No business address or trade name** is published, because you haven't given them. The law
   asks for the Grievance Officer's name and contact details, which are published.

## Deliberate breaks: each check must fail on a real defect

38 breaks, each applied alone; **38 of 38 caught** (`docs/test-runs/2026-10-13T15-18-00-943Z/mutations.json`).

| Where | Breaks | Caught by |
|---|---|---|
| The age rule (`age.ts`, compiled) | the minimum age set to 13; UTC instead of India's date; birthdays ignored (year only); impossible dates accepted (30 February); future dates accepted | `minimumAge.test` on PostgreSQL |
| Sign-up and provider sign-up | sign-up skips the age check; the date not stored; a refused Google sign-in kept; the provider date dropped; provider sign-up skips the age check | `minimumAge.test` |
| The database (`0040`) | a new provider account allowed without a date of birth; "May be under 18" reports at low priority | `minimumAge.test` |
| Retention | the scrub keeps the date of birth; the 180-day record skipped; earlier usernames dropped from it; records kept forever; records kept 1 day | `retention.test` |
| The app | the minimum age 16; UTC instead of India's date; no slashes as people type; Sign up allowed under 18; the date not sent; the server's answer hidden; onboarding allows under 18, drops the date, or keeps a refused sign-in | `birthDate.test`, `auth.test`, `username.test` |
| Consistency | the app's age differs from the server's; the report reason missing in the app; the Terms say 13; "13 or older" on the Help Center; the Grievance Officer renamed; the appeal route dropped; the privacy manifest without the date of birth | `verification/minimum-age.cjs` |
| Website | section links unchecked; `website/public` stale | `verification/website.cjs` |
| Infrastructure | service logs, database logs or access logs kept less than 180 days | `infra` stack tests |

## Commands and results

| Command | Result |
|---|---|
| `node scripts/verify.cjs --bundle` | **All 10 steps passed.** Backend build; app typecheck and test typecheck; app component tests **17 suites, 90 tests**; source checks **147**; ranking **28**; infrastructure build and **40** tests; Android and iOS release JavaScript bundles. (The first run failed 2 source checks not yet updated for the new code; fixed, then this run) |
| `scripts/run-tests.cjs` as the `postgres` user (real PostgreSQL 16) | **439 / 439** tests in 45 files; 0 failed, 0 skipped (Phase 13: 430 in 44) |
| Deliberate breaks | **38 of 38 caught** |
| `npm run check:ios-release` | Passes |
| `npm run check:android-release` | Only the 4 private upload-key settings missing (they must never be in the repository) |
| `npm run check:live` | **0 of 8**: nothing is deployed, and this environment can't reach the internet |
| Browser render (Chromium, Playwright) | Website: 6 pages at 1366 and 390 wide, no horizontal overflow, no CSP violations. App: sign-up with a date of birth, accepted (15/05/1995) and refused (16 years old) |

Evidence: `docs/test-runs/2026-10-13T15-18-00-943Z/`.

## Release gate changes (from the Phase 13 report)

| # | Gate | Was | Now |
|---|---|---|---|
| 29 | Privacy policy, Terms, deletion process | PARTIAL: pages written and served; a lawyer's review, the Grievance Officer's name and the deploy still needed | PARTIAL: **the Grievance Officer (Rahul Katakdhond) and the operator are published**, with 18+, India's retention rules and the appeal route. Still needed: a lawyer's review and the deploy |
| 30 | Store metadata and screenshots | PARTIAL | PARTIAL: **both stores' answers updated for 18+ and India only**; screenshots still need device builds |
| New | Minimum age (18) | none | IMPLEMENTED AND VERIFIED on the server and in app tests; NOT VERIFIED on devices |

Not changed: nothing is deployed, the iOS app has never been built (no Mac), the Android build is
blocked by this environment's network policy, and no device has run either app. Katkee is **not
production-ready** until those pass.
