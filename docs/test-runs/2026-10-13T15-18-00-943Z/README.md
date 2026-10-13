# Verification evidence: Phase 14 (13 October 2026)

India launch: adults only (18+), the operator and Grievance Officer, and India's retention rules
(`docs/phases/PHASE_14_INDIA_LAUNCH.md`).

| File | What it is |
| --- | --- |
| `results.json` and the `*.log` files beside it | `node scripts/verify.cjs --bundle`: all 10 steps passed (backend build; app typecheck and test typecheck; 17 suites and 90 app component tests; 147 source checks; 28 ranking tests; infrastructure build and 40 tests; Android and iOS release JavaScript bundles) |
| `mobile-component-tests.json` | Jest's own report for the app component tests |
| `database-integration.log` | `backend/scripts/run-tests.cjs` as the `postgres` user against PostgreSQL 16: 439 of 439 tests in 45 files, each file in its own database made from the migrated template (migrations 0001 to 0040) |
| `mutations.json` | The 38 deliberate breaks (17 server; 21 app, legal pages, website and infrastructure), each applied alone with the tests that must catch it: 38 of 38 caught |
| `release-checks.log` | `check:ios-release` passes; `check:android-release` lists only the 4 private upload-key settings, which must come from your build environment |
| `check-live.log` | `scripts/check-live.cjs`: 0 of 8, because nothing is deployed to katkee.com yet and this environment has no internet access. Run it again after deploying |
| `website-render.log` | `website/public`, served with the website's Content-Security-Policy and rendered in Chromium (Playwright) at 1366 x 900 and 390 x 844: every page 200 (the 404 page 404), no horizontal overflow, no CSP violation. The "Failed to load resource: 404" lines are the 404 page's own status |

The first verification run of this phase failed 2 source checks that hadn't been updated for the
new code (a test sandbox that didn't know the new `./age` module, and the list of files allowed to
do date arithmetic). Both were fixed; this folder is the run after the fix.

Not verified here: native iOS and Android builds, phones, the deploy, and the live checks.
