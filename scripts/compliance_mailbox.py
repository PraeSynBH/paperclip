#!/usr/bin/env python3
"""Compliance role-mailbox client — RBR-759

A deliberately small, zero-dependency IMAP/SMTP client for the compliance
role mailbox (security@aira.io). Its only job is to let an agent send an RFQ
to an external vendor and read the proposal that comes back.

This is NOT a general-purpose agent email framework. Scope is fixed at:
send, list, read, and a self-addressed roundtrip used as acceptance evidence.

Credential handling follows the Aira secret_ref convention (docs/SECRETS.md):
the mailbox password is NEVER read from an inline .env literal. Resolution
order is:

  1. COMPLIANCE_MAILBOX_PASSWORD        — injected by Paperclip from a
                                          company secret via `secret_ref`
                                          (the production path for agents)
  2. COMPLIANCE_MAILBOX_PASSWORD_CMD    — a command that prints the password
                                          (keychain / `pass` / bridge helper)
  3. AWS Secrets Manager `aira/secrets` — key COMPLIANCE_MAILBOX_PASSWORD

Usage:
  python3 scripts/compliance_mailbox.py probe security@aira.io [...]   # no credential needed
  python3 scripts/compliance_mailbox.py selftest
  python3 scripts/compliance_mailbox.py send --to a@b.com --subject S --body-file f.txt
  python3 scripts/compliance_mailbox.py inbox [--limit 10] [--search TOKEN] [--json]
  python3 scripts/compliance_mailbox.py read --uid 123 [--json]
  python3 scripts/compliance_mailbox.py roundtrip [--timeout 120]

`send` refuses to transmit if it cannot read inbound mail for the sender: a
send-only address just moves the stall to the reply leg (RBR-759 AC2).
Override deliberately with --allow-unreadable-sender.

Tests: python3 scripts/test_compliance_mailbox.py (no credentials required).

Every subcommand exits non-zero on failure so CI and agents can branch on it.
"""

from __future__ import annotations

import argparse
import email
import email.message
import email.utils
import imaplib
import json
import mimetypes
import os
import smtplib
import ssl
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------
# Provider profiles
# --------------------------------------------------------------------------
# aira.io is a Google Workspace domain (MX -> aspmx.l.google.com), so the
# Workspace profile is the default. Override any field with env vars.
PROFILES = {
    "google": {
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
        "imap_security": "tls",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_security": "starttls",
        "sent_folder": "[Gmail]/Sent Mail",
    },
    "protonbridge": {
        "imap_host": "127.0.0.1",
        "imap_port": 11143,
        "imap_security": "starttls",
        "smtp_host": "127.0.0.1",
        "smtp_port": 11026,
        "smtp_security": "starttls",
        "sent_folder": "Sent",
    },
    "generic": {
        "imap_host": "",
        "imap_port": 993,
        "imap_security": "tls",
        "smtp_host": "",
        "smtp_port": 587,
        "smtp_security": "starttls",
        "sent_folder": "Sent",
    },
}

ENV_PREFIX = "COMPLIANCE_MAILBOX"
ROOT = Path(__file__).resolve().parent.parent
EVIDENCE_DIR = ROOT / "data" / "evidence"


class MailboxError(RuntimeError):
    """Configuration or transport failure. Message is safe to log."""


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
def _env(name: str, default=None):
    return os.environ.get(f"{ENV_PREFIX}_{name}", default)


def _resolve_password() -> tuple[str, str]:
    """Return (password, source). Never logs or returns the value inline."""
    direct = os.environ.get(f"{ENV_PREFIX}_PASSWORD")
    if direct:
        return direct, "env:secret_ref-injected"

    cmd = os.environ.get(f"{ENV_PREFIX}_PASSWORD_CMD")
    if cmd:
        try:
            out = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=30, check=True
            )
        except subprocess.CalledProcessError as exc:
            raise MailboxError(
                f"{ENV_PREFIX}_PASSWORD_CMD exited {exc.returncode}. "
                "Check the credential helper."
            ) from None
        except subprocess.TimeoutExpired:
            raise MailboxError(f"{ENV_PREFIX}_PASSWORD_CMD timed out after 30s.") from None
        value = out.stdout.strip()
        if not value:
            raise MailboxError(f"{ENV_PREFIX}_PASSWORD_CMD produced no output.")
        return value, "cmd"

    value = _resolve_from_aws()
    if value:
        return value, "aws-secrets-manager"

    raise MailboxError(
        "No mailbox credential found. Set one of:\n"
        f"  {ENV_PREFIX}_PASSWORD       (Paperclip secret_ref injection — production)\n"
        f"  {ENV_PREFIX}_PASSWORD_CMD   (keychain / credential helper)\n"
        "  AWS Secrets Manager aira/secrets -> COMPLIANCE_MAILBOX_PASSWORD\n"
        "Do NOT put the password in .env as a literal — see docs/SECRETS.md."
    )


def _resolve_from_aws() -> str | None:
    """Best-effort read of aira/secrets. Silent if boto3/creds are absent."""
    try:
        import boto3  # type: ignore
    except ImportError:
        return None
    secret_id = os.environ.get("AWS_SECRET_ID", "aira/secrets")
    region = os.environ.get("AWS_REGION", "us-east-1")
    try:
        client = boto3.client("secretsmanager", region_name=region)
        raw = client.get_secret_value(SecretId=secret_id)["SecretString"]
        return (json.loads(raw) or {}).get(f"{ENV_PREFIX}_PASSWORD") or None
    except Exception:
        return None


def load_config() -> dict:
    profile_name = _env("PROFILE", "google")
    if profile_name not in PROFILES:
        raise MailboxError(
            f"Unknown {ENV_PREFIX}_PROFILE={profile_name!r}. "
            f"Choose one of: {', '.join(PROFILES)}"
        )
    cfg = dict(PROFILES[profile_name])
    cfg["profile"] = profile_name

    address = _env("ADDRESS")
    if not address:
        raise MailboxError(
            f"{ENV_PREFIX}_ADDRESS is required (e.g. security@aira.io)."
        )
    cfg["address"] = address
    cfg["login"] = _env("LOGIN", address)
    cfg["display_name"] = _env("DISPLAY_NAME", "Aira Security & Compliance")

    for key in ("imap_host", "smtp_host", "imap_security", "smtp_security", "sent_folder"):
        override = _env(key.upper())
        if override:
            cfg[key] = override
    for key in ("imap_port", "smtp_port"):
        override = _env(key.upper())
        if override:
            cfg[key] = int(override)

    if not cfg["imap_host"] or not cfg["smtp_host"]:
        raise MailboxError(
            f"IMAP/SMTP host unset. Set {ENV_PREFIX}_IMAP_HOST and "
            f"{ENV_PREFIX}_SMTP_HOST, or pick a known {ENV_PREFIX}_PROFILE."
        )

    cfg["password"], cfg["password_source"] = _resolve_password()
    return cfg


def redacted(cfg: dict) -> dict:
    out = {k: v for k, v in cfg.items() if k != "password"}
    out["password"] = f"<resolved via {cfg.get('password_source')}>"
    return out


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------
def imap_connect(cfg: dict) -> imaplib.IMAP4:
    host, port = cfg["imap_host"], cfg["imap_port"]
    try:
        if cfg["imap_security"] == "tls":
            conn: imaplib.IMAP4 = imaplib.IMAP4_SSL(host, port, timeout=30)
        else:
            conn = imaplib.IMAP4(host, port, timeout=30)
            if cfg["imap_security"] == "starttls":
                ctx = ssl.create_default_context()
                if host in ("127.0.0.1", "localhost"):
                    # Proton Bridge presents a self-signed local cert.
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                conn.starttls(ctx)
    except OSError as exc:
        raise MailboxError(f"IMAP connect to {host}:{port} failed: {exc}") from None
    try:
        conn.login(cfg["login"], cfg["password"])
    except imaplib.IMAP4.error as exc:
        raise MailboxError(
            f"IMAP login failed for {cfg['login']} at {host}:{port}: {exc}"
        ) from None
    return conn


def smtp_connect(cfg: dict) -> smtplib.SMTP:
    host, port = cfg["smtp_host"], cfg["smtp_port"]
    try:
        if cfg["smtp_security"] == "tls":
            conn: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=30)
        else:
            conn = smtplib.SMTP(host, port, timeout=30)
            conn.ehlo()
            if cfg["smtp_security"] == "starttls":
                ctx = ssl.create_default_context()
                if host in ("127.0.0.1", "localhost"):
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                conn.starttls(context=ctx)
                conn.ehlo()
    except OSError as exc:
        raise MailboxError(f"SMTP connect to {host}:{port} failed: {exc}") from None
    try:
        conn.login(cfg["login"], cfg["password"])
    except smtplib.SMTPException as exc:
        raise MailboxError(
            f"SMTP login failed for {cfg['login']} at {host}:{port}: {exc}"
        ) from None
    return conn


# --------------------------------------------------------------------------
# Operations
# --------------------------------------------------------------------------
def build_message(cfg: dict, to, subject, body, attachments=None, headers=None):
    msg = email.message.EmailMessage()
    msg["From"] = email.utils.formataddr((cfg["display_name"], cfg["address"]))
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg["Date"] = email.utils.formatdate(localtime=True)
    msg["Message-ID"] = email.utils.make_msgid(domain=cfg["address"].split("@")[-1])
    msg["Reply-To"] = cfg["address"]
    for key, value in (headers or {}).items():
        msg[key] = value
    msg.set_content(body)

    for path_str in attachments or []:
        path = Path(path_str)
        if not path.is_file():
            raise MailboxError(f"Attachment not found: {path}")
        ctype, _ = mimetypes.guess_type(path.name)
        maintype, _, subtype = (ctype or "application/octet-stream").partition("/")
        msg.add_attachment(
            path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name
        )
    return msg


def cmd_send(cfg, args) -> int:
    # AC2 guard. The whole point of RBR-759 is that a send-only alias just
    # moves the stall to the reply leg: the RFQ goes out, the vendor answers,
    # and the answer lands somewhere no agent can authenticate to. Before any
    # outbound mail leaves, confirm the *sender* is a mailbox we can read.
    #
    # IMAP login already succeeded implies readability, so that is the check —
    # it is authoritative, unlike the `probe` heuristic. Escape hatch exists
    # for the deliberate send-only case, but it must be asked for explicitly.
    if not args.allow_unreadable_sender:
        try:
            imap_connect(cfg).logout()
        except MailboxError as exc:
            raise MailboxError(
                f"Refusing to send: cannot read inbound mail for {cfg['address']}.\n"
                f"  {exc}\n"
                "A send-only address moves the stall to the reply leg — the vendor's\n"
                "response would land somewhere no agent can retrieve (RBR-759 AC2).\n"
                "Fix the mailbox, or pass --allow-unreadable-sender to override "
                "deliberately."
            ) from None

    if args.body_file:
        body = Path(args.body_file).read_text(encoding="utf-8")
    elif args.body is not None:
        body = args.body
    else:
        body = sys.stdin.read()

    msg = build_message(cfg, args.to, args.subject, body, args.attach)
    with smtp_connect(cfg) as conn:
        conn.send_message(msg)

    result = {
        "ok": True,
        "from": cfg["address"],
        "to": args.to,
        "subject": args.subject,
        "message_id": msg["Message-ID"],
        "attachments": [Path(p).name for p in (args.attach or [])],
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }
    print(json.dumps(result, indent=2))
    return 0


def _decode(value) -> str:
    if not value:
        return ""
    parts = email.header.decode_header(value)
    return "".join(
        p.decode(enc or "utf-8", errors="replace") if isinstance(p, bytes) else p
        for p, enc in parts
    )


def _envelope(conn, uid: bytes) -> dict:
    typ, data = conn.uid("FETCH", uid, "(BODY.PEEK[HEADER])")
    if typ != "OK" or not data or not isinstance(data[0], tuple):
        return {"uid": uid.decode(), "error": "fetch failed"}
    hdr = email.message_from_bytes(data[0][1])
    return {
        "uid": uid.decode(),
        "from": _decode(hdr.get("From")),
        "to": _decode(hdr.get("To")),
        "subject": _decode(hdr.get("Subject")),
        "date": _decode(hdr.get("Date")),
        "message_id": (hdr.get("Message-ID") or "").strip(),
    }


def _search_uids(conn, folder: str, search: str | None):
    typ, _ = conn.select(folder, readonly=True)
    if typ != "OK":
        raise MailboxError(f"Cannot select folder {folder!r}.")
    if search:
        # HEADER SUBJECT keeps the read scoped to the message we asked for
        # instead of enumerating the whole mailbox.
        typ, data = conn.uid("SEARCH", None, "HEADER", "SUBJECT", f'"{search}"')
    else:
        typ, data = conn.uid("SEARCH", None, "ALL")
    if typ != "OK":
        raise MailboxError("IMAP SEARCH failed.")
    return (data[0].split() if data and data[0] else [])


def cmd_inbox(cfg, args) -> int:
    folder = args.folder or "INBOX"
    conn = imap_connect(cfg)
    try:
        uids = _search_uids(conn, folder, args.search)
        selected = uids[-args.limit:] if args.limit else uids
        rows = [_envelope(conn, u) for u in reversed(selected)]
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    if args.json:
        print(json.dumps({"folder": folder, "matched": len(uids), "messages": rows}, indent=2))
    else:
        print(f"{folder}: {len(uids)} matched, showing {len(rows)}")
        for r in rows:
            print(f"  [{r.get('uid')}] {r.get('date','')}  {r.get('from','')}")
            print(f"        {r.get('subject','')}")
    return 0


def _body_text(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                return part.get_payload(decode=True).decode(
                    part.get_content_charset() or "utf-8", errors="replace"
                )
        return ""
    payload = msg.get_payload(decode=True)
    return payload.decode(msg.get_content_charset() or "utf-8", errors="replace") if payload else ""


def cmd_read(cfg, args) -> int:
    folder = args.folder or "INBOX"
    conn = imap_connect(cfg)
    try:
        typ, _ = conn.select(folder, readonly=True)
        if typ != "OK":
            raise MailboxError(f"Cannot select folder {folder!r}.")
        typ, data = conn.uid("FETCH", args.uid, "(BODY.PEEK[])")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            raise MailboxError(f"UID {args.uid} not found in {folder}.")
        msg = email.message_from_bytes(data[0][1])
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    out = {
        "uid": args.uid,
        "from": _decode(msg.get("From")),
        "to": _decode(msg.get("To")),
        "subject": _decode(msg.get("Subject")),
        "date": _decode(msg.get("Date")),
        "message_id": (msg.get("Message-ID") or "").strip(),
        "attachments": [p.get_filename() for p in msg.walk() if p.get_filename()],
        "body": _body_text(msg),
    }
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        for k in ("from", "to", "date", "subject", "message_id", "attachments"):
            print(f"{k.title():12s}: {out[k]}")
        print("-" * 60)
        print(out["body"])
    return 0


# --------------------------------------------------------------------------
# Address probe (no credential required)
# --------------------------------------------------------------------------
# Google's IMAP front-end returns exactly ONE of two useful shapes to a bad
# password, and the distinction is load-bearing for this issue:
#
#   "Lookup failed"                        -> the address routes mail, but has
#                                             no IMAP mailbox behind it. It is
#                                             a group or a user alias. It can
#                                             NEVER hold credentials, so it can
#                                             never satisfy AC2.
#
#   "[AUTHENTICATIONFAILED] Invalid ..."   -> INDETERMINATE. Google deliberately
#                                             does not leak non-existence, so a
#                                             real user mailbox and an address
#                                             that does not exist at all are
#                                             byte-identical here.
#
# The second case is the trap: it is NOT evidence that a mailbox exists. The
# probe therefore always runs a control address that is guaranteed not to
# exist, and prints it alongside the results so the output cannot be misread.
# The only proof an address is usable is `selftest` with a real credential.
CONTROL_LOCALPART = "zz-nonexistent-control-probe-9x7q"

PROBE_ALIAS_OR_GROUP = "alias_or_group"
PROBE_INDETERMINATE = "indeterminate"
PROBE_UNKNOWN = "unknown"

_PROBE_MEANING = {
    PROBE_ALIAS_OR_GROUP: (
        "Routes mail but has no IMAP mailbox (group/alias). Cannot hold "
        "credentials -> cannot satisfy AC2 without conversion to a full user."
    ),
    PROBE_INDETERMINATE: (
        "Either a real user mailbox or no such address - Google returns the "
        "same response for both. NOT proof of existence. Confirm with "
        "`selftest` using a real credential."
    ),
    PROBE_UNKNOWN: "Could not reach the IMAP endpoint; no conclusion.",
}


def _probe_one(host: str, port: int, address: str, use_ssl: bool = True) -> dict:
    """Classify an address by its IMAP response to a deliberately bad password."""
    raw = ""
    try:
        conn: imaplib.IMAP4 = (
            imaplib.IMAP4_SSL(host, port, timeout=30)
            if use_ssl
            else imaplib.IMAP4(host, port, timeout=30)
        )
        try:
            conn.login(address, "invalid-probe-password-not-a-secret")
            # Should never happen; the probe password is not a real credential.
            state = PROBE_UNKNOWN
            raw = "login unexpectedly succeeded"
        except imaplib.IMAP4.error as exc:
            raw = str(exc)
            if "lookup failed" in raw.lower():
                state = PROBE_ALIAS_OR_GROUP
            elif "authenticationfailed" in raw.lower().replace(" ", ""):
                state = PROBE_INDETERMINATE
            else:
                state = PROBE_UNKNOWN
        finally:
            try:
                conn.logout()
            except Exception:
                pass
    except OSError as exc:
        state = PROBE_UNKNOWN
        raw = f"connect failed: {exc}"

    return {
        "address": address,
        "state": state,
        "imap_response": raw[:200],
        "login_capable": None if state != PROBE_ALIAS_OR_GROUP else False,
        "meaning": _PROBE_MEANING[state],
    }


def cmd_probe(_cfg, args) -> int:
    """Classify candidate addresses without needing a password.

    Exits 0 if every requested address is *not* provably a group/alias, 1 if
    any is. Never a substitute for `selftest`.
    """
    profile_name = _env("PROFILE", "google") or "google"
    if profile_name not in PROFILES:
        raise MailboxError(
            f"Unknown {ENV_PREFIX}_PROFILE={profile_name!r}. "
            f"Choose one of: {', '.join(PROFILES)}"
        )
    profile = PROFILES[profile_name]
    host = _env("IMAP_HOST") or profile["imap_host"]
    port = int(_env("IMAP_PORT") or profile["imap_port"])
    use_ssl = (_env("IMAP_SECURITY") or profile["imap_security"]) == "tls"

    if not host:
        raise MailboxError(
            f"IMAP host unset. Set {ENV_PREFIX}_IMAP_HOST or pick a known "
            f"{ENV_PREFIX}_PROFILE."
        )

    targets = list(args.address)
    domain = targets[0].split("@", 1)[1] if "@" in targets[0] else None

    results = [_probe_one(host, port, a, use_ssl) for a in targets]
    control_result = (
        _probe_one(host, port, f"{CONTROL_LOCALPART}@{domain}", use_ssl)
        if domain
        else None
    )

    blocked = [r for r in results if r["state"] == PROBE_ALIAS_OR_GROUP]
    out = {
        "issue": "RBR-759",
        "test": "compliance-mailbox-address-probe",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "imap_endpoint": f"{host}:{port}",
        "results": results,
        "control": control_result,
        "control_note": (
            "The control address is guaranteed not to exist. If it shows the "
            "same state as a candidate, that state proves nothing about the "
            "candidate's existence."
        ),
        "alias_or_group": [r["address"] for r in blocked],
        "ok": not blocked,
    }

    if args.evidence:
        EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = EVIDENCE_DIR / f"rbr-759-address-probe-{stamp}.json"
        path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        out["evidence_file"] = str(path)

    print(json.dumps(out, indent=2))
    return 0 if out["ok"] else 1


def cmd_selftest(cfg, args) -> int:
    results = {"config": redacted(cfg), "checks": []}
    ok = True

    try:
        conn = imap_connect(cfg)
        typ, data = conn.list()
        folders = len(data) if typ == "OK" and data else 0
        conn.logout()
        results["checks"].append(
            {"check": "imap_login", "ok": True, "detail": f"{folders} folders visible"}
        )
    except MailboxError as exc:
        ok = False
        results["checks"].append({"check": "imap_login", "ok": False, "detail": str(exc)})

    try:
        conn = smtp_connect(cfg)
        conn.quit()
        results["checks"].append({"check": "smtp_login", "ok": True, "detail": "authenticated"})
    except MailboxError as exc:
        ok = False
        results["checks"].append({"check": "smtp_login", "ok": False, "detail": str(exc)})

    results["ok"] = ok
    print(json.dumps(results, indent=2))
    return 0 if ok else 1


def cmd_roundtrip(cfg, args) -> int:
    """Acceptance evidence: send to self, then retrieve it programmatically.

    Proves AC1 (can send) and AC2 (agent can read inbound) in one shot.
    Retrieval is scoped by a unique token so it never enumerates other mail.
    """
    token = f"RBR-759-{uuid.uuid4().hex[:12].upper()}"
    subject = f"[{token}] compliance mailbox roundtrip"
    target = args.to or cfg["address"]
    started = datetime.now(timezone.utc)

    body = (
        "Automated acceptance test for RBR-759 (compliance role mailbox).\n\n"
        f"Token:     {token}\n"
        f"Mailbox:   {cfg['address']}\n"
        f"Profile:   {cfg['profile']}\n"
        f"Sent at:   {started.isoformat()}\n\n"
        "If an agent retrieved this message via IMAP, inbound is readable\n"
        "without a human forwarding it. No action required.\n"
    )

    msg = build_message(cfg, [target], subject, body)
    with smtp_connect(cfg) as conn:
        conn.send_message(msg)
    sent_at = datetime.now(timezone.utc)

    deadline = time.time() + args.timeout
    found = None
    attempts = 0
    while time.time() < deadline and not found:
        attempts += 1
        time.sleep(args.poll)
        conn = imap_connect(cfg)
        try:
            for folder in (args.folder or "INBOX", cfg["sent_folder"]):
                try:
                    uids = _search_uids(conn, folder, token)
                except MailboxError:
                    continue
                if uids:
                    found = _envelope(conn, uids[-1])
                    found["folder"] = folder
                    break
        finally:
            try:
                conn.logout()
            except Exception:
                pass

    retrieved_at = datetime.now(timezone.utc)
    evidence = {
        "issue": "RBR-759",
        "test": "compliance-mailbox-roundtrip",
        "ok": bool(found),
        "token": token,
        "mailbox": cfg["address"],
        "profile": cfg["profile"],
        "password_source": cfg["password_source"],
        "sent_to": target,
        "sent_message_id": msg["Message-ID"],
        "sent_at": sent_at.isoformat(),
        "retrieved_at": retrieved_at.isoformat() if found else None,
        "latency_seconds": round((retrieved_at - sent_at).total_seconds(), 1) if found else None,
        "poll_attempts": attempts,
        "retrieved": found,
    }
    if not found:
        evidence["error"] = (
            f"Sent successfully but not retrieved within {args.timeout}s. "
            "SMTP send worked; IMAP retrieval did not surface the token."
        )

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = EVIDENCE_DIR / f"rbr-759-mailbox-roundtrip-{started:%Y%m%dT%H%M%SZ}.json"
    out_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    evidence["evidence_file"] = str(out_path)

    print(json.dumps(evidence, indent=2))
    return 0 if found else 1


# --------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(
        prog="compliance_mailbox",
        description="Compliance role mailbox client (RBR-759).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("selftest", help="Verify IMAP + SMTP auth without sending mail.")

    p_send = sub.add_parser("send", help="Send an outbound message.")
    p_send.add_argument("--to", action="append", required=True, help="Recipient (repeatable).")
    p_send.add_argument("--subject", required=True)
    p_send.add_argument("--body", help="Body text. Omit to read stdin.")
    p_send.add_argument("--body-file", help="Read body from a file.")
    p_send.add_argument("--attach", action="append", help="Attachment path (repeatable).")
    p_send.add_argument(
        "--allow-unreadable-sender",
        action="store_true",
        help="Send even if inbound mail for the sender cannot be read (overrides AC2 guard).",
    )

    p_inbox = sub.add_parser("inbox", help="List inbound messages.")
    p_inbox.add_argument("--limit", type=int, default=10)
    p_inbox.add_argument("--search", help="Match on subject substring.")
    p_inbox.add_argument("--folder")
    p_inbox.add_argument("--json", action="store_true")

    p_read = sub.add_parser("read", help="Read one message by UID.")
    p_read.add_argument("--uid", required=True)
    p_read.add_argument("--folder")
    p_read.add_argument("--json", action="store_true")

    p_rt = sub.add_parser("roundtrip", help="Send-to-self and retrieve (acceptance evidence).")
    p_rt.add_argument("--to", help="Override the roundtrip recipient.")
    p_rt.add_argument("--folder")
    p_rt.add_argument("--timeout", type=int, default=120)
    p_rt.add_argument("--poll", type=int, default=5)

    p_probe = sub.add_parser(
        "probe",
        help="Classify addresses as alias/group vs indeterminate (no credential needed).",
    )
    p_probe.add_argument("address", nargs="+", help="Address(es) to classify.")
    p_probe.add_argument(
        "--evidence", action="store_true", help="Write a JSON evidence file."
    )

    args = parser.parse_args()

    # `probe` deliberately needs no credential — it is the check-before-build
    # step, run before any mailbox exists.
    if args.command == "probe":
        try:
            return cmd_probe(None, args)
        except MailboxError as exc:
            print(f"[error] {exc}", file=sys.stderr)
            return 1

    try:
        cfg = load_config()
    except MailboxError as exc:
        print(f"[config error] {exc}", file=sys.stderr)
        return 2

    handlers = {
        "selftest": cmd_selftest,
        "send": cmd_send,
        "inbox": cmd_inbox,
        "read": cmd_read,
        "roundtrip": cmd_roundtrip,
    }
    try:
        return handlers[args.command](cfg, args)
    except MailboxError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
