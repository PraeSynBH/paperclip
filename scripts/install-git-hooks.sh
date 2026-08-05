#!/usr/bin/env bash
# install-git-hooks.sh — RBR-786
#
# Installs the pre-push hook that runs `npm run check:paths`, so a push cannot
# introduce an npm script pointing at a file that is missing from git.
#
# This is the control that would have caught RBR-783 (src/ai/ + 9 src/drata/
# entrypoints committed nowhere, clean clone failed to build) and the
# `drata:sync` breakage in RBR-786.
#
# Idempotent: safe to re-run. Refuses to clobber an unrelated existing hook.
#
#   ./scripts/install-git-hooks.sh
# or
#   npm run hooks:install

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="$(git -C "$REPO_ROOT" rev-parse --git-path hooks)"
case "$HOOK_DIR" in
  /*) ;;
  *) HOOK_DIR="$REPO_ROOT/$HOOK_DIR" ;;
esac
HOOK_PATH="$HOOK_DIR/pre-push"
MARKER="# managed-by: aira scripts/install-git-hooks.sh (RBR-786)"

mkdir -p "$HOOK_DIR"

if [[ -e "$HOOK_PATH" ]] && ! grep -qF "$MARKER" "$HOOK_PATH"; then
  echo "error: $HOOK_PATH already exists and was not installed by this script." >&2
  echo "       Refusing to overwrite. Merge the check in by hand, or move the" >&2
  echo "       existing hook aside and re-run:" >&2
  echo "         npm run check:paths" >&2
  exit 1
fi

cat > "$HOOK_PATH" <<'HOOK'
#!/usr/bin/env bash
# managed-by: aira scripts/install-git-hooks.sh (RBR-786)
#
# Blocks a push when package.json references a path that is absent from git.
# Bypass in a genuine emergency with `git push --no-verify`.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ ! -d node_modules ]]; then
  echo "pre-push: node_modules missing, skipping check:paths." >&2
  exit 0
fi

echo "pre-push: verifying npm script paths exist in git..."
if ! npx --no-install tsx scripts/check-referenced-paths.ts; then
  echo "" >&2
  echo "pre-push: BLOCKED. Fix the paths above, or push with --no-verify." >&2
  exit 1
fi
HOOK

# The marker lives inside the heredoc, but re-assert it if the body ever
# changes and drops it, so the idempotency guard above keeps working.
grep -qF "$MARKER" "$HOOK_PATH" || {
  echo "error: generated hook is missing its management marker." >&2
  exit 1
}

chmod +x "$HOOK_PATH"
echo "Installed pre-push hook at $HOOK_PATH"
echo "It runs: npm run check:paths"
