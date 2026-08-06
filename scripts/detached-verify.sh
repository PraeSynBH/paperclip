#!/usr/bin/env bash
# RBR-937 AC1 — detached verification harness.
#
# THE PROBLEM THIS SOLVES
#
# Some verifications legitimately cost more wall clock than a single agent run
# survives. Verifying RBR-912 required a ~90 s embedded-Postgres boot + 58
# DB-backed tests + a full `pnpm install` — roughly 5 minutes. Four consecutive
# agent runs died *inside verification*, never inside the fix. Each retry re-paid
# the same unaffordable cost and died in the same place, and the recovery loop
# then escalated a healthy change as a failure.
#
# THE PATTERN
#
#   run N   : start the verification DETACHED from the run clock, exit cleanly
#   run N+1 : read the durable artifact in milliseconds, report, dispose
#
# The verification outlives the run that started it. The next wake does not
# recompute anything — it reads a file.
#
# USAGE
#
#   # Run 1 — start it and exit. Returns immediately.
#   bash scripts/detached-verify.sh start --name rbr912 -- pnpm test:run --filter server/src/__tests__/foo.test.ts
#
#   # Run 1 — optionally provision deps first (install is part of the cost):
#   bash scripts/detached-verify.sh start --name rbr912 --install -- pnpm test:run
#
#   # Skip the node test-env preflight (for non-node verifications).
#   bash scripts/detached-verify.sh start --name db-check --no-preflight -- ./check.sh
#
#   # Run 2+ — cheap, non-blocking status check.
#   bash scripts/detached-verify.sh status --name rbr912
#
#   # Run 2+ — print the durable result.
#   bash scripts/detached-verify.sh report --name rbr912
#
#   # Bounded wait, for when you have budget left in THIS run.
#   bash scripts/detached-verify.sh wait --name rbr912 --timeout 120
#
#   bash scripts/detached-verify.sh list
#   bash scripts/detached-verify.sh clean --name rbr912
#
# ARTIFACT LAYOUT  (var/detached-verify/<name>/)
#
#   run.log        full combined stdout+stderr of the verification
#   install.log    dependency provisioning output (only with --install)
#   meta.json      name, command, pid, start/end time, exit code, status
#   summary.txt    human-readable headline an agent can paste into a comment
#   runner.sh      the exact detached script, kept for inspection/re-run
#   .started       sentinel: the job was launched
#   .complete      sentinel: the job finished (check THIS, then read exit code)
#
# EXIT CODES OF `status` / `report` / `wait`
#   0  complete and the verification PASSED
#   1  complete and the verification FAILED
#   2  still running (not an error — come back next wake)
#   3  SETUP BLOCKER: environment could not run the verification at all
#   4  no such job
#
# Status 3 exists so an agent can distinguish "the change is broken" from "the
# environment could not test the change" (see RBR-937 AC4).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_ROOT="${PAPERCLIP_DETACHED_VERIFY_ROOT:-$REPO_ROOT/var/detached-verify}"

EXIT_PASS=0
EXIT_FAIL=1
EXIT_RUNNING=2
EXIT_SETUP_BLOCKER=3
EXIT_NO_JOB=4

log() { printf '[detached-verify] %s\n' "$*" >&2; }

die() {
  log "ERROR: $*"
  exit 64
}

usage() {
  # Print the leading comment block, whatever length it is. A hardcoded line
  # range silently truncates the docs the moment the header grows.
  sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 64
}

job_dir() { printf '%s/%s' "$ARTIFACT_ROOT" "$1"; }

job_pid() {
  sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$1/meta.json" 2>/dev/null | head -1
}

require_name() {
  [ -n "${NAME:-}" ] || die "--name <job-name> is required"
  case "$NAME" in
    */*|.|..|"") die "--name must be a simple identifier (no slashes)";;
  esac
}

read_exit_code() {
  [ -f "$1/exit-code" ] && cat "$1/exit-code" || echo ""
}

# ---------------------------------------------------------------------------
# start
# ---------------------------------------------------------------------------

cmd_start() {
  require_name
  local dir; dir="$(job_dir "$NAME")"

  if [ -f "$dir/.started" ] && [ ! -f "$dir/.complete" ]; then
    local prev_pid; prev_pid="$(job_pid "$dir")"
    if [ -n "$prev_pid" ] && kill -0 "$prev_pid" 2>/dev/null; then
      log "job '$NAME' is already running (pid $prev_pid); not starting a second copy"
      log "check it with: bash scripts/detached-verify.sh status --name $NAME"
      exit $EXIT_RUNNING
    fi
    log "job '$NAME' has a stale .started with no live process; restarting"
  fi

  [ "${#COMMAND[@]}" -gt 0 ] || die "no command supplied; pass it after '--'"

  rm -rf "$dir"
  mkdir -p "$dir"

  local command_str; command_str="$(printf '%q ' "${COMMAND[@]}")"
  local started_at; started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Record the command in a file rather than interpolating it into JSON or into
  # the runner's quoting layers — that keeps arbitrary shell metacharacters in the
  # verification command from corrupting either artifact.
  printf '%s\n' "$command_str" >"$dir/command.txt"

  # The runner script is what actually survives this run. It is written to disk
  # (not passed inline) so it stays inspectable and re-runnable by a later wake.
  cat >"$dir/runner.sh" <<'RUNNER'
#!/usr/bin/env bash
set -uo pipefail
cd "$RUNNER_REPO_ROOT"

# RBR-937 landmine 1: NODE_ENV=production is inherited from the Paperclip agent
# runtime. Under it pnpm skips devDependencies and omits vitest entirely, so
# every test invocation dies with 'Command "vitest" not found'. Force a test env.
export NODE_ENV=test

DIR="$RUNNER_DIR"
COMMAND_STR="$(cat "$DIR/command.txt")"

write_meta() {
  local code="$1" status="$2" ended_at="$3"
  {
    printf '{\n'
    printf '  "name": "%s",\n' "$RUNNER_NAME"
    printf '  "commandFile": "command.txt",\n'
    printf '  "pid": %s,\n' "$$"
    printf '  "startedAt": "%s",\n' "$RUNNER_STARTED_AT"
    printf '  "endedAt": %s,\n' "$ended_at"
    printf '  "exitCode": %s,\n' "$code"
    printf '  "status": "%s"\n' "$status"
    printf '}\n'
  } >"$DIR/meta.json"
}

finish() {
  local code="$1" status="$2"
  write_meta "$code" "$status" "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  printf '%s\n' "$code" >"$DIR/exit-code"
  touch "$DIR/.complete"
}

# Provision dependencies if asked. Install failure is a SETUP BLOCKER, not a
# verification failure — the distinction is the whole point of RBR-937 AC4.
if [ "$RUNNER_DO_INSTALL" = "1" ]; then
  echo "[detached-verify] provisioning dependencies with NODE_ENV=test" >"$DIR/install.log"
  if ! pnpm install --frozen-lockfile >>"$DIR/install.log" 2>&1; then
    echo "[detached-verify] --frozen-lockfile install failed; retrying without it" >>"$DIR/install.log"
    if ! pnpm install >>"$DIR/install.log" 2>&1; then
      {
        echo "RESULT: SETUP BLOCKER"
        echo "REASON: dependency provisioning failed; the verification never ran."
        echo "This does NOT mean the change under test is broken. It means the"
        echo "environment could not test it. See install.log."
      } >"$DIR/summary.txt"
      finish 3 setup_blocker
      exit 3
    fi
  fi
fi

# Environment preflight: an unprovisioned tree is a setup blocker too.
#
# Only gate commands that actually need the node toolchain. This harness is
# general purpose — a shell/python/docker verification must not be failed for a
# bare node_modules it never touches, and a false setup blocker costs an agent
# run just as surely as a silent failure does.
if [ "$RUNNER_SKIP_PREFLIGHT" != "1" ] && printf '%s' "$COMMAND_STR" | grep -Eq '(^|[[:space:]/])(node|npm|npx|pnpm|yarn|vitest|tsc|jest)([[:space:]]|$)'; then
  if ! node scripts/preflight-test-env.mjs >>"$DIR/run.log" 2>&1; then
    {
      echo "RESULT: SETUP BLOCKER"
      echo "REASON: test-environment preflight failed; the verification never ran."
      echo "This does NOT mean the change under test is broken."
      echo "Re-run with --install, or see run.log for the specific remedy."
    } >"$DIR/summary.txt"
    finish 3 setup_blocker
    exit 3
  fi
fi

SECONDS=0
eval "$COMMAND_STR" >>"$DIR/run.log" 2>&1
CODE=$?
DURATION=$SECONDS

# Distil a headline a later run can read without parsing the whole log.
TEST_LINE="$(grep -E '^[[:space:]]*Tests[[:space:]]+' "$DIR/run.log" | tail -1 | sed 's/^[[:space:]]*//')"
SUITE_LINE="$(grep -E '^[[:space:]]*Test Files[[:space:]]+' "$DIR/run.log" | tail -1 | sed 's/^[[:space:]]*//')"

{
  if [ "$CODE" -eq 0 ]; then
    echo "RESULT: PASS"
  elif [ "$CODE" -eq 3 ]; then
    echo "RESULT: SETUP BLOCKER (exit 3)"
    echo "The change under test is UNVERIFIED, not known to be broken."
  else
    echo "RESULT: FAIL (exit $CODE)"
  fi
  echo "COMMAND: $COMMAND_STR"
  echo "DURATION: ${DURATION}s"
  [ -n "$SUITE_LINE" ] && echo "$SUITE_LINE"
  [ -n "$TEST_LINE" ] && echo "$TEST_LINE"
  echo "LOG: $DIR/run.log"
  if [ "$CODE" -ne 0 ]; then
    echo ""
    echo "--- failing lines (last 40 matches) ---"
    grep -E '(FAIL|AssertionError|Error:)' "$DIR/run.log" | tail -40
  fi
} >"$DIR/summary.txt"

case "$CODE" in
  0) finish 0 passed;;
  3) finish 3 setup_blocker;;
  *) finish "$CODE" failed;;
esac
exit "$CODE"
RUNNER

  chmod +x "$dir/runner.sh"
  : >"$dir/run.log"

  export RUNNER_REPO_ROOT="$REPO_ROOT"
  export RUNNER_DIR="$dir"
  export RUNNER_NAME="$NAME"
  export RUNNER_STARTED_AT="$started_at"
  export RUNNER_DO_INSTALL="$DO_INSTALL"
  export RUNNER_SKIP_PREFLIGHT="$SKIP_PREFLIGHT"

  # Detach hard: new session (own process group), no controlling terminal, so the
  # job survives not just the parent exiting but a process-GROUP kill of the
  # agent run — which is how agent runtimes usually reap their children.
  # macOS ships no setsid(1), so fall back to perl's POSIX::setsid, then to plain
  # nohup (reparents to init but shares our process group) as a last resort.
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup "$dir/runner.sh" >/dev/null 2>&1 &
  elif command -v perl >/dev/null 2>&1 && perl -MPOSIX -e 'exit 0' 2>/dev/null; then
    nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die $!;' "$dir/runner.sh" >/dev/null 2>&1 &
  else
    log "WARNING: neither setsid nor perl POSIX available; job shares this process group"
    log "WARNING: a process-group kill of this agent run may also kill the verification"
    nohup "$dir/runner.sh" >/dev/null 2>&1 &
  fi
  local pid=$!
  disown "$pid" 2>/dev/null || true

  {
    printf '{\n'
    printf '  "name": "%s",\n' "$NAME"
    printf '  "commandFile": "command.txt",\n'
    printf '  "pid": %s,\n' "$pid"
    printf '  "startedAt": "%s",\n' "$started_at"
    printf '  "endedAt": null,\n'
    printf '  "exitCode": null,\n'
    printf '  "status": "running"\n'
    printf '}\n'
  } >"$dir/meta.json"
  touch "$dir/.started"

  # Let the new session establish (and let the runner overwrite meta.json with
  # its own pid) before we hand control back.
  sleep 1

  log "started detached job '$NAME' (pid $pid)"
  log "artifacts: $dir"
  log ""
  log "You may now END THIS RUN. The verification keeps going without you."
  log "Next wake, read the result with:"
  log "  bash scripts/detached-verify.sh report --name $NAME"
  exit 0
}

# ---------------------------------------------------------------------------
# status / report / wait
# ---------------------------------------------------------------------------

# Map a completed job's recorded exit code to this script's exit contract.
exit_for_completed_job() {
  local dir="$1" code
  code="$(read_exit_code "$dir")"
  if [ "$code" = "$EXIT_SETUP_BLOCKER" ] && grep -q 'SETUP BLOCKER' "$dir/summary.txt" 2>/dev/null; then
    return $EXIT_SETUP_BLOCKER
  fi
  [ "${code:-1}" = "0" ] && return $EXIT_PASS
  return $EXIT_FAIL
}

cmd_status() {
  require_name
  local dir; dir="$(job_dir "$NAME")"

  if [ ! -d "$dir" ] || [ ! -f "$dir/.started" ]; then
    log "no detached job named '$NAME'"
    exit $EXIT_NO_JOB
  fi

  if [ ! -f "$dir/.complete" ]; then
    local pid; pid="$(job_pid "$dir")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      local lines; lines="$(wc -l <"$dir/run.log" 2>/dev/null | tr -d ' ')"
      log "job '$NAME' is STILL RUNNING (pid $pid, ${lines:-0} log lines)."
      log "This is not an error. End the run; read the artifact next wake."
      exit $EXIT_RUNNING
    fi
    log "job '$NAME' has no live process and never wrote .complete — it was killed."
    log "The verification is UNVERIFIED, not failed. Restart it with 'start'."
    exit $EXIT_SETUP_BLOCKER
  fi

  exit_for_completed_job "$dir"; local code=$?
  case $code in
    "$EXIT_PASS") log "job '$NAME' COMPLETE — PASS";;
    "$EXIT_SETUP_BLOCKER") log "job '$NAME' ended in a SETUP BLOCKER (change is UNVERIFIED, not broken)";;
    *) log "job '$NAME' COMPLETE — FAIL (exit $(read_exit_code "$dir"))";;
  esac
  exit $code
}

cmd_report() {
  require_name
  local dir; dir="$(job_dir "$NAME")"

  if [ ! -d "$dir" ] || [ ! -f "$dir/.started" ]; then
    log "no detached job named '$NAME'"
    exit $EXIT_NO_JOB
  fi

  if [ ! -f "$dir/.complete" ]; then
    echo "STATUS: RUNNING (no durable result yet)"
    echo "JOB: $NAME"
    echo "DIR: $dir"
    echo ""
    echo "--- tail of run.log ---"
    tail -30 "$dir/run.log" 2>/dev/null || true
    exit $EXIT_RUNNING
  fi

  echo "JOB: $NAME"
  echo "DIR: $dir"
  cat "$dir/summary.txt" 2>/dev/null || echo "(no summary.txt written)"

  exit_for_completed_job "$dir"
  exit $?
}

cmd_wait() {
  require_name
  local dir; dir="$(job_dir "$NAME")"
  local timeout="${TIMEOUT:-120}"

  if [ ! -d "$dir" ] || [ ! -f "$dir/.started" ]; then
    log "no detached job named '$NAME'"
    exit $EXIT_NO_JOB
  fi

  local waited=0
  while [ ! -f "$dir/.complete" ] && [ "$waited" -lt "$timeout" ]; do
    sleep 2
    waited=$((waited + 2))
  done

  if [ ! -f "$dir/.complete" ]; then
    log "job '$NAME' still running after ${timeout}s — this is the expected case for"
    log "an expensive verification. End the run; read the artifact next wake."
    exit $EXIT_RUNNING
  fi

  cmd_report
}

cmd_list() {
  if [ ! -d "$ARTIFACT_ROOT" ]; then
    echo "(no detached verification jobs)"
    exit 0
  fi
  local found=0
  for dir in "$ARTIFACT_ROOT"/*; do
    [ -d "$dir" ] || continue
    found=1
    local name status
    name="$(basename "$dir")"
    if [ -f "$dir/.complete" ]; then
      status="complete (exit $(read_exit_code "$dir"))"
    elif [ -f "$dir/.started" ]; then
      status="running"
    else
      status="unknown"
    fi
    printf '%-28s %s\n' "$name" "$status"
  done
  [ "$found" = "1" ] || echo "(no detached verification jobs)"
  exit 0
}

cmd_clean() {
  require_name
  rm -rf "$(job_dir "$NAME")"
  log "removed job '$NAME'"
  exit 0
}

# ---------------------------------------------------------------------------
# arg parsing
# ---------------------------------------------------------------------------

[ $# -gt 0 ] || usage
case "$1" in -h|--help|help) usage;; esac
SUBCOMMAND="$1"; shift

NAME=""
TIMEOUT=""
DO_INSTALL=0
SKIP_PREFLIGHT=0
COMMAND=()

while [ $# -gt 0 ]; do
  case "$1" in
    --name)      NAME="${2:-}"; shift 2;;
    --name=*)    NAME="${1#--name=}"; shift;;
    --timeout)   TIMEOUT="${2:-}"; shift 2;;
    --timeout=*) TIMEOUT="${1#--timeout=}"; shift;;
    --install)   DO_INSTALL=1; shift;;
    --no-preflight) SKIP_PREFLIGHT=1; shift;;
    -h|--help)   usage;;
    --)          shift; COMMAND=("$@"); break;;
    *) die "unexpected argument '$1' (put the verification command after '--')";;
  esac
done

case "$SUBCOMMAND" in
  start)  cmd_start;;
  status) cmd_status;;
  report) cmd_report;;
  wait)   cmd_wait;;
  list)   cmd_list;;
  clean)  cmd_clean;;
  *) die "unknown subcommand '$SUBCOMMAND' (start|status|report|wait|list|clean)";;
esac
