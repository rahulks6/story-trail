# Verification evidence: Phase 13 (12 October 2026)

Release identity, icons and the katkee.com website (`docs/phases/PHASE_13_RELEASE_IDENTITY.md`).

| File | What it is |
| --- | --- |
| `results.json` and the `*.log` files beside it | `node scripts/verify.cjs --bundle`: all 10 steps passed (backend build; app typecheck and test typecheck; 16 suites and 84 app component tests; 142 source checks; 28 ranking tests; infrastructure build and 39 tests; Android and iOS release JavaScript bundles) |
| `mobile-component-tests.json` | Jest's own report for the app component tests |
| `database-integration.log` | `backend/scripts/run-tests.cjs` as the `postgres` user against PostgreSQL 16: every backend test file, each in its own database made from the migrated template |
| `mutations.json` | The 44 deliberate breaks (20 server; 24 app, checks, scripts and infrastructure), each applied alone with the tests that must catch it, and the results: 44 of 44 caught |
| `release-checks.log` | `check-release.cjs --ios` passes; `--android` lists only the 4 private upload-key settings, which must come from your build environment |
| `check-live.log` | `scripts/check-live.cjs`: 0 of 8, because nothing is deployed to katkee.com yet and this environment has no internet access. Run it again after deploying |
| `website-render.log` | `website/public`, served with the website's Content-Security-Policy and rendered in Chromium (Playwright) at 1366 x 900 and 390 x 844: every page 200 (the 404 page 404), no horizontal overflow, no CSP violation. The two "Failed to load resource: 404" lines are the 404 page's own status |

Not verified here: native iOS and Android builds, phones, the deploy, and the live checks.
