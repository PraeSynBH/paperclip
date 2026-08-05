#!/usr/bin/env python3
"""Verify all nine RBR-771 acceptance criteria against the shipped RFQ packets.

Restored under RBR-780. RBR-771 closed reporting "all nine acceptance criteria
pass reproducibly (verify-rbr-771.py, exit 0)" but the script was never on
disk, which made data/rbr-771-final-packets/verification-output.txt an
unreproducible transcript. This is the reconstruction.

It runs against the CURRENT layout — data/rbr-771-final-packets/<cb>/ with five
files per CB. The old rbr-758-dispatch/ and rbr-760-dispatch/ directories named
in the stored transcript no longer exist and are deliberately not referenced.

The nine criteria (unchanged in substance from RBR-771):
  AC1  zero unresolved {{...}} tokens across every packet artifact
  AC2  sender contact resolved to ben.hamilton@aira.io everywhere
  AC3  phone-omission wording present verbatim in all four packets
  AC4  title reads the Clause 5.3 appointment; no stale CISO title anywhere
  AC5  the page-break guard is present in the tracked PDF stylesheet
  AC6  sanitization grep returns ZERO matches on outbound artifacts
  AC7  cover messages under the 1200-char contact-form ceiling
  AC8  pdftotext spot-check: all four PDFs render contact + title + phone,
       are token-free and sanitized, and their text layers are valid UTF-8
  AC9  no Company Overview table row splits across a page break

Usage:
    python3 scripts/rbr771/verify-rbr-771.py [--quiet] [--output FILE]

Exit codes:
    0  all nine acceptance criteria pass
    1  one or more criteria failed
    2  the packets or a required tool are missing (cannot verify)
"""

from __future__ import annotations

import argparse
import io
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rbr771 import packet_spec as spec  # noqa: E402


class Report:
    """Collects PASS/FAIL lines and tracks whether anything failed."""

    def __init__(self, stream: io.TextIOBase) -> None:
        self.stream = stream
        self.failed = 0
        self.passed = 0

    def section(self, title: str) -> None:
        print(f"\n=== {title} ===", file=self.stream)

    def ok(self, msg: str) -> None:
        self.passed += 1
        print(f"PASS  {msg}", file=self.stream)

    def bad(self, msg: str) -> None:
        self.failed += 1
        print(f"FAIL  {msg}", file=self.stream)

    def check(self, cond: bool, ok_msg: str, bad_msg: str | None = None) -> bool:
        if cond:
            self.ok(ok_msg)
        else:
            self.bad(bad_msg if bad_msg is not None else ok_msg)
        return cond


def read_text(path: Path) -> str:
    """Strict UTF-8 read.

    A decode error here is a finding in its own right, not a crash: RBR-771
    noted that a mis-encoded text layer "would have caused a verifier to either
    crash or silently skip checks on files it could not read." AC0 below runs
    first and turns that into an explicit FAIL, so by the time the other
    criteria run every file is known to be readable.
    """
    return path.read_bytes().decode("utf-8", errors="strict")


# ---------------------------------------------------------------------------
# Acceptance criteria
# ---------------------------------------------------------------------------


def ac0_encoding(r: Report, root: Path) -> set[Path]:
    """Every text artifact must be valid UTF-8. Returns the unreadable ones.

    This is the encoding guard promoted to a checked criterion. Without it, a
    Latin-1 text layer takes the verifier down with a traceback instead of
    producing a diagnosis.
    """
    r.section("AC0: every text artifact decodes as strict UTF-8")
    bad: set[Path] = set()
    checked = 0
    for slug in spec.CB_SLUGS:
        for name in spec.ALL_TEXT_FILES:
            p = root / slug / name
            checked += 1
            try:
                p.read_bytes().decode("utf-8", errors="strict")
            except UnicodeDecodeError as exc:
                bad.add(p)
                r.bad(
                    f"{slug}/{name}: not valid UTF-8 — byte 0x"
                    f"{exc.object[exc.start]:02x} at position {exc.start}. "
                    "This is the Latin-1 pdftotext regression; re-extract with "
                    "-enc UTF-8."
                )
    if not bad:
        r.ok(f"all {checked} text artifacts are valid UTF-8")
    return bad


def pdf_text(pdf: Path) -> str:
    """Extract a PDF text layer as UTF-8. Mirrors the build-time guard."""
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
        out = Path(tmp.name)
    try:
        subprocess.run(
            ["pdftotext", "-layout", "-enc", spec.PDFTOTEXT_ENCODING,
             str(pdf), str(out)],
            check=True,
            capture_output=True,
        )
        return out.read_bytes().decode("utf-8", errors="strict")
    finally:
        out.unlink(missing_ok=True)


def ac1_no_tokens(r: Report, root: Path, skip: set[Path]) -> None:
    r.section("AC1: zero {{...}} tokens across all packet artifacts")
    pattern = re.compile(spec.TOKEN_PATTERN)
    checked = 0
    offenders = []
    for slug in spec.CB_SLUGS:
        for name in spec.ALL_TEXT_FILES:
            p = root / slug / name
            if p in skip:
                r.bad(f"{slug}/{name}: skipped, unreadable (see AC0)")
                continue
            checked += 1
            hits = pattern.findall(read_text(p))
            if hits:
                offenders.append(f"{slug}/{name}: {sorted(set(hits))}")
    if offenders:
        for o in offenders:
            r.bad(f"unresolved token in {o}")
    else:
        r.ok(f"no unresolved tokens in {checked} files")


def ac2_contact(r: Report, root: Path, skip: set[Path]) -> None:
    r.section(f"AC2: contact resolved to {spec.SENDER_EMAIL} everywhere")
    for slug in spec.CB_SLUGS:
        for name in spec.ALL_TEXT_FILES:
            p = root / slug / name
            if p in skip:
                r.bad(f"{slug}/{name}: skipped, unreadable (see AC0)")
                continue
            r.check(
                spec.SENDER_EMAIL in read_text(p),
                f"{slug}/{name}",
                f"{slug}/{name}: sender email absent",
            )


def ac3_phone_wording(r: Report, root: Path, skip: set[Path]) -> None:
    r.section("AC3: phone-omission wording verbatim in all four packets")
    # The PDF text layer hard-wraps, so compare on collapsed whitespace.
    needle = re.sub(r"\s+", " ", spec.PHONE_WORDING).strip()
    for slug in spec.CB_SLUGS:
        for name in spec.ALL_TEXT_FILES:
            p = root / slug / name
            if p in skip:
                r.bad(f"{slug}/{name}: skipped, unreadable (see AC0)")
                continue
            hay = re.sub(r"\s+", " ", read_text(p))
            r.check(
                needle in hay,
                f"{slug}/{name}",
                f"{slug}/{name}: phone-omission wording not verbatim",
            )


def ac4_title(r: Report, root: Path, skip: set[Path]) -> None:
    r.section(
        f"AC4: title reads {spec.SENDER_TITLE!r}; no stale CISO title"
    )
    stale = re.compile(spec.STALE_TITLE_PATTERN, re.IGNORECASE)
    needle = re.sub(r"\s+", " ", spec.SENDER_TITLE)
    stale_hits = []
    for slug in spec.CB_SLUGS:
        for name in spec.ALL_TEXT_FILES:
            p = root / slug / name
            if p in skip:
                r.bad(f"{slug}/{name}: skipped, unreadable (see AC0)")
                continue
            raw = read_text(p)
            hay = re.sub(r"\s+", " ", raw)
            count = hay.count(needle)
            r.check(
                count >= 1,
                f"{slug}/{name} (x{count})",
                f"{slug}/{name}: appointed title absent",
            )
            if stale.search(raw):
                stale_hits.append(f"{slug}/{name}")
    r.check(
        not stale_hits,
        "no stale CISO title anywhere",
        f"stale CISO title present in: {stale_hits}",
    )


def ac5_page_break_rule(r: Report) -> None:
    r.section("AC5: tr { break-inside: avoid } retained in the stylesheet")
    css = Path(__file__).resolve().parent / "rfq-pdf-style.css"
    if not css.is_file():
        r.bad(f"stylesheet missing: {css}")
        return
    r.check(
        re.search(r"break-inside:\s*avoid", read_text(css)) is not None,
        f"scripts/rbr771/{css.name}",
        f"scripts/rbr771/{css.name}: break-inside rule removed",
    )


def ac6_sanitization(r: Report, root: Path) -> None:
    r.section("AC6: sanitization grep returns ZERO matches on OUTBOUND artifacts")
    pats = [(p, re.compile(p, re.IGNORECASE)) for p in spec.LEAK_PATTERNS]
    checked = 0
    offenders = []
    for slug in spec.CB_SLUGS:
        for name in spec.OUTBOUND_FILES:
            p = root / slug / name
            checked += 1
            try:
                text = read_text(p)
            except UnicodeDecodeError:
                offenders.append(f"{slug}/{name}: unreadable, cannot be leak-checked (see AC0)")
                continue
            for src, rx in pats:
                m = rx.search(text)
                if m:
                    offenders.append(f"{slug}/{name}: /{src}/ matched {m.group(0)!r}")
        # The PDF ships too — check its text layer with the same patterns.
        pdf = root / slug / spec.PDF_FILE
        checked += 1
        text = pdf_text(pdf)
        for src, rx in pats:
            m = rx.search(text)
            if m:
                offenders.append(f"{slug}/{spec.PDF_FILE}: /{src}/ matched {m.group(0)!r}")
    if offenders:
        for o in offenders:
            r.bad(o)
    else:
        r.ok(f"zero matches across {checked} outbound artifacts")


def ac7_cover_ceiling(r: Report, root: Path) -> None:
    r.section(f"AC7: cover messages under the {spec.COVER_CHAR_CEILING}-char ceiling")
    for slug in spec.CB_SLUGS:
        p = root / slug / spec.COVER_FILE
        try:
            n = len(read_text(p))
        except UnicodeDecodeError:
            r.bad(f"{slug}/{spec.COVER_FILE}: unreadable, cannot measure (see AC0)")
            continue
        r.check(
            n <= spec.COVER_CHAR_CEILING,
            f"{slug}/{spec.COVER_FILE} = {n} chars",
            f"{slug}/{spec.COVER_FILE} = {n} chars, OVER the "
            f"{spec.COVER_CHAR_CEILING} ceiling by {n - spec.COVER_CHAR_CEILING}",
        )


def ac8_pdf_spotcheck(r: Report, root: Path) -> None:
    r.section("AC8: pdftotext spot-check on all four PDFs")
    token_rx = re.compile(spec.TOKEN_PATTERN)
    leak_rx = [(p, re.compile(p, re.IGNORECASE)) for p in spec.LEAK_PATTERNS]
    phone = re.sub(r"\s+", " ", spec.PHONE_WORDING).strip()
    title = re.sub(r"\s+", " ", spec.SENDER_TITLE)

    for slug in spec.CB_SLUGS:
        pdf = root / slug / spec.PDF_FILE
        if not pdf.is_file():
            r.bad(f"{slug}/{spec.PDF_FILE}: missing")
            continue

        header = pdf.read_bytes()[:8]
        r.check(
            header.startswith(b"%PDF-1."),
            f"{slug}/{spec.PDF_FILE} is a valid PDF ({header.decode('ascii', 'replace').strip()})",
            f"{slug}/{spec.PDF_FILE}: not a PDF (header {header!r})",
        )

        try:
            raw = pdf_text(pdf)
        except UnicodeDecodeError as exc:
            r.bad(
                f"{slug}/{spec.PDF_FILE}: text layer is not valid UTF-8 ({exc}) "
                "— pdftotext was run without -enc UTF-8"
            )
            continue

        flat = re.sub(r"\s+", " ", raw)
        r.check(spec.SENDER_EMAIL in flat, f"{slug}/{spec.PDF_FILE} contact line renders")
        r.check(title in flat, f"{slug}/{spec.PDF_FILE} title renders")
        r.check(phone in flat, f"{slug}/{spec.PDF_FILE} phone wording renders")
        r.check(not token_rx.search(raw), f"{slug}/{spec.PDF_FILE} token-free")
        hits = [p for p, rx in leak_rx if rx.search(raw)]
        r.check(
            not hits,
            f"{slug}/{spec.PDF_FILE} sanitized",
            f"{slug}/{spec.PDF_FILE}: leak patterns matched {hits}",
        )

        # The stored rfq-pdftext.txt must reflect the PDF actually shipped.
        stored = root / slug / spec.PDFTEXT_FILE
        try:
            stored_flat = re.sub(r"\s+", " ", read_text(stored)).strip()
        except UnicodeDecodeError:
            r.bad(f"{slug}/{spec.PDFTEXT_FILE}: unreadable, cannot compare (see AC0)")
            continue
        r.check(
            stored_flat == flat.strip(),
            f"{slug}/{spec.PDFTEXT_FILE} matches the shipped PDF text layer",
            f"{slug}/{spec.PDFTEXT_FILE} is stale relative to {slug}/{spec.PDF_FILE}",
        )


def ac9_no_split_rows(r: Report, root: Path) -> None:
    r.section("AC9: no Company Overview table row split across a page break")
    # The six Company Overview attribute labels, in order. A row is "split" if
    # its label lands on a different page from the start of its value.
    labels = [
        "Company",
        "Industry",
        "Headquarters",
        "Employee Count",
        "Physical Sites",
        "Cloud Infrastructure",
    ]
    for slug in spec.CB_SLUGS:
        try:
            text = read_text(root / slug / spec.PDFTEXT_FILE)
        except UnicodeDecodeError:
            r.bad(f"{slug}/{spec.PDFTEXT_FILE}: unreadable, cannot check page breaks (see AC0)")
            continue
        pages = text.split("\f")
        # Locate the page holding the Company Overview table, then confirm the
        # label sits on a page that also carries table content after it.
        intact = 0
        for label in labels:
            found_page = None
            for idx, page in enumerate(pages):
                if re.search(rf"^\s*{re.escape(label)}\b", page, re.MULTILINE):
                    found_page = idx
                    break
            if found_page is None:
                continue
            page = pages[found_page]
            m = re.search(rf"^\s*{re.escape(label)}\b(.*)$", page, re.MULTILINE)
            tail = page[m.end():] if m else ""
            # A row whose label is the last thing on the page, with no value
            # text following it before the break, has been split.
            if (m and m.group(1).strip()) or tail.strip():
                intact += 1
        r.check(
            intact == len(labels),
            f"{slug}/{spec.PDFTEXT_FILE}: all {len(labels)} Company Overview "
            "rows intact on one page",
            f"{slug}/{spec.PDFTEXT_FILE}: only {intact}/{len(labels)} Company "
            "Overview rows intact — a row split across a page break",
        )


# ---------------------------------------------------------------------------


def preflight(root: Path) -> list[str]:
    problems = []
    if not shutil.which("pdftotext"):
        problems.append("pdftotext not on PATH (brew install poppler)")
    if not root.is_dir():
        problems.append(f"packet root does not exist: {root}")
        return problems
    for slug in spec.CB_SLUGS:
        d = root / slug
        if not d.is_dir():
            problems.append(f"missing packet directory: {d}")
            continue
        for name in spec.ALL_TEXT_FILES + [spec.PDF_FILE]:
            if not (d / name).is_file():
                problems.append(f"missing artifact: {slug}/{name}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--quiet", action="store_true", help="only print the verdict")
    ap.add_argument(
        "--output",
        type=Path,
        help="also write the full transcript to this file",
    )
    args = ap.parse_args()

    root = spec.packet_root()

    problems = preflight(root)
    if problems:
        for p in problems:
            print(f"FAIL  {p}", file=sys.stderr)
        print("\nCANNOT VERIFY — see above.", file=sys.stderr)
        return 2

    buf = io.StringIO()
    r = Report(buf)

    unreadable = ac0_encoding(r, root)
    ac1_no_tokens(r, root, unreadable)
    ac2_contact(r, root, unreadable)
    ac3_phone_wording(r, root, unreadable)
    ac4_title(r, root, unreadable)
    ac5_page_break_rule(r)
    ac6_sanitization(r, root)
    ac7_cover_ceiling(r, root)
    ac8_pdf_spotcheck(r, root)
    ac9_no_split_rows(r, root)

    verdict = (
        "ALL ACCEPTANCE CRITERIA PASSED"
        if r.failed == 0
        else f"{r.failed} CHECK(S) FAILED ({r.passed} passed)"
    )
    print(f"\n{verdict}", file=buf)

    transcript = buf.getvalue().lstrip("\n")
    if not args.quiet:
        print(transcript)
    else:
        print(verdict)

    if args.output:
        args.output.write_text(transcript, encoding="utf-8")
        print(f"transcript written to {args.output}")

    return 0 if r.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
