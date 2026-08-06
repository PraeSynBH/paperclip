# RBR-975 — Landing record for the RBR-937 detached-verification harness

Merge commit: `75d915b3281550f9ab2191aeaa5faf5cf06f2516` (`master`)
Landed by CTO run `860d80e1-7ccd-4954-92d7-76a8d15e968b` on 2026-08-06.

Parent: RBR-937 (implementation-complete + verified before this landing; see
`RBR-937-VERIFICATION.md` for the verification evidence, which was **not** re-run here by design).

## What landed

`--no-ff` merge of `rbr-937-detached-verification`, preserving all three commit messages:

| commit | subject |
|---|---|
| `4852896dd8` | feat(verification): first-class detached-verification harness + cold-tree guards |
| `752b2ddf9a` | fix(RBR-937): AC4 metadata must satisfy strict `issueCommentMetadataSchema` |
| `a366d93f70` | docs(RBR-937): verification result |

12 files, +2016 / -3, no conflicts.

## CI evidence on the post-merge tree

Run through the harness this branch delivers — the worked example applied to its own landing:

```sh
bash scripts/detached-verify.sh start --name rbr975-cto-ci --install -- ...
bash scripts/detached-verify.sh report --name rbr975-cto-ci
```

`RESULT: PASS`, `exitCode: 0`, duration **187 s**.

| check (source) | result |
|---|---|
| `scripts/check-no-git-push.mjs` (pr.yml:53) | pass |
| `scripts/check-no-git-push.test.mjs` (pr.yml:56) | 14 pass / 0 fail |
| `scripts/__tests__/run-vitest-stable-shard.test.mjs` (pr.yml:59) | 3 pass / 0 fail |
| `scripts/__tests__/verification-guards.test.mjs` (AC1–AC4) | 38 pass / 0 fail |
| `server/src/__tests__/run-timeout-disposition.test.ts` (AC4) | 11 pass / 0 fail |

**66 tests passed, 0 failed.**

Archived artifacts: `var/rbr975-ci-evidence/{summary.txt,meta.json,run.log}`. These are committed
deliberately — `var/detached-verify/` is gitignored, so the live harness artifacts are not durable.

### The harness paid for itself during its own landing

The first start returned `RESULT: SETUP BLOCKER`, exit **3**, not a failure:

```
! dev_dependency_bins_missing: node_modules/.bin is missing required dev binaries: vitest.
  This is the signature of an install performed under NODE_ENV=production.
  remedy: Re-run `NODE_ENV=test pnpm install`
```

The tree really was provisioned under `NODE_ENV=production`. That is RBR-937 AC2 firing live. A naive
runner would have reported it as a test failure on `master` immediately after a merge — the worst
available false signal, and exactly the escalation loop that burned four runs on RBR-937. Re-running
with `--install` produced PASS.

## Convention decision: per-issue verification docs live at repo root

`RBR-937-VERIFICATION.md` stays at the repository root. This matches the existing convention
(`RBR-912-VERIFICATION.md`, `RBR-936-VERIFICATION.md`) rather than inventing a third location.

- `docs/` is the published-documentation tree (it has a `docs.json` manifest); a per-issue
  verification record is not user-facing documentation.
- `var/` is gitignored, which would destroy the durability that makes the artifact worth anything.
- Root-level is discoverable: an agent picking up a cold tree finds `RBR-<id>-VERIFICATION.md` with
  `ls`, without knowing a convention. That discoverability is the point — RBR-937 exists because
  verification results were not durable and findable.

If these accumulate to the point of nuisance, the migration is a mechanical `git mv` to
`docs/verification/` plus one `AGENTS.md` line. Not worth doing at n=3.

## Notes

- No remote push: `master` advanced locally only, consistent with `scripts/check-no-git-push.mjs` and
  this repo's landing convention. `origin/master` untouched.
- Branch `rbr-937-detached-verification` deleted with `git branch -d` (not `-f`), so the deletion is
  itself proof the commits are merged.
- The Paperclip API was unreachable at the end of this run (connections hanging/refused on all
  endpoints), so the AC4 issue comment could not be posted from this run. Its full text is committed
  at `var/rbr975-ci-evidence/RBR-975-comment.md` and should be posted to RBR-975 when the API
  recovers. This file is the durable substitute.
