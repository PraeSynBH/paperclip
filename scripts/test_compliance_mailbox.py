#!/usr/bin/env python3
"""Regression tests for scripts/compliance_mailbox.py — RBR-759.

Runs against tiny in-process fake IMAP and SMTP servers, so it needs no
credentials, no network, and no live mailbox. That matters: the thing most
worth protecting here is the AC2 guard in `cmd_send`, and a test for it must
not itself depend on a mailbox existing.

What is covered:
  1. `send` REFUSES when inbound mail for the sender cannot be read.
     This is the send-only-alias trap RBR-759 exists to prevent.
  2. `send` PROCEEDS when IMAP login succeeds (the guard is not a blanket
     blocker).
  3. `--allow-unreadable-sender` overrides the guard deliberately.
  4. `probe` classifies "Lookup failed" as conclusive and "Invalid
     credentials" as indeterminate — never as proof a mailbox exists.
  5. A missing credential exits 2 and never falls back to a .env literal.

Usage: python3 scripts/test_compliance_mailbox.py
"""

from __future__ import annotations

import importlib.util
import os
import socket
import subprocess
import sys
import threading
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "compliance_mailbox.py"

PASS = "\033[32mPASS\033[0m" if sys.stdout.isatty() else "PASS"
FAIL = "\033[31mFAIL\033[0m" if sys.stdout.isatty() else "FAIL"

_results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = "") -> None:
    _results.append((ok, name, detail))
    print(f"  {PASS if ok else FAIL}  {name}")
    if not ok and detail:
        for line in detail.strip().splitlines():
            print(f"          {line}")


# ---------------------------------------------------------------------------
# Fake servers
# ---------------------------------------------------------------------------
class FakeServer(threading.Thread):
    """Minimal line-protocol server. Subclasses implement `handle`."""

    daemon = True

    def __init__(self) -> None:
        super().__init__()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(5)
        self.port = self.sock.getsockname()[1]
        self._stop = False

    def run(self) -> None:
        while not self._stop:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket) -> None:
        try:
            self.handle(conn)
        except Exception:
            pass
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def handle(self, conn: socket.socket) -> None:  # pragma: no cover
        raise NotImplementedError

    def shutdown(self) -> None:
        self._stop = True
        try:
            self.sock.close()
        except Exception:
            pass


class FakeIMAP(FakeServer):
    """Speaks just enough IMAP4 for imaplib's connect/login/list/logout."""

    def __init__(self, login_ok: bool = True, failure: str = "Lookup failed") -> None:
        super().__init__()
        self.login_ok = login_ok
        self.failure = failure
        self.login_attempts = 0

    def handle(self, conn: socket.socket) -> None:
        conn.sendall(b"* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] fake ready\r\n")
        buf = b""
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                return
            buf += chunk
            while b"\r\n" in buf:
                line, buf = buf.split(b"\r\n", 1)
                text = line.decode("utf-8", "replace")
                tag, _, rest = text.partition(" ")
                cmd = rest.split(" ", 1)[0].upper() if rest else ""

                if cmd == "CAPABILITY":
                    conn.sendall(b"* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n")
                    conn.sendall(f"{tag} OK done\r\n".encode())
                elif cmd == "LOGIN":
                    self.login_attempts += 1
                    if self.login_ok:
                        conn.sendall(f"{tag} OK logged in\r\n".encode())
                    else:
                        conn.sendall(f"{tag} NO {self.failure}\r\n".encode())
                elif cmd == "LIST":
                    conn.sendall(b'* LIST () "/" "INBOX"\r\n')
                    conn.sendall(f"{tag} OK done\r\n".encode())
                elif cmd == "LOGOUT":
                    conn.sendall(b"* BYE\r\n")
                    conn.sendall(f"{tag} OK logged out\r\n".encode())
                    return
                else:
                    conn.sendall(f"{tag} OK noop\r\n".encode())


class FakeSMTP(FakeServer):
    """Speaks just enough ESMTP for smtplib login + send_message."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def handle(self, conn: socket.socket) -> None:
        conn.sendall(b"220 fake ESMTP\r\n")
        buf = b""
        in_data = False
        body: list[str] = []
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                return
            buf += chunk
            while b"\r\n" in buf:
                line, buf = buf.split(b"\r\n", 1)
                text = line.decode("utf-8", "replace")

                if in_data:
                    if text == ".":
                        in_data = False
                        self.messages.append("\n".join(body))
                        body = []
                        conn.sendall(b"250 OK queued\r\n")
                    else:
                        body.append(text)
                    continue

                verb = text.split(" ", 1)[0].upper()
                if verb in ("EHLO", "HELO"):
                    conn.sendall(b"250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n")
                elif verb == "AUTH":
                    conn.sendall(b"235 accepted\r\n")
                elif verb in ("MAIL", "RCPT"):
                    conn.sendall(b"250 OK\r\n")
                elif verb == "DATA":
                    in_data = True
                    conn.sendall(b"354 send data\r\n")
                elif verb == "QUIT":
                    conn.sendall(b"221 bye\r\n")
                    return
                else:
                    conn.sendall(b"250 OK\r\n")


# ---------------------------------------------------------------------------
def run_cli(args: list[str], env_extra: dict[str, str], imap=None, smtp=None):
    env = dict(os.environ)
    for key in list(env):
        if key.startswith("COMPLIANCE_MAILBOX"):
            env.pop(key)
    env["COMPLIANCE_MAILBOX_PROFILE"] = "generic"
    env["COMPLIANCE_MAILBOX_IMAP_SECURITY"] = "plain"
    env["COMPLIANCE_MAILBOX_SMTP_SECURITY"] = "plain"
    if imap is not None:
        env["COMPLIANCE_MAILBOX_IMAP_HOST"] = "127.0.0.1"
        env["COMPLIANCE_MAILBOX_IMAP_PORT"] = str(imap.port)
    if smtp is not None:
        env["COMPLIANCE_MAILBOX_SMTP_HOST"] = "127.0.0.1"
        env["COMPLIANCE_MAILBOX_SMTP_PORT"] = str(smtp.port)
    env.update(env_extra)
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True, text=True, env=env, timeout=90, check=False,
    )


def load_target_module():
    """Import compliance_mailbox.py directly, for unit-level assertions."""
    spec = importlib.util.spec_from_file_location("cmb", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextmanager
def running(*servers: FakeServer):
    """Start the given fake servers, guarantee shutdown."""
    for s in servers:
        s.start()
    try:
        yield servers
    finally:
        for s in servers:
            s.shutdown()


def main() -> int:
    print("compliance_mailbox regression tests (RBR-759)\n")

    creds = {
        "COMPLIANCE_MAILBOX_ADDRESS": "security@aira.io",
        "COMPLIANCE_MAILBOX_PASSWORD": "fake-app-password",
    }

    # --- 1. the trap: unreadable sender must be refused --------------------
    print("AC2 guard — send must refuse an unreadable sender")
    imap, smtp = FakeIMAP(login_ok=False), FakeSMTP()
    with running(imap, smtp):
        r = run_cli(
            ["send", "--to", "proposals@a-lign.com", "--subject", "RFQ", "--body", "x"],
            creds, imap=imap, smtp=smtp,
        )
        check(r.returncode == 1, "exits 1", f"got {r.returncode}\n{r.stderr}")
        check("Refusing to send" in r.stderr, "explains the refusal", r.stderr)
        check(
            smtp.messages == [],
            "NO mail was transmitted",
            f"{len(smtp.messages)} message(s) leaked to SMTP",
        )

    # --- 2. guard must not block the working path --------------------------
    print("\nAC1 — send proceeds when inbound IS readable")
    imap, smtp = FakeIMAP(login_ok=True), FakeSMTP()
    with running(imap, smtp):
        r = run_cli(
            ["send", "--to", "proposals@a-lign.com", "--subject", "RFQ", "--body", "hello"],
            creds, imap=imap, smtp=smtp,
        )
        check(r.returncode == 0, "exits 0", f"got {r.returncode}\n{r.stderr}")
        check(len(smtp.messages) == 1, "exactly one message sent", f"{len(smtp.messages)} sent")
        check(imap.login_attempts >= 1, "guard actually probed IMAP")
        if smtp.messages:
            check("hello" in smtp.messages[0], "body transmitted")

    # --- 3. explicit override ---------------------------------------------
    print("\nOverride — --allow-unreadable-sender bypasses the guard")
    imap, smtp = FakeIMAP(login_ok=False), FakeSMTP()
    with running(imap, smtp):
        r = run_cli(
            ["send", "--to", "x@y.com", "--subject", "S", "--body", "b",
             "--allow-unreadable-sender"],
            creds, imap=imap, smtp=smtp,
        )
        check(r.returncode == 0, "exits 0", f"got {r.returncode}\n{r.stderr}")
        check(len(smtp.messages) == 1, "message sent despite unreadable inbox")

    # --- 4. missing credential --------------------------------------------
    # Use the google profile so hosts resolve; the credential check must be
    # what fails, not host resolution.
    print("\nAC3 — missing credential fails closed, never a .env literal")
    r = run_cli(
        ["selftest"],
        {
            "COMPLIANCE_MAILBOX_ADDRESS": "security@aira.io",
            "COMPLIANCE_MAILBOX_PROFILE": "google",
            "COMPLIANCE_MAILBOX_IMAP_SECURITY": "tls",
            "COMPLIANCE_MAILBOX_SMTP_SECURITY": "starttls",
        },
    )
    check(r.returncode == 2, "exits 2", f"got {r.returncode}\n{r.stderr}")
    check("secret_ref" in r.stderr, "names the secret_ref path", r.stderr)
    check(
        "Do NOT put the password in .env" in r.stderr,
        "warns against a .env literal",
        r.stderr,
    )

    # --- 5. probe classification ------------------------------------------
    print("\nProbe — 'Invalid credentials' must never read as proof of existence")
    cmb = load_target_module()

    lookup = FakeIMAP(login_ok=False, failure="Lookup failed")
    authfail = FakeIMAP(
        login_ok=False, failure="[AUTHENTICATIONFAILED] Invalid credentials (Failure)"
    )
    with running(lookup, authfail):
        a = cmb._probe_one("127.0.0.1", lookup.port, "security@aira.io", False)
        b = cmb._probe_one("127.0.0.1", authfail.port, "ben.hamilton@aira.io", False)
        check(a["state"] == cmb.PROBE_ALIAS_OR_GROUP,
              "'Lookup failed' -> alias_or_group", str(a))
        check(a["login_capable"] is False, "alias marked not login-capable")
        check(b["state"] == cmb.PROBE_INDETERMINATE,
              "'Invalid credentials' -> indeterminate", str(b))
        check(b["login_capable"] is None,
              "indeterminate does NOT claim login-capable", str(b))
        check("NOT proof of existence" in b["meaning"],
              "indeterminate result says so in-band")

    failed = [r for r in _results if not r[0]]
    print(f"\n{len(_results) - len(failed)}/{len(_results)} checks passed")
    if failed:
        print("FAILED:")
        for _, name, _d in failed:
            print(f"  - {name}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
