#!/usr/bin/env bash
#
# Rebuild all four RFQ PDFs and their extracted text layers from the tracked
# Markdown sources in data/rbr-771-final-packets/<cb>/rfq-source.md.
#
# Restored under RBR-780. The original went missing from disk, leaving
# verification-output.txt an unreproducible transcript.
#
# Build-time guard: the text layer is extracted with `pdftotext -enc UTF-8`.
# pdftotext defaults to Latin-1, which mangles every em-dash and produces a
# file that will not decode as UTF-8 — a verifier reading it would either crash
# or silently skip its checks. This script re-decodes every extracted layer as
# strict UTF-8 and refuses to keep an artifact that fails.
#
# SAFETY: by default this builds into a staging directory and compares against
# the shipped packets. It does NOT overwrite them. Pass --in-place to actually
# replace data/rbr-771-final-packets/<cb>/rfq.pdf and rfq-pdftext.txt. The
# shipped packets were hand-verified on RBR-398 (comment 33795e0e); do not
# re-cut them without a reason.
#
# Usage:
#   ./scripts/rbr771/regenerate-all-rfq-pdfs.sh              # staged build + compare
#   ./scripts/rbr771/regenerate-all-rfq-pdfs.sh --in-place   # overwrite the packets
#
# Exit codes:
#   0  every PDF built, every text layer is valid UTF-8, guards passed
#   1  a guard failed or a required tool is missing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PACKET_ROOT="${RBR771_PACKET_ROOT:-${WORKSPACE_ROOT}/data/rbr-771-final-packets}"
STYLESHEET="${SCRIPT_DIR}/rfq-pdf-style.css"

CBS=(align schellman barr ispartners)

IN_PLACE=0
for arg in "$@"; do
  case "$arg" in
    --in-place) IN_PLACE=1 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

fail() { echo "FAIL  $*" >&2; FAILURES=$((FAILURES + 1)); }
FAILURES=0

# -- tool preflight ---------------------------------------------------------
for tool in pandoc weasyprint pdftotext python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FAIL  required tool not on PATH: $tool" >&2
    echo "      install: brew install pandoc weasyprint poppler" >&2
    exit 1
  fi
done

if [[ ! -d "$PACKET_ROOT" ]]; then
  echo "FAIL  packet root does not exist: $PACKET_ROOT" >&2
  exit 1
fi
if [[ ! -f "$STYLESHEET" ]]; then
  echo "FAIL  stylesheet missing: $STYLESHEET" >&2
  exit 1
fi

# RBR-771 AC5 — the page-break guard must be in the stylesheet we are about to
# use, not just in a comment about it.
if ! grep -qE 'break-inside:\s*avoid' "$STYLESHEET"; then
  echo "FAIL  stylesheet has no 'break-inside: avoid' rule; Company Overview" >&2
  echo "      table rows would split across page breaks (RBR-771 AC5)" >&2
  exit 1
fi

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/rbr771-pdfs.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT

if [[ $IN_PLACE -eq 1 ]]; then
  echo "MODE  in-place — will overwrite $PACKET_ROOT/<cb>/rfq.pdf"
else
  echo "MODE  staged — building into $STAGING (packets left untouched)"
  echo "      pass --in-place to overwrite the shipped packets"
fi
echo

for cb in "${CBS[@]}"; do
  src="${PACKET_ROOT}/${cb}/rfq-source.md"
  if [[ ! -f "$src" ]]; then
    fail "${cb}: source missing: $src"
    continue
  fi

  mkdir -p "${STAGING}/${cb}"
  pdf="${STAGING}/${cb}/rfq.pdf"
  txt="${STAGING}/${cb}/rfq-pdftext.txt"

  # pandoc keeps its own default HTML template; the stylesheet above is layered
  # on top of it via WeasyPrint's -s flag.
  if ! pandoc "$src" \
        --from=markdown \
        --pdf-engine=weasyprint \
        --pdf-engine-opt=-s \
        --pdf-engine-opt="$STYLESHEET" \
        --metadata title="rbr-771-${cb}-rfq" \
        --output="$pdf" 2>"${STAGING}/${cb}/pandoc.log"; then
    fail "${cb}: pandoc/weasyprint build failed:"
    sed 's/^/      /' "${STAGING}/${cb}/pandoc.log" >&2
    continue
  fi

  # -- GUARD: UTF-8 text layer ---------------------------------------------
  # -enc UTF-8 is mandatory. Without it pdftotext writes Latin-1 and every
  # em-dash in the packet becomes an undecodable byte.
  if ! pdftotext -layout -enc "UTF-8" "$pdf" "$txt" 2>/dev/null; then
    fail "${cb}: pdftotext extraction failed"
    continue
  fi

  if ! python3 - "$txt" <<'PY'
import sys
path = sys.argv[1]
raw = open(path, "rb").read()
try:
    raw.decode("utf-8", errors="strict")
except UnicodeDecodeError as exc:
    print(f"      text layer is not valid UTF-8: {exc}", file=sys.stderr)
    sys.exit(1)
PY
  then
    fail "${cb}: extracted text layer failed the strict-UTF-8 guard"
    rm -f "$pdf" "$txt"   # refuse to emit a mis-encoded artifact
    continue
  fi

  # A PDF whose text layer lost its em-dashes to a Latin-1 round-trip shows up
  # as U+FFFD or a literal '--'; check the source's dashes actually survived.
  if grep -q '—' "$src" && ! grep -q '—' "$txt"; then
    fail "${cb}: em-dash present in source but absent from the text layer — \
encoding regression"
    rm -f "$pdf" "$txt"
    continue
  fi

  pages="$(pdfinfo "$pdf" 2>/dev/null | awk '/^Pages:/{print $2}')"
  bytes="$(wc -c <"$pdf" | tr -d ' ')"
  echo "OK    ${cb}: rfq.pdf built (${pages} pages, ${bytes} bytes), text layer valid UTF-8"

  if [[ $IN_PLACE -eq 1 ]]; then
    cp "$pdf" "${PACKET_ROOT}/${cb}/rfq.pdf"
    cp "$txt" "${PACKET_ROOT}/${cb}/rfq-pdftext.txt"
    echo "      -> installed into ${PACKET_ROOT}/${cb}/"
  else
    shipped="${PACKET_ROOT}/${cb}/rfq-pdftext.txt"
    if [[ -f "$shipped" ]]; then
      if diff -q "$txt" "$shipped" >/dev/null 2>&1; then
        echo "      text layer is byte-identical to the shipped packet"
      else
        # Not a failure: WeasyPrint/pandoc version drift changes line wrapping
        # without changing content. The verifier checks content, not bytes.
        echo "      text layer differs from the shipped packet (layout only \
unless verify-rbr-771.py disagrees)"
      fi
    fi
  fi
done

echo
if [[ $FAILURES -gt 0 ]]; then
  echo "GUARD FAILED: ${FAILURES} certification body/bodies did not build cleanly." >&2
  exit 1
fi

echo "ALL 4 PDFs BUILT — UTF-8 text-layer guard passed, page-break rule present"
if [[ $IN_PLACE -eq 0 ]]; then
  echo "(staged build; shipped packets were not modified)"
fi
exit 0
