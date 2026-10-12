# Final Phase 9 verification, 12 October 2026

- `node scripts/verify.cjs --bundle` (as root): every step passed, see `results.json`. The
  steps are the backend build, app typechecks, component tests (12 suites, 51 tests), source
  checks (121), ranking tests (28), infrastructure build and tests (38), and both release
  JavaScript bundles. Its `notVerified` list includes "database integration tests" only
  because that suite ran separately, below.
- `database-integration.log`: the backend integration suite (`scripts/run-tests.cjs`) on a
  real local PostgreSQL 16, run as the `postgres` OS user (peer authentication), on the same
  code: 418 tests in 43 files, 0 failed, 0 skipped.
- `mutations.json`: every new check run against deliberately broken code, one defect at a time,
  with the first-run misses and the reruns after the tests that now catch them.
- Home and the reach evaluator timed at 100,000 users:
  `docs/performance/2026-10-12-reach-and-home.json`.
- `docs/test-runs/2026-10-12T12-02-04-290Z/` is the first gate run of this phase. It failed
  two checks (`mobile-test-typecheck.log`, `source-regressions.log`); the fixes are described in
  `docs/phases/PHASE_9_REACH_AND_HOME.md` under "Existing behaviour kept, and test changes".

Not covered here: Android/iOS native builds, devices, live AWS and providers.
