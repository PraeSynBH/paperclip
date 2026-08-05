#!/usr/bin/env python3
"""Drive scripts/store_compliance_mailbox_password.sh under a real PTY.

Verifies the interactive paths without a real credential and without touching
the operator's actual Keychain entry: SERVICE is overridden via a sandbox
keychain so nothing real is written.
"""
import os
import pty
import re
import select
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "store_compliance_mailbox_password.sh")

# Throwaway Keychain service so the real `aira-compliance-mailbox` entry is
# never created, overwritten, or deleted by this suite.
TEST_SERVICE = "aira-compliance-mailbox-selftest-DELETEME"
TEST_ACCOUNT = "test-not-a-real-address@invalid"


def cleanup():
    subprocess.run(
        ["security", "delete-generic-password", "-s", TEST_SERVICE, "-a", TEST_ACCOUNT],
        capture_output=True,
    )


def run(inputs, timeout=180):
    """Run the script under a PTY, feeding `inputs` at each prompt."""
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        os.environ["COMPLIANCE_MAILBOX_KEYCHAIN_SERVICE"] = TEST_SERVICE
        os.environ["COMPLIANCE_MAILBOX_ADDRESS"] = TEST_ACCOUNT
        os.execvp("bash", ["bash", SCRIPT])
    out, pending = [], list(inputs)
    while True:
        try:
            r, _, _ = select.select([fd], [], [], timeout)
        except OSError:
            break
        if not r:
            break
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        text = chunk.decode(errors="replace")
        out.append(text)
        if pending and re.search(r"(App Password|Confirm):\s*$", "".join(out)[-200:]):
            os.write(fd, (pending.pop(0) + "\n").encode())
    _, status = os.waitpid(pid, 0)
    os.close(fd)
    return os.waitstatus_to_exitcode(status), "".join(out)


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f" — {detail}" if not cond and detail else ""))
    return bool(cond)


results = []

print("Mismatch confirmation must abort without storing")
rc, out = run(["abcdefghijklmnop", "ponmlkjihgfedcba"])
results.append(check("non-zero exit", rc != 0, f"got {rc}"))
results.append(check("says entries did not match", "did not match" in out))
results.append(check("says nothing stored", "Nothing stored" in out))
results.append(check("never echoes the typed value", "abcdefghijklmnop" not in out))

print("\nEmpty input must abort without storing")
rc, out = run(["", ""])
results.append(check("non-zero exit", rc != 0, f"got {rc}"))
results.append(check("reports empty input", "Empty input" in out))

print("\nMalformed password warns but still reaches the live gate")
rc, out = run(["NotAnAppPassword123", "NotAnAppPassword123"])
results.append(check("warns on shape", "does not look like a Google App Password" in out))
results.append(check("reaches selftest", "Live gate" in out or "selftest" in out))
results.append(check("selftest fails on a bogus credential", rc != 0, f"got {rc}"))
results.append(check("never echoes the typed value", "NotAnAppPassword123" not in out))
results.append(check(
    "failure text explains the indeterminate-probe trap",
    "does not distinguish" in out,
))

print("\nSpace-stripping: Google's 4x4 display form is accepted")
rc, out = run(["abcd efgh ijkl mnop", "abcdefghijklmnop"])
results.append(check(
    "spaced and unspaced forms treated as equal",
    "did not match" not in out,
))
results.append(check("no shape warning for a well-formed value",
                     "does not look like" not in out))
results.append(check("never echoes the typed value", "abcd efgh" not in out))

print("\nTerminal echo is off at the driver level, and restored on interrupt")
# The `read -rs` builtin only suppresses echo once it is already running.
# Keystrokes arriving between the prompt being printed and `read` starting are
# echoed by the tty driver into scrollback in cleartext. These two checks pin
# the fix (stty -echo before the prompt + a restore trap) so it cannot regress.
import signal
import termios
import time


def echo_state_probe():
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        os.environ["COMPLIANCE_MAILBOX_KEYCHAIN_SERVICE"] = TEST_SERVICE
        os.environ["COMPLIANCE_MAILBOX_ADDRESS"] = TEST_ACCOUNT
        os.execvp("bash", ["bash", SCRIPT])
    buf = ""
    while "App Password:" not in buf:
        r, _, _ = select.select([fd], [], [], 15)
        if not r:
            break
        try:
            buf += os.read(fd, 4096).decode(errors="replace")
        except OSError:
            break
    during = bool(termios.tcgetattr(fd)[3] & termios.ECHO)
    os.kill(pid, signal.SIGINT)
    time.sleep(1.5)
    try:
        while True:
            r, _, _ = select.select([fd], [], [], 0.5)
            if not r or not os.read(fd, 4096):
                break
    except OSError:
        pass
    after = bool(termios.tcgetattr(fd)[3] & termios.ECHO)
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    except (OSError, ChildProcessError):
        pass
    return during, after


during_echo, after_echo = echo_state_probe()
results.append(check("ECHO disabled at the tty driver while prompting",
                     during_echo is False))
results.append(check("ECHO restored after SIGINT (no wedged terminal)",
                     after_echo is True))

passed, total = sum(results), len(results)
cleanup()
print(f"\n{passed}/{total} checks passed")
sys.exit(0 if passed == total else 1)
