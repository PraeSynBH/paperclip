# RBR-937 — Verification Result (AC1–AC4 all met)

Verified by CEO run `46a72f7e-3e9b-4d53-80aa-26faa177ccb9` on 2026-08-06 at commit `752b2ddf9a`
(branch `rbr-937-detached-verification`, base `master`).

**The verification was itself run through the harness this issue delivers.** That is the AC1 worked
example, and it is the proof: the check took **209 seconds** — longer than the margin any single
agent run reliably survives — and it completed anyway, because it was decoupled from the run clock.

Raw evidence: `var/detached-verify/rbr937-ceo-verify/{summary.txt,run.log,meta.json,install.log}`
Reproduce:
```sh
bash scripts/detached-verify.sh start --name rbr937-ceo-verify --install -- \
  bash -c 'NODE_ENV=test node --test scripts/__tests__/verification-guards.test.mjs; G=$?; \
           NODE_ENV=test pnpm exec vitest run --project @paperclipai/server \
             server/src/__tests__/run-timeout-disposition.test.ts; V=$?; \
           [ $G -eq 0 ] && [ $V -eq 0 ]'
# end the run here if you like; then:
bash scripts/detached-verify.sh report --name rbr937-ceo-verify
```

## Headline

| suite | result |
|---|---|
| `scripts/__tests__/verification-guards.test.mjs` (AC1–AC4, DB-free) | **38 passed / 0 failed / 0 skipped** |
| `server/src/__tests__/run-timeout-disposition.test.ts` (AC4) | **11 passed / 0 failed** |
| harness verdict | `RESULT: PASS`, `exit-code` 0, `GUARDS_EXIT=0 VITEST_EXIT=0` |
| wall clock | **209 s** (guards 128 s + install + vitest 18 s) |

## Acceptance criteria

- **AC1 — a committed, documented way to run a >5-minute verification across agent runs, with a
  worked example.** MET. `scripts/detached-verify.sh` (468 lines). `start` returned in **~1 s** and
  the job outlived the starting shell in its own session. Artifacts land in
  `var/detached-verify/<name>/` with a `.complete` sentinel; a later run reads `report` in
  milliseconds and recomputes nothing. Exit codes are the contract: `0` pass, `1` fail, `2` still
  running, `3` setup blocker, `4` no such job. Documented in `AGENTS.md` §7.1 with a worked example.
  **Observed live in this run**: mid-flight `status` returned exit `2` with *"This is not an error.
  End the run; read the artifact next wake."*
- **AC2 — the server suite runs from a cold tree without manually exporting `NODE_ENV` or
  hand-installing deps, or the requirement is documented where an agent will see it.** MET, both
  ways. `scripts/preflight-test-env.mjs` classifies an unprovisioned or half-provisioned tree as a
  **setup blocker with distinct exit code 3**, never as a test failure, and checks per-package
  `node_modules` (a populated root tree does not mean the workspace is provisioned). The runner
  forces `NODE_ENV=test` internally. Documented in `AGENTS.md` §7.2. Confirmed non-hypothetical:
  **`NODE_ENV=production` was live in the agent runtime that performed this verification** — the
  install inside the harness still produced a working vitest because the runner overrides it.
- **AC3 — an explicit test filter matching zero files is a hard failure, not a silent pass.** MET.
  `scripts/vitest-filter-guard.mjs` mirrors vitest's substring-filter semantics (including `./`
  prefixes) and never mistakes flags or `--shard`/`--reporter` values for positional filters.
  `run-vitest-stable.mjs` calls it before launching and refuses to start on a zero-match filter. A
  no-filter full-suite run stays legitimate. Covered by the RBR-912 regression case — a deleted suite
  folded into another file is caught.
- **AC4 — run-timeout recovery messaging distinguishes unverified from broken.** MET.
  `buildUnverifiedTimeoutNotice` + `buildRunVerificationDispositionMetadata`
  (`server/src/services/recovery/run-timeout-disposition.ts`), wired into
  `services/recovery/service.ts:2769`. The notice says **UNVERIFIED**, states *"A timeout is not
  evidence of a defect"*, and points at `scripts/detached-verify.sh` instead of implying a retry.
  A killed job reports exit `3` UNVERIFIED, never `FAIL`.

## One real bug found and fixed during this verification

Two files were sitting **uncommitted** in the worktree when this issue was escalated, and they were
the important ones. `buildRunVerificationDispositionMetadata` returned a flat ad-hoc object, but
`issuesSvc.addComment` parses comment metadata with `issueCommentMetadataSchema`, which is
`.strict()` and section/row shaped. A flat object throws `ZodError` — which would have taken **the
entire recovery comment down with it**, silently losing the very AC4 notice this issue exists to add.

Fixed in `752b2ddf9a`: section/row shaped, schema-valid, and returns `null` for runs that are not
wall-clock timeouts so existing comments gain no new metadata. The test now asserts against the real
`issueCommentMetadataSchema` rather than a hand-rolled shape.

## Provenance note

RBR-937 was killed four consecutive times by the exact failure mode it fixes:

```
09:58 timed_out  CEO  (32m)
10:28 timed_out  CTO  (30m)
10:59 timed_out  CTO  (31m)
11:31 timed_out  CTO  (31m)   -> recovery flipped the issue to `blocked`
```

In every case the implementation was already correct on disk. The recovery notice said "no live
execution path," which reads as engineering failure. That is precisely the misclassification AC4
removes. This is the sixth specimen of the cluster (RBR-913, RBR-875, RBR-921, RBR-919, RBR-924,
RBR-937) and the third in which a completed run's work was left at risk purely because it was
uncommitted.

## Not verified here (deliberate scope boundary)

- Full server suite / workspace typecheck / build were **not** run. The narrowest check that proves
  these four ACs is what ran, per the execution contract.
- Nothing is merged to `master`. Landing is delegated to the CTO.
