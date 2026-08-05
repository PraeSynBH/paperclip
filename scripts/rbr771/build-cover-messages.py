#!/usr/bin/env python3
"""Rebuild all four RFQ cover messages into data/rbr-771-final-packets/<cb>/.

Restored under RBR-780. The original went missing from disk, which left
`verification-output.txt` an unreproducible transcript.

The build-time guard is the point of this script: a cover message that exceeds
the web contact form's character ceiling is *not written*. RBR-766 shipped
A-LIGN at 1278 and Schellman at 1328 characters against a 1200 ceiling because
it inserted the phone-omission wording and never re-measured. Failing the build
is how that stops happening silently.

Usage:
    python3 scripts/rbr771/build-cover-messages.py [--check] [--verbose]

    --check   do not write; exit 1 if any on-disk cover differs from the
              rendered output or would breach the ceiling
Exit codes:
    0  all four covers written (or, with --check, already correct)
    1  a guard failed: ceiling breach, non-ASCII, or content drift
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rbr771 import packet_spec as spec  # noqa: E402


def guard_cover(slug: str, text: str) -> list[str]:
    """Return a list of guard failures for one rendered cover message."""
    failures: list[str] = []

    # Guard 1: the web contact form character ceiling.
    n = len(text)
    if n > spec.COVER_CHAR_CEILING:
        failures.append(
            f"{slug}: cover message is {n} chars, over the "
            f"{spec.COVER_CHAR_CEILING}-char contact-form ceiling by "
            f"{n - spec.COVER_CHAR_CEILING}"
        )

    # Guard 2: encoding. The cover messages are pasted into arbitrary web forms
    # whose charset we do not control, so they stay pure ASCII. The em-dash
    # belongs in the PDF and the full-text body, not here.
    try:
        text.encode("ascii")
    except UnicodeEncodeError as exc:
        bad = sorted({c for c in text if ord(c) > 127})
        failures.append(
            f"{slug}: cover message is not ASCII ({exc.reason}); "
            f"offending characters: {bad!r}"
        )

    # Guard 3: the identity and wording RBR-771 fixed must actually be present.
    for label, needle in (
        ("sender email", spec.SENDER_EMAIL),
        ("appointed title", spec.SENDER_TITLE),
        ("phone-omission wording", spec.PHONE_WORDING),
    ):
        if needle not in text:
            failures.append(f"{slug}: {label} missing from cover message")

    return failures


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify on-disk covers match without writing",
    )
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    root = spec.packet_root()
    if not root.is_dir():
        print(f"FAIL  packet root does not exist: {root}", file=sys.stderr)
        return 1

    failures: list[str] = []
    drift: list[str] = []

    for cb in spec.CERTIFICATION_BODIES:
        slug = cb["slug"]
        text = spec.render_cover_message(cb)

        cb_failures = guard_cover(slug, text)
        if cb_failures:
            failures.extend(cb_failures)
            # Guard semantics: refuse to emit the bad artifact at all.
            continue

        target = root / slug / spec.COVER_FILE
        target.parent.mkdir(parents=True, exist_ok=True)

        existing = (
            target.read_text(encoding="utf-8") if target.exists() else None
        )

        if args.check:
            if existing != text:
                drift.append(
                    f"{slug}: on-disk cover differs from rendered output "
                    f"({target})"
                )
            else:
                print(f"OK    {slug}/{spec.COVER_FILE} = {len(text)} chars")
            continue

        target.write_text(text, encoding="utf-8")
        state = "unchanged" if existing == text else "written"
        print(
            f"OK    {slug}/{spec.COVER_FILE} = {len(text)} chars "
            f"(ceiling {spec.COVER_CHAR_CEILING}, {state})"
        )

    for f in failures + drift:
        print(f"FAIL  {f}", file=sys.stderr)

    if failures:
        print(
            f"\nGUARD FAILED: {len(failures)} problem(s). No bad cover message "
            "was written.",
            file=sys.stderr,
        )
        return 1
    if drift:
        print(
            f"\nCHECK FAILED: {len(drift)} cover message(s) drifted from the "
            "spec. Re-run without --check to rebuild.",
            file=sys.stderr,
        )
        return 1

    print(
        f"\nALL {len(spec.CERTIFICATION_BODIES)} COVER MESSAGES "
        f"{'VERIFIED' if args.check else 'BUILT'} — all under the "
        f"{spec.COVER_CHAR_CEILING}-char ceiling"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
