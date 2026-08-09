# Primary Instance Deploy Path And The Verification Gap

Status: operator runbook, not committed to `paperclipai/paperclip` upstream (this file documents
this fork's specific primary-instance deploy setup, and is expected to live only on the operator's
checkout/fork).

Date: 2026-08-08

## 0. Why this file exists

The company's live Paperclip instance answers on the operator's own network. That process is a
long-lived `paperclipai run` supervised as a background service. It is **not** rebuilt or restarted
automatically when commits land on `master`. Between a merge landing and that process actually
serving the new code, there is a real, human-mediated gap — several manual steps that do not happen
by default.

Server-side agent work on this repo commonly gets "closed" on the strength of a live check against
that instance's `/api/health` or behavior at its bound address. If the running process predates the
fix, that live check silently validates old code, and the issue closes while the underlying bug is
still present. This file names the gap and the fix for it.

## 1. The deploy path (master → running process)

```text
merge to master
  -> .github/workflows/release.yml publishes a canary automatically (every push)
  -> operator promotes a trusted canary/commit to stable via workflow_dispatch (see doc/RELEASING.md)
  -> npm now has the new paperclipai / @paperclipai/server versions
  -> OPERATOR ACTION: upgrade the globally-installed paperclipai package on the host
  -> OPERATOR ACTION: restart the supervised paperclipai process so it loads the new code
```

Steps 1–3 are already automated by `.github/workflows/release.yml` and covered in `doc/RELEASING.md`
and `doc/INSTALLING.md` (`paperclipai update`, `service restart`). Steps 4–5 — actually upgrading and
restarting **this host's** long-lived process — are manual, are not triggered by CI, and have no
automatic trigger anywhere in this repo. **They only happen when an operator (Ben) runs them.**

## 2. The specific, host-level detail for this instance

This information is host-specific to the operator's own machine and does not describe the shape of
every Paperclip deployment. It is recorded here so any agent or operator debugging a stale-server
report does not have to re-derive it from `ps` and `launchctl` forensics each time.

- The instance is supervised by macOS `launchd`, not `systemd` — the launchd-specific commands below
  differ from `doc/DEVELOPING.md`'s `systemctl restart paperclip.service` example, which targets a
  Linux/systemd host.
- launchd label: `com.praesyn.paperclip`
- plist: `~/Library/LaunchAgents/com.praesyn.paperclip.plist`
- program: `/opt/homebrew/bin/paperclipai run`
- working directory: `~/.paperclip/instances/default`
- global npm package root: `/opt/homebrew/lib/node_modules/paperclipai`
- `KeepAlive` is configured for crash-restart, so a plain `kill` alone is not stable — the launchd
  supervisor decides whether/when it comes back. Use `launchctl kickstart`, not a bare signal, to get
  a deterministic managed restart.

### 2.1. Exact upgrade command

```sh
npm install -g paperclipai@latest
# or pin an exact stable version once one is confirmed published:
npm install -g paperclipai@2026.MDD.P
```

Confirm the global install actually moved:

```sh
/opt/homebrew/bin/paperclipai --version
cat /opt/homebrew/lib/node_modules/paperclipai/package.json | grep '"version"'
```

### 2.2. Exact restart command

```sh
launchctl kickstart -k gui/$(id -u)/com.praesyn.paperclip
```

`-k` sends SIGKILL to any currently running instance before restarting it, which is appropriate here
because the target is a manual, sign-off-gated restart (see AC2), not a live in-place hot-restart.
`doc/DEVELOPING.md`'s `## Hot-Restart Deploys` section documents a lower-disruption alternative
(`request-hot-restart.ts` + adoption of in-flight local-agent runs) for cases where minimizing run
loss matters more than a clean restart; that path is systemd-oriented today and would need the
launchd equivalent verified before use on this host.

### 2.3. Confirm the restart actually loaded new code

```sh
curl -s http://127.0.0.1:3100/api/health | jq '{version, serverVersion, commit}'
```

Compare `commit` against the merge commit SHA you expect to be live. A stale `version`/`commit` after
a restart means the global install upgrade (step 4) did not actually happen before the restart (step
5) — the two steps are ordered and both required.

## 3. AC2 — this is an operator action, not an agent action

Upgrading the global install and restarting this long-lived process is **Ben's call, not an agent's**.
Concretely:

- The process is shared across the whole company: **28 agents** run through this one instance today.
- A restart drops or re-queues every in-flight heartbeat run on the box at that moment (see
  `doc/DEVELOPING.md`'s `## Hot-Restart Deploys` for what a *managed* restart preserves — a bare
  `launchctl kickstart -k` restart does not get that treatment and should be assumed disruptive).
- No agent should run the upgrade or restart commands in section 2 unannounced mid-cycle.

**Who performs it:** Ben (operator), on his own schedule, after explicit sign-off requested by
whichever issue/agent needs the fresh deploy. Agents should ask for sign-off (comment or interaction
on the relevant issue) rather than opening a change that quietly assumes the restart already
happened. RBR-939 recorded this ask; no restart has been performed as part of closing RBR-939 itself.

## 4. AC3 — verification rule until the box is upgraded

Until an operator upgrades and restarts the primary instance, **no agent may claim "fixed and
verified" against port 3100 (or whatever address the primary instance is bound to) for a server-side
change that has not yet reached that running process.**

Concretely:

- Check `/api/health` `commit` (see `doc/DEVELOPING.md`'s `## Quick Health Checks` and section 2.3
  above) against your change's merge commit before treating the primary instance as evidence.
- If the running commit predates your change, verify instead against a **locally started dev server**
  (`pnpm dev`, or an isolated worktree instance per `doc/DEVELOPING.md`'s `## Worktree-local
  Instances`) running your actual branch/commit.
- State explicitly, in the issue comment or PR verification section, which server you verified
  against: `"Verified against a local dev server on commit <sha>, not the primary instance (primary
  is running <stale-commit> per /api/health)"`. Do not write "verified" with no server identified —
  that phrasing defaults to reading as "verified against the primary instance."
- This is now the standing rule for this instance, not a one-time note for RBR-939 alone. See also
  `doc/RELEASING.md` "Smoke Testing" for the CI-side canary/stable smoke gate, which is separate from
  this local-dev-verification rule and does not substitute for it.

## 5. AC4 — the version is visible without ps/npm forensics

`GET /api/health` already returns enough to answer "is this stale?" without a `ps` + npm session:

```json
{
  "version": "2026.707.0",
  "serverVersion": "2026.707.0",
  "commit": "<full git sha, or null if unavailable>"
}
```

- `version`/`serverVersion` is the resolved CalVer string (`server/src/version.ts`).
- `commit` is the running build's git SHA and is deliberately present on **every** health response
  shape (including the deployment-mode-redacted one) because a commit SHA of a public repo is not a
  secret (`server/src/routes/health.ts`).
- Board/agent actors in `authenticated` mode, or any caller in `local_trusted` dev, additionally get
  the fuller `serverInfo` block (commit subject, commit time, local working-tree changes).

Before treating the primary instance's behavior as proof a fix landed, check this field first:

```sh
curl -s http://127.0.0.1:3100/api/health | jq '{version, serverVersion, commit}'
```

No further code change was required for AC4 — the version/commit surface already exists on
`/api/health` as of this writing. What was missing was the operator process to keep it current
(sections 1–3 above) and the standing verification rule (section 4) that makes staleness
self-evident instead of requiring rediscovery.

## 6. Summary of what this issue closes

- **AC1**: deploy path documented above (section 1), plus the exact host-specific upgrade/restart
  commands for the currently-running process (section 2).
- **AC2**: named as an operator (Ben) action; sign-off must be requested per-restart, not assumed.
  No restart was performed while closing this issue.
- **AC3**: standing verification rule added (section 4) — agents must name which server they verified
  against, and must not claim primary-instance verification for a commit that instance has not yet
  loaded.
- **AC4**: confirmed `/api/health` already exposes `version`/`serverVersion`/`commit`; documented how
  to read it as a staleness check (section 5). No server code change was needed for this issue.
