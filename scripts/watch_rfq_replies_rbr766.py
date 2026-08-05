#!/usr/bin/env python3
"""RBR-766 — inbound watch for A-LIGN / Schellman RFQ replies.

Acceptance criterion 5: "Inbound watch active so replies wake an agent rather
than sitting unread."

Polls the dispatch mailbox over IMAP for mail from the two certification
bodies, and when something new arrives it wakes an agent by posting a comment
on RBR-398 through the Paperclip API. State is kept in a small JSON file so a
given message is only ever escalated once — re-running is safe and idempotent.

Run it as a cron job (recommended, survives process death):

    */30 * * * *  cd /path/to/Aira && python3 scripts/watch_rfq_replies_rbr766.py --once

Or one-shot for a manual check:

    python3 scripts/watch_rfq_replies_rbr766.py --once --dry-run

Credential handling is inherited from compliance_mailbox.py: the password is
resolved from COMPLIANCE_MAILBOX_PASSWORD (secret_ref injection), never from an
inline .env literal, and is never printed or written to state.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from compliance_mailbox import (  # noqa: E402
    MailboxError,
    _envelope,
    _search_uids,
    imap_connect,
    load_config,
)

ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT / "data" / "evidence" / "rbr-766-inbound-watch-state.json"

# RBR-398 — the issue the CEO owns and where dispatch/replies are tracked.
RBR_398_ID = "31bd3a42-07f2-4d78-abc7-6a03eccccb70"

# Senders that count as an RFQ reply. Matched as substrings of the From header.
WATCHED_DOMAINS = ("a-lign.com", "alignsecurity.com", "schellman.com")


def _load_state() -> dict:
    if STATE_PATH.is_file():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"seen_message_ids": [], "escalations": []}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def _api_base() -> str:
    base = (os.environ.get("PAPERCLIP_API_URL") or "").rstrip("/")
    if not base:
        return ""
    return base if base.endswith("/api") else base + "/api"


def wake_agent(subject: str, sender: str, uid: str, dry_run: bool) -> bool:
    """Post a comment on RBR-398 so an agent is woken to handle the reply."""
    body = (
        f"## Certification body reply received — {sender}\n\n"
        f"The inbound watch on the dispatch mailbox picked up a new message.\n\n"
        f"- **From:** {sender}\n"
        f"- **Subject:** {subject}\n"
        f"- **IMAP UID:** {uid}\n"
        f"- **Detected:** {datetime.now(timezone.utc).isoformat()}\n\n"
        f"Read the full message with:\n\n"
        f"```bash\npython3 scripts/compliance_mailbox.py read --uid {uid} --json\n```\n\n"
        f"This is an RFQ response on the ISO 27001 critical path — the Aug 12 "
        f"proposal deadline depends on it. Please triage rather than leave it unread."
    )

    if dry_run:
        print("[dry-run] would post to RBR-398:")
        print(body)
        return True

    base, key = _api_base(), os.environ.get("PAPERCLIP_API_KEY")
    if not base or not key:
        print("[warn] PAPERCLIP_API_URL/PAPERCLIP_API_KEY unset — cannot wake an agent.",
              file=sys.stderr)
        return False

    req = urllib.request.Request(
        f"{base}/issues/{RBR_398_ID}/comments",
        data=json.dumps({"body": body}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "X-Paperclip-Run-Id": os.environ.get("PAPERCLIP_RUN_ID", ""),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as exc:
        print(f"[warn] wake failed: HTTP {exc.code} {exc.read()[:200]!r}", file=sys.stderr)
    except OSError as exc:
        print(f"[warn] wake failed: {exc}", file=sys.stderr)
    return False


def check_once(cfg: dict, state: dict, dry_run: bool) -> dict:
    """One poll. Returns a summary dict; mutates state in place."""
    seen = set(state.get("seen_message_ids", []))
    new_hits, checked = [], 0

    conn = imap_connect(cfg)
    try:
        uids = _search_uids(conn, "INBOX", None)
        # Only the recent tail — replies arrive after dispatch, not before.
        for uid in reversed(uids[-200:]):
            env = _envelope(conn, uid)
            checked += 1
            sender = (env.get("from") or "").lower()
            if not any(d in sender for d in WATCHED_DOMAINS):
                continue
            mid = env.get("message_id") or f"uid:{env.get('uid')}"
            if mid in seen:
                continue
            new_hits.append(env)
            seen.add(mid)
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    woken = 0
    for env in new_hits:
        if wake_agent(env.get("subject", ""), env.get("from", ""), env.get("uid", ""), dry_run):
            woken += 1
            state.setdefault("escalations", []).append({
                "message_id": env.get("message_id"),
                "from": env.get("from"),
                "subject": env.get("subject"),
                "uid": env.get("uid"),
                "woken_at": datetime.now(timezone.utc).isoformat(),
            })

    state["seen_message_ids"] = sorted(seen)
    state["last_checked_at"] = datetime.now(timezone.utc).isoformat()
    state["mailbox"] = cfg["address"]

    return {
        "ok": True,
        "checked_at": state["last_checked_at"],
        "mailbox": cfg["address"],
        "envelopes_examined": checked,
        "new_replies": len(new_hits),
        "agents_woken": woken,
        "watched_domains": list(WATCHED_DOMAINS),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Watch for A-LIGN / Schellman RFQ replies.")
    ap.add_argument("--once", action="store_true",
                    help="Single poll then exit (the cron-friendly mode).")
    ap.add_argument("--interval", type=int, default=1800,
                    help="Seconds between polls in loop mode (default 1800).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Detect and report, but do not post to the issue.")
    args = ap.parse_args()

    try:
        cfg = load_config()
    except MailboxError as exc:
        print(f"[config error] {exc}", file=sys.stderr)
        return 2

    state = _load_state()
    while True:
        try:
            summary = check_once(cfg, state, args.dry_run)
            _save_state(state)
            print(json.dumps(summary, indent=2))
        except MailboxError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
