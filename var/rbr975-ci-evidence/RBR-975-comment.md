Landed. Merge commit `75d915b3281550f9ab2191aeaa5faf5cf06f2516` on `master`.

## AC1 — merged, no squash-loss

`--no-ff` merge of `rbr-937-detached-verification` into `master`. All three commit messages preserved
and reachable from the merge commit (verified with `git merge-base --is-ancestor`):

- `4852896dd8` feat(verification): first-class detached-verification harness + cold-tree guards
- `752b2ddf9a` fix(RBR-937): AC4 metadata must satisfy strict `issueCommentMetadataSchema`
- `a366d93f70` docs(RBR-937): verification result

Diffstat as predicted: 12 files, +2016 / -3. No conflicts.

The merge commit message summarizes the four delivered components so the landing is legible from
`git log` alone without opening the branch.

## AC2 — CI green on `master` after the merge

I did **not** re-run the RBR-937 verification from scratch. I ran the **PR-workflow CI checks** against
the post-merge tree, through the harness this branch delivers — the worked example, applied to its own
landing.

```
bash scripts/detached-verify.sh start --name rbr975-cto-ci --install -- ...
bash scripts/detached-verify.sh report --name rbr975-cto-ci
```

`RESULT: PASS`, `exitCode: 0`, duration **187 s** — again longer than the margin a single run reliably
survives, and again it completed because it was decoupled from the run clock.

| check (source) | result |
|---|---|
| `scripts/check-no-git-push.mjs` (pr.yml:53) | pass |
| `scripts/check-no-git-push.test.mjs` (pr.yml:56) | **14 pass / 0 fail** |
| `scripts/__tests__/run-vitest-stable-shard.test.mjs` (pr.yml:59) | **3 pass / 0 fail** |
| `scripts/__tests__/verification-guards.test.mjs` (AC1–AC4) | **38 pass / 0 fail** |
| `server/src/__tests__/run-timeout-disposition.test.ts` (AC4) | **11 pass / 0 fail** |

**66 tests passed, 0 failed.** No failures to attribute, pre-existing or otherwise.

### The harness proved itself on the first attempt, in the way that matters

My first start returned `RESULT: SETUP BLOCKER`, exit **3**:

```
! dev_dependency_bins_missing: node_modules/.bin is missing required dev binaries: vitest.
  This is the signature of an install performed under NODE_ENV=production.
  remedy: Re-run `NODE_ENV=test pnpm install`
```

That is AC2 firing live and correctly. The tree really was provisioned under `NODE_ENV=production`.
A naive runner would have reported this as a **test failure on `master` immediately after a merge** —
the single worst false signal available in this situation, and precisely the escalation loop that
burned four runs on RBR-937. Instead it named the cause, named the remedy, and used a distinct exit
code. I re-ran with `--install` and got PASS. The harness earned its keep before it finished landing.

Evidence archived outside the ignored artifact dir: `var/rbr975-ci-evidence/{summary.txt,meta.json,run.log}`
(`var/detached-verify/` is gitignored, so the live artifacts are not durable across cleanup).

## AC3 — branch deleted

`Deleted branch rbr-937-detached-verification (was a366d93f70)`. Deleted with `-d`, not `-f`, so
deletion is itself proof the commits are merged.

## AC4 — this comment

Merge SHA and CI evidence above.

## The judgement call: `RBR-937-VERIFICATION.md` stays at repo root

Decided: **root-level per-issue verification docs are the convention.** Not moved.

It is not arbitrary — the convention already exists and I am matching it rather than inventing a
third location. `RBR-912-VERIFICATION.md` and `RBR-936-VERIFICATION.md` both sit at root on sibling
branches in this same cluster. `docs/` is the published-documentation tree (it has a `docs.json`
manifest) and a per-issue verification record is not user-facing documentation. `var/` is gitignored,
which would destroy the exact durability that makes the artifact worth anything.

Root-level is right for the property these files need: an agent picking up a cold tree finds
`RBR-<id>-VERIFICATION.md` with `ls`, without knowing a convention. That discoverability is the whole
point — RBR-937 exists because verification results were not durable and findable. Filing them
somewhere tidier but less visible optimizes the wrong axis.

Noted for later, not blocking: these will accumulate at root. If the count becomes a nuisance, the
move is a mechanical `git mv` to `docs/verification/` plus one AGENTS.md line — cheap, and cheaper
still once there are enough of them to establish the pattern is worth formalizing. Not worth doing at
n=3.

## Notes

- No remote push. `master` is advanced locally only, consistent with `scripts/check-no-git-push.mjs`
  and this repo's landing convention. `origin/master` is untouched; the merge is 7 commits ahead
  locally.
- No scope expansion. Harness merged exactly as approved; I changed nothing on the branch.
- The merge was performed in the clean `master` worktree at `/private/tmp/rbr875-scope` (the primary
  checkout is on an unrelated branch with unrelated in-flight work — I did not disturb it).

Parent RBR-937 is now unblocked from the landing side: the harness is on `master` and available to
every subsequent run. Recommend closing RBR-937.
