# Final Phase 8 verification, 6 October 2026

- `node scripts/verify.cjs --bundle` (as root): every step passed, see `results.json`. The
  steps are the backend build, app typechecks, component tests (11 suites, 37 tests), source
  checks (121), ranking tests (14), infrastructure build and tests (38), and both release
  JavaScript bundles. Its `notVerified` list includes "database integration tests" only
  because that suite ran separately, below.
- `database-integration.log`: the backend integration suite (`scripts/run-tests.cjs`) on a
  real local PostgreSQL 16, run as the `postgres` OS user (peer authentication), on the same
  code: 393 tests in 41 files, 0 failed, 0 skipped.
- `mutations.json`: every new check run against deliberately broken code, one defect at a time.
- People search and suggestions timed at 100,000 users:
  `docs/performance/2026-10-06-people-search.json`.
- `docs/test-runs/2026-10-06T20-05-00-062Z/` is the first gate run of this phase. It failed
  seven source checks (`source-regressions.log`). The fix is described in
  `docs/phases/PHASE_8_PROFILE_AND_SEARCH.md` under "Existing behaviour kept, and test changes".

Not covered here: Android/iOS native builds, devices, live AWS and providers.
