# Verification evidence: the step-by-step deploy guide (13 October 2026)

`LAUNCH.md` became the complete deploy guide, every step in order, and
`verification/launch-guide.cjs` checks it against the code: the npm scripts it runs, the files it
names, the settings in its `cdk.context.json`, the secrets it fills, the stack outputs it reads,
the container and build stage it uses, and the sign-up request it sends.

| File | What it is |
| --- | --- |
| `results.json` and the `*.log` files beside it | `node scripts/verify.cjs` (without `--bundle`; no app code changed since the Phase 14 run in `../2026-10-13T15-18-00-943Z/`): all 8 steps passed, including 152 source checks (the 5 new guide checks among them) |

Deliberate breaks of the guide, each applied alone (a misspelt setting, a missing setting, a wrong
secret name, a wrong stack output, a wrong npm script, a reserved username, a sign-up without a
date of birth, a wrong file path, a wrong container name, an unknown provider, a wrong stack
name): **11 of 11 caught** by `verification/launch-guide.cjs`.

Not verified here: the deploy itself. Nothing has been deployed to AWS from this environment.
