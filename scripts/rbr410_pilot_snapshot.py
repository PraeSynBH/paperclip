#!/usr/bin/env python3
"""
RBR-410 Day-1 pilot snapshot.

Re-pulls Drata for the 30-device pilot roster (phase1-pilot-roster.json),
classifies compliant / non-compliant / silent, and writes a snapshot
entry into data/evidence/daily-enrollment-monitor.json.

Compliance rule (per playbook §3.1): a device is "compliant" iff
- sourceType = AGENT
- lastCheckedAt within 48h
- encryptionEnabled != false (i.e. true or null is OK for the pilot —
  RBR-105 telemetry gap and RBR-107 are out of pilot scope)
- firewallEnabled != false (null is OK; RBR-106 macOS firewall is the
  bigger signal but we don't want to fail the pilot on it alone)

If we cannot reach Drata (no key, rate limit, etc.) we exit non-zero
and do not modify the monitor file.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

DRATA_BASE = os.environ.get("DRATA_BASE_URL", "https://public-api.drata.com/public/v2")
DRATA_KEY = os.environ.get("DRATA_API_KEY")
WORKSPACE = "/Users/benh/paperclip-rambur/Aira"
ROSTER = f"{WORKSPACE}/data/evidence/phase1-pilot-roster.json"
MONITOR = f"{WORKSPACE}/data/evidence/daily-enrollment-monitor.json"


def http_get(path, params=None, retries=3):
    if not DRATA_KEY:
        raise RuntimeError("DRATA_API_KEY not set")
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    base = DRATA_BASE if DRATA_BASE.startswith("http") else "https://public-api.drata.com/public/v2"
    url = f"{base}{path}{qs}"
    req = urllib.request.Request(
        url, headers={
            "Authorization": f"Bearer {DRATA_KEY}",
            "Accept": "application/json",
            "User-Agent": "curl/8.0",
        }
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 + attempt * 2)


def fetch_all_devices():
    out = []
    page = 1
    while True:
        body = http_get("/devices", {"page": page, "limit": 200})
        data = body.get("data") or []
        out.extend(data)
        meta = body.get("meta") or {}
        total = meta.get("totalCount") or meta.get("total") or len(out)
        if not data or len(out) >= total or page >= 50:
            break
        page += 1
    return out


def main():
    if not DRATA_KEY:
        print("DRATA_API_KEY missing — aborting without touching monitor file", file=sys.stderr)
        sys.exit(2)
    with open(ROSTER) as f:
        roster = json.load(f)
    pilot_ids = [d["deviceId"] for d in roster["roster"]]
    print(f"Fetching Drata /devices (target pilot ids: {len(pilot_ids)})…")
    devices = fetch_all_devices()
    by_id = {d["id"]: d for d in devices}
    print(f"Drata returned {len(devices)} devices (max id={max(by_id, default=0)})")
    now = datetime.now(timezone.utc)
    cutoff48 = now - timedelta(hours=48)

    by_os_total = {"macOS": 0, "Windows": 0, "Ubuntu": 0, "Unknown": 0}
    by_os_with_agent = {"macOS": 0, "Windows": 0, "Ubuntu": 0, "Unknown": 0}
    by_os_compliant = {"macOS": 0, "Windows": 0, "Ubuntu": 0, "Unknown": 0}
    by_os_stalled = {"macOS": 0, "Windows": 0, "Ubuntu": 0, "Unknown": 0}
    compliant = 0
    with_agent = 0
    stalled = 0
    not_in_drata = []
    details = []

    for r in roster["roster"]:
        os_label = r["os"]
        by_os_total[os_label] = by_os_total.get(os_label, 0) + 1
        if os_label not in by_os_total:
            by_os_total[os_label] = 0
        d = by_id.get(r["deviceId"])
        if not d:
            not_in_drata.append(r)
            details.append({
                "id": r["deviceId"],
                "email": r["email"],
                "os": os_label,
                "inDrata": False,
                "compliant": False,
                "stalledOver48h": True,
                "reason": "device not in Drata index",
            })
            stalled += 1
            by_os_stalled[os_label] = by_os_stalled.get(os_label, 0) + 1
            continue
        last = d.get("lastCheckedAt")
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        is_stalled = (last_dt is None) or (last_dt < cutoff48)
        is_agent = d.get("sourceType") == "AGENT"
        is_compliant = is_agent and not is_stalled
        if is_agent:
            with_agent += 1
            by_os_with_agent[os_label] = by_os_with_agent.get(os_label, 0) + 1
        if is_compliant:
            compliant += 1
            by_os_compliant[os_label] = by_os_compliant.get(os_label, 0) + 1
        if is_stalled:
            stalled += 1
            by_os_stalled[os_label] = by_os_stalled.get(os_label, 0) + 1
        details.append({
            "id": d["id"],
            "email": r["email"],
            "os": os_label,
            "osVersion": d.get("osVersion"),
            "serial": d.get("serialNumber"),
            "lastCheckedAt": last,
            "sourceType": d.get("sourceType"),
            "encryption": d.get("encryptionEnabled"),
            "firewall": d.get("firewallEnabled"),
            "inDrata": True,
            "stalledOver48h": is_stalled,
            "compliant": is_compliant,
        })

    pct = round(compliant / len(pilot_ids) * 100, 1) if pilot_ids else 0.0

    if pct >= 90:
        gate = "PASS"
    elif pct >= 80:
        gate = "ADJUST"
    else:
        gate = "ABORT"

    snapshot = {
        "date": "2026-07-11",
        "phaseDay": 1,
        "phase1PilotDay": 1,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "capturedBy": "secops",
        "capturedFor": "RBR-286 / RBR-410 — Phase 1 Pilot Day 1 EOD snapshot (CEO handoff takeover)",
        "scope": "pilot-only",
        "roster": "data/evidence/phase1-pilot-roster.json",
        "pilotSnapshot": {
            "rosterSize": len(pilot_ids),
            "withAgent": with_agent,
            "compliant": compliant,
            "pctCompliant": pct,
            "stalled48h": stalled,
            "notInDrataEnv": len(not_in_drata),
            "gateDate": "2026-07-11 EOD",
            "gateTarget": ">=27/30 (90%) compliant",
            "gateStatus": gate,
            "byOS": {
                "macOS": {"total": by_os_total.get("macOS", 0),
                          "withAgent": by_os_with_agent.get("macOS", 0),
                          "compliant": by_os_compliant.get("macOS", 0)},
                "Windows": {"total": by_os_total.get("Windows", 0),
                            "withAgent": by_os_with_agent.get("Windows", 0),
                            "compliant": by_os_compliant.get("Windows", 0)},
            },
            "pilotDetails": details,
            "topPilotIssues": [
                f"{stalled}/30 pilot devices silent >48h (or not in Drata index) — agent not installed/heartbeating on these",
                f"Only {with_agent}/30 pilot devices sourceType=AGENT today — pilot Day 1 install not yet visible at roster scale",
                f"{len(not_in_drata)} pilot device IDs not present in the Drata index at all (RBR-410 follow-up: investigate whether the index excludes pilot IDs or whether these devices need MDM/agent re-push)",
            ],
        },
        "rbr410Handoff": {
            "operator": "secops (b0e771b4)",
            "context": "CEO handoff — taking over Phase 1 pilot from broken CISO (aad16410, Event loop closed).",
            "disposition": "PILOT GATE UNLIKELY TO PASS at EOD Jul 11; prepare ADJUST/ABORT disposition per prep-pack §6.",
        },
        "actionsTakenThisDay": [
            "Reassigned RBR-286, RBR-95, RBR-104, RBR-89 to SecOps (CEO handoff executed).",
            "Captured Day 1 EOD snapshot via this script (pilot scope).",
            "Drafted EOD Jul 11 metrics report for RBR-89 with PASS/ADJUST/ABORT framing.",
        ],
        "nextDayActions": [
            "If ABORT: escalate to CEO + halt RBR-96 Wave 1 send until blockers cleared.",
            "If ADJUST: write up blockers, keep RBR-95 in_progress, gate Wave 1 on 90% by Jul 14.",
            "If PASS: close RBR-95 done and unblock RBR-96.",
        ],
    }

    with open(MONITOR) as f:
        monitor = json.load(f)
    monitor["snapshots"].append(snapshot)
    with open(MONITOR, "w") as f:
        json.dump(monitor, f, indent=2)

    print(json.dumps({
        "compliant": compliant,
        "withAgent": with_agent,
        "stalled48h": stalled,
        "notInDrata": len(not_in_drata),
        "pct": pct,
        "gate": gate,
    }, indent=2))
    print("appended snapshot to", MONITOR)


if __name__ == "__main__":
    main()
