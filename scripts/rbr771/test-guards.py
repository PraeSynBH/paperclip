#!/usr/bin/env python3
"""Negative tests: prove the RBR-771 guards actually fail on bad input.

RBR-780 acceptance: "the 1200-char and UTF-8 guards demonstrably fail on a
deliberately bad input." A guard that has never been observed to fail is
indistinguishable from no guard at all, which is exactly how RBR-766 shipped
1278- and 1328-char cover messages against a 1200 ceiling.

Each test builds a deliberately broken copy of the packets in a temp directory,
points the scripts at it via RBR771_PACKET_ROOT, and asserts a NON-ZERO exit.

Usage:
    python3 scripts/rbr771/test-guards.py

Exit codes:
    0  every guard failed as designed on its bad input (and passed on good input)
    1  a guard did not fire — the guard is broken
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from rbr771 import packet_spec as spec  # noqa: E402

VERIFY = HERE / "verify-rbr-771.py"
BUILD_COVERS = HERE / "build-cover-messages.py"

RESULTS: list[tuple[bool, str]] = []


def record(ok: bool, name: str, detail: str = "") -> None:
    RESULTS.append((ok, name))
    mark = "PASS" if ok else "FAIL"
    line = f"{mark}  {name}"
    if detail:
        line += f"\n        {detail}"
    print(line)


def run(script: Path, root: Path, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ, RBR771_PACKET_ROOT=str(root))
    return subprocess.run(
        [sys.executable, str(script), *args],
        env=env,
        capture_output=True,
        text=True,
    )


def fresh_copy(tmp: Path, name: str) -> Path:
    """Copy the real packets into an isolated scratch directory."""
    dst = tmp / name
    shutil.copytree(spec.packet_root(), dst)
    return dst


# ---------------------------------------------------------------------------
# Guard 1 — the 1200-char cover-message ceiling
# ---------------------------------------------------------------------------


def test_ceiling_guard_in_builder(tmp: Path) -> None:
    """build-cover-messages.py must refuse to emit an over-ceiling cover."""
    root = fresh_copy(tmp, "ceiling-builder")

    original = spec.COVER_CHAR_CEILING
    # Simulate prose growth by lowering the ceiling below the real lengths;
    # equivalent to the RBR-766 regression where the prose grew past a fixed
    # ceiling. Done via a subprocess-visible override so the real script runs.
    override = HERE / "_tmp_low_ceiling.py"
    override.write_text(
        "import runpy, sys\n"
        f"sys.path.insert(0, {str(HERE.parent)!r})\n"
        "from rbr771 import packet_spec as spec\n"
        "spec.COVER_CHAR_CEILING = 1000\n"
        f"sys.argv = ['build-cover-messages.py']\n"
        f"runpy.run_path({str(BUILD_COVERS)!r}, run_name='__main__')\n",
        encoding="utf-8",
    )
    try:
        env = dict(os.environ, RBR771_PACKET_ROOT=str(root))
        proc = subprocess.run(
            [sys.executable, str(override)],
            env=env,
            capture_output=True,
            text=True,
        )
        fired = proc.returncode != 0 and "ceiling" in proc.stderr.lower()
        record(
            fired,
            "1200-char ceiling guard: builder refuses over-ceiling cover",
            f"exit={proc.returncode}; stderr head: "
            f"{proc.stderr.strip().splitlines()[0] if proc.stderr.strip() else '(empty)'}",
        )

        # And it must not have written the bad artifact.
        untouched = all(
            len((root / slug / spec.COVER_FILE).read_text(encoding="utf-8"))
            <= original
            for slug in spec.CB_SLUGS
        )
        record(
            untouched,
            "1200-char ceiling guard: no bad cover message written to disk",
        )
    finally:
        override.unlink(missing_ok=True)


def test_ceiling_guard_in_verifier(tmp: Path) -> None:
    """verify-rbr-771.py AC7 must fail on an over-ceiling cover on disk."""
    root = fresh_copy(tmp, "ceiling-verify")
    target = root / "align" / spec.COVER_FILE
    text = target.read_text(encoding="utf-8")
    # Push it to 1278 chars — the exact length RBR-766 actually shipped.
    padding = 1278 - len(text)
    bloated = text.replace(
        "Thank you,",
        "PS: " + ("x" * (padding - 6)) + "\n\nThank you,",
    )
    target.write_text(bloated, encoding="utf-8")
    actual = len(target.read_text(encoding="utf-8"))

    proc = run(VERIFY, root)
    fired = proc.returncode == 1 and "OVER the 1200 ceiling" in proc.stdout
    record(
        fired,
        f"1200-char ceiling guard: verifier AC7 fails at {actual} chars",
        f"exit={proc.returncode}",
    )


# ---------------------------------------------------------------------------
# Guard 2 — UTF-8 encoding of the PDF text layer
# ---------------------------------------------------------------------------


def test_utf8_guard_in_verifier(tmp: Path) -> None:
    """A Latin-1 text layer must fail, not be silently skipped.

    This reproduces the exact RBR-771 defect: pdftotext without -enc UTF-8
    writes Latin-1, so every em-dash becomes byte 0x97, which is not valid
    UTF-8. The old failure mode was a verifier that crashed or skipped the file.
    """
    root = fresh_copy(tmp, "utf8-verify")
    target = root / "align" / spec.PDFTEXT_FILE
    text = target.read_text(encoding="utf-8")
    # Re-encode as cp1252, the practical Latin-1 default, producing raw 0x97
    # bytes where the em-dashes were.
    target.write_bytes(text.encode("cp1252", errors="replace"))

    raw = target.read_bytes()
    still_utf8 = True
    try:
        raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        still_utf8 = False
    n_bad = raw.count(b"\x97")
    record(
        not still_utf8,
        "UTF-8 guard: fixture is genuinely non-UTF-8 (mis-encoded em-dash)",
        f"{n_bad} raw 0x97 bytes where em-dashes were",
    )

    proc = run(VERIFY, root)
    combined = proc.stdout + proc.stderr
    # It must fail loudly and name the encoding, not exit 0 or skip the file.
    fired = proc.returncode != 0 and (
        "utf-8" in combined.lower() or "codec" in combined.lower()
    )
    record(
        fired,
        "UTF-8 guard: verifier fails on a Latin-1 text layer (does not skip it)",
        f"exit={proc.returncode}",
    )


def test_utf8_guard_in_builder(tmp: Path) -> None:
    """regenerate-all-rfq-pdfs.sh must reject a non-UTF-8 extraction."""
    script = HERE / "regenerate-all-rfq-pdfs.sh"
    root = fresh_copy(tmp, "utf8-build")

    # Shim a pdftotext that ignores -enc UTF-8 and writes Latin-1, i.e. the
    # pre-RBR-771 behaviour we are guarding against.
    binshim = tmp / "badbin"
    binshim.mkdir(exist_ok=True)
    real = shutil.which("pdftotext")

    helper = binshim / "latin1ify.py"
    helper.write_text(
        "import subprocess, sys\n"
        "real = sys.argv[1]\n"
        "# drop any -enc flag, exactly as a pre-RBR-771 invocation would\n"
        "args, rest = [], sys.argv[2:]\n"
        "i = 0\n"
        "while i < len(rest):\n"
        "    if rest[i] == '-enc':\n"
        "        i += 2\n"
        "        continue\n"
        "    args.append(rest[i])\n"
        "    i += 1\n"
        "r = subprocess.run([real] + args)\n"
        "if r.returncode != 0:\n"
        "    sys.exit(r.returncode)\n"
        "out = args[-1]\n"
        "d = open(out, encoding='utf-8', errors='replace').read()\n"
        "open(out, 'wb').write(d.encode('cp1252', errors='replace'))\n",
        encoding="utf-8",
    )

    shim = binshim / "pdftotext"
    shim.write_text(
        "#!/usr/bin/env bash\n"
        f'exec {sys.executable} {helper} {real} "$@"\n',
        encoding="utf-8",
    )
    shim.chmod(0o755)

    env = dict(
        os.environ,
        RBR771_PACKET_ROOT=str(root),
        PATH=f"{binshim}{os.pathsep}{os.environ['PATH']}",
    )
    proc = subprocess.run(
        ["bash", str(script)], env=env, capture_output=True, text=True
    )
    combined = proc.stdout + proc.stderr
    fired = proc.returncode != 0 and (
        "UTF-8" in combined or "encoding regression" in combined
    )
    record(
        fired,
        "UTF-8 guard: PDF build refuses a Latin-1 text layer",
        f"exit={proc.returncode}",
    )


# ---------------------------------------------------------------------------
# Guard 3 — the checks that keep internal references out of outbound artifacts
# ---------------------------------------------------------------------------


def test_leak_guard(tmp: Path) -> None:
    root = fresh_copy(tmp, "leak")
    target = root / "barr" / spec.COVER_FILE
    target.write_text(
        target.read_text(encoding="utf-8").replace(
            "Thank you,", "Prepared by the RBR-771 workstream.\n\nThank you,"
        ),
        encoding="utf-8",
    )
    proc = run(VERIFY, root)
    fired = proc.returncode == 1 and "matched" in proc.stdout
    record(
        fired,
        "sanitization guard: verifier AC6 fails on an internal reference leak",
        f"exit={proc.returncode}",
    )


def test_stale_title_guard(tmp: Path) -> None:
    root = fresh_copy(tmp, "stale-title")
    target = root / "schellman" / spec.COVER_FILE
    target.write_text(
        target.read_text(encoding="utf-8").replace(
            spec.SENDER_TITLE, "Ben Hamilton, CISO"
        ),
        encoding="utf-8",
    )
    proc = run(VERIFY, root)
    fired = proc.returncode == 1 and "stale CISO title" in proc.stdout
    record(
        fired,
        "title guard: verifier AC4 fails when the stale CISO title returns",
        f"exit={proc.returncode}",
    )


def test_token_guard(tmp: Path) -> None:
    root = fresh_copy(tmp, "token")
    target = root / "ispartners" / spec.COVER_FILE
    target.write_text(
        target.read_text(encoding="utf-8").replace(
            spec.SENDER_EMAIL, "{{SENDER_EMAIL}}"
        ),
        encoding="utf-8",
    )
    proc = run(VERIFY, root)
    fired = proc.returncode == 1 and "unresolved token" in proc.stdout
    record(
        fired,
        "token guard: verifier AC1 fails on an unresolved {{...}} placeholder",
        f"exit={proc.returncode}",
    )


# ---------------------------------------------------------------------------
# Positive control — the real packets must still pass
# ---------------------------------------------------------------------------


def test_real_packets_pass() -> None:
    proc = run(VERIFY, spec.packet_root(), "--quiet")
    record(
        proc.returncode == 0 and "ALL ACCEPTANCE CRITERIA PASSED" in proc.stdout,
        "positive control: the shipped packets still pass all nine criteria",
        f"exit={proc.returncode}",
    )


def main() -> int:
    print("RBR-780 guard tests — proving the guards fail on bad input\n")
    print(f"packet root: {spec.packet_root()}\n")

    with tempfile.TemporaryDirectory(prefix="rbr780-guards-") as td:
        tmp = Path(td)
        test_real_packets_pass()
        test_ceiling_guard_in_builder(tmp)
        test_ceiling_guard_in_verifier(tmp)
        test_utf8_guard_in_verifier(tmp)
        test_utf8_guard_in_builder(tmp)
        test_leak_guard(tmp)
        test_stale_title_guard(tmp)
        test_token_guard(tmp)

    failed = [name for ok, name in RESULTS if not ok]
    print()
    if failed:
        print(f"{len(failed)} GUARD TEST(S) FAILED:")
        for name in failed:
            print(f"  - {name}")
        return 1
    print(f"ALL {len(RESULTS)} GUARD TESTS PASSED — every guard fires on bad input")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
