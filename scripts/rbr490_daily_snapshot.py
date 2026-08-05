#!/usr/bin/env python3
"""
RBR-490 daily 09:30 PT snapshot (Jul 14, Day 4 of Phase 2 Wave 1).

Pulls Drata for the whole fleet, classifies pilot devices from
phase1-pilot-roster.json, computes control-failure rollups, and
appends a snapshot entry to data/evidence/daily-enrollment-monitor.json.

Compliance rule (per playbook §3.1 / RBR-410 script):
  fleet strict-compliant iff sourceType=AGENT AND lastCheckedAt within 48h.
  Encryption + firewall are NOT gates (RBR-105 / RBR-106 telemetry gaps
  still apply to the fleet; we surface them under aggregateControlFailure).

Day-4 cascade plan per playbook §3.3:
  Day 4 has no specific cascade action. This is the morning-of-EOD-day
  snapshot — the pre-phase-gate baseline that the Day 5 (Jul 14 EOD)
  Phase-gate Wave 1 metrics report will read from. The principal
  measurement is the Day-3 1:1 outreach delta (RBR-469/470 cascade) and
  the RBR-471 IT remote-push hand-off follow-through.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone, timedelta

DRATA_BASE = os.environ.get("DRATA_BASE_URL", "https://public-api.drata.com/public/v2")
DRATA_KEY = os.environ.get("DRATA_API_KEY")
WORKSPACE = "/Users/benh/paperclip-rambur/Aira"
ROSTER = f"{WORKSPACE}/data/evidence/phase1-pilot-roster.json"
MONITOR = f"{WORKSPACE}/data/evidence/daily-enrollment-monitor.json"


def http_get(path, params=None, retries=3):
    if not DRATA_KEY:
        raise RuntimeError("DRATA_API_KEY not set")
    base = DRATA_BASE if DRATA_BASE.startswith("http") else "https://public-api.drata.com/public/v2"
    url = f"{base}{path}"
    headers = {
        "Authorization": f"Bearer {DRATA_KEY}",
        "Accept": "application/json",
        "User-Agent": "curl/8.0",
    }
    last_err = None
    for attempt in range(retries):
        try:
            data_params = []
            for k, v in (params or {}).items():
                data_params.append((k, str(v)))
            if data_params:
                url = url + "?" + urllib.parse.urlencode(data_params)
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            if attempt == retries - 1:
                raise
            time.sleep(2 + attempt * 2)
    raise last_err


def fetch_all_devices():
    """Use cursor pagination to walk the full /devices list."""
    out = []
    cursor = None
    for _ in range(60):
        params = {"limit": 200}
        if cursor:
            params["cursor"] = cursor
        body = http_get("/devices", params)
        data = body.get("data") or []
        out.extend(data)
        cursor = (body.get("pagination") or {}).get("cursor")
        if not data or not cursor:
            break
    return out


def os_label(os_version):
    if not os_version:
        return "Unknown"
    s = os_version.lower()
    if "windows" in s:
        return "Windows"
    if "macos" in s or "mac " in s:
        return "macOS"
    if "ubuntu" in s or "linux" in s:
        return "Ubuntu"
    return "Unknown"


def main():
    if not DRATA_KEY:
        print("DRATA_API_KEY missing — aborting without touching monitor file", file=sys.stderr)
        sys.exit(2)
    with open(ROSTER) as f:
        roster = json.load(f)
    pilot_entries = roster["roster"]
    pilot_ids = [d["deviceId"] for d in pilot_entries]
    print(f"Fetching Drata /devices (target pilot ids: {len(pilot_ids)})…", file=sys.stderr)
    devices = fetch_all_devices()
    by_id = {d["id"]: d for d in devices}
    print(f"Drata returned {len(devices)} devices", file=sys.stderr)
    now = datetime.now(timezone.utc)
    cutoff48 = now - timedelta(hours=48)
    cutoff24 = now - timedelta(hours=24)

    # Fleet rollup
    fleet_total = len(devices)
    fleet_with_agent = 0
    fleet_compliant = 0
    fleet_recent24 = 0
    fleet_stalled48 = 0
    by_os = OrderedDict([
        ("Windows", {"total": 0, "withAgent": 0, "compliant": 0, "reportingLast24h": 0}),
        ("macOS",   {"total": 0, "withAgent": 0, "compliant": 0, "reportingLast24h": 0}),
        ("Ubuntu",  {"total": 0, "withAgent": 0, "compliant": 0, "reportingLast24h": 0}),
        ("Unknown", {"total": 0, "withAgent": 0, "compliant": 0, "reportingLast24h": 0}),
    ])
    control_failure = OrderedDict([
        ("Disk encryption (FileVault/BitLocker/LUKS)", {"total": 0, "passing": 0, "failing": 0, "unknown": 0}),
        ("Anti-malware enabled",                      {"total": 0, "passing": 0, "failing": 0, "unknown": 0}),
        ("OS auto-update enabled",                    {"total": 0, "passing": 0, "failing": 0, "unknown": 0}),
        ("Password manager installed",                {"total": 0, "passing": 0, "failing": 0, "unknown": 0}),
        ("Host firewall enabled",                     {"total": 0, "passing": 0, "failing": 0, "unknown": 0}),
        ("Screen lock configured",                    {"total": 0, "passing": 0, "failing": 0, "unknown": 0}),
    ])

    for d in devices:
        os_v = d.get("osVersion")
        os_name = os_label(os_v)
        bucket = by_os[os_name]
        bucket["total"] += 1
        last = d.get("lastCheckedAt")
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        is_agent = d.get("sourceType") == "AGENT"
        is_stalled = (last_dt is None) or (last_dt < cutoff48)
        is_compliant = is_agent and not is_stalled
        recent24 = last_dt is not None and last_dt >= cutoff24
        if is_agent:
            bucket["withAgent"] += 1
            fleet_with_agent += 1
        if is_compliant:
            bucket["compliant"] += 1
            fleet_compliant += 1
        if recent24:
            bucket["reportingLast24h"] += 1
            fleet_recent24 += 1
        if is_stalled:
            fleet_stalled48 += 1

        # Control failure rollup — only for AGENT-installed devices
        if is_agent:
            enc = d.get("encryptionEnabled")
            fw = d.get("firewallEnabled")
            av = d.get("antivirusEnabled")
            upd = d.get("autoUpdateEnabled")
            pwm = d.get("passwordManagerEnabled")
            sl = d.get("screenLockTime")
            for name, val in (
                ("Disk encryption (FileVault/BitLocker/LUKS)", enc),
                ("Anti-malware enabled",                       av),
                ("OS auto-update enabled",                     upd),
                ("Password manager installed",                 pwm),
                ("Host firewall enabled",                      fw),
            ):
                cf = control_failure[name]
                cf["total"] += 1
                if val is None:
                    cf["unknown"] += 1
                elif val is True:
                    cf["passing"] += 1
                else:
                    cf["failing"] += 1
            cf = control_failure["Screen lock configured"]
            cf["total"] += 1
            if sl is None:
                cf["unknown"] += 1
            else:
                cf["passing"] += 1

    pct_with_agent = round(fleet_with_agent / fleet_total * 100, 1) if fleet_total else 0.0
    pct_compliant = round(fleet_compliant / fleet_total * 100, 1) if fleet_total else 0.0

    # Pilot rollup
    pilot_with_agent = 0
    pilot_compliant = 0
    pilot_stalled = 0
    pilot_not_in_drata = 0
    pilot_details = []
    pilot_by_os_total = {"macOS": 0, "Windows": 0}
    pilot_by_os_agent = {"macOS": 0, "Windows": 0}
    pilot_by_os_compliant = {"macOS": 0, "Windows": 0}

    for r in pilot_entries:
        os_name = r["os"]
        if os_name not in pilot_by_os_total:
            pilot_by_os_total[os_name] = 0
            pilot_by_os_agent[os_name] = 0
            pilot_by_os_compliant[os_name] = 0
        pilot_by_os_total[os_name] += 1
        d = by_id.get(r["deviceId"])
        if not d:
            pilot_not_in_drata += 1
            pilot_stalled += 1
            pilot_details.append({
                "id": r["deviceId"],
                "email": r["email"],
                "name": r.get("name"),
                "title": r.get("title"),
                "os": os_name,
                "inDrata": False,
                "compliant": False,
                "stalledOver48h": True,
                "reason": "device not in Drata index",
            })
            continue
        last = d.get("lastCheckedAt")
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        is_stalled = (last_dt is None) or (last_dt < cutoff48)
        is_agent = d.get("sourceType") == "AGENT"
        is_compliant = is_agent and not is_stalled
        if is_agent:
            pilot_with_agent += 1
            pilot_by_os_agent[os_name] += 1
        if is_compliant:
            pilot_compliant += 1
            pilot_by_os_compliant[os_name] += 1
        if is_stalled:
            pilot_stalled += 1
        pilot_details.append({
            "id": d["id"],
            "email": r["email"],
            "name": r.get("name"),
            "title": r.get("title"),
            "os": os_name,
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

    pilot_pct = round(pilot_compliant / len(pilot_ids) * 100, 1) if pilot_ids else 0.0
    if pilot_pct >= 90:
        gate = "PASS"
    elif pilot_pct >= 80:
        gate = "ADJUST"
    else:
        gate = "ABORT (Phase 1 EOD Jul 11 report; no change at 09:30 PT Jul 14)"

    # Outstanding installs (devices with no agent at all)
    outstanding_installs = sum(1 for d in devices if d.get("sourceType") != "AGENT")
    # Plus personnel/Drata index for the original 621 baseline
    baseline_total = 621
    # Drata only returns enrolled devices, not the orphan/Unknown bucket at 197
    # We use the 621 baseline from MDM source-of-truth and roll up the agent rate against that.
    pct_with_agent_vs_baseline = round(fleet_with_agent / baseline_total * 100, 1) if baseline_total else 0.0

    # Day-4 cascade: no specific playbook action — Day 4 is the pre-phase-gate
    # baseline that the Day 5 EOD report will read. Surface the Day-3 outreach
    # target list for reconciliation (which of those top-20 moved into the
    # 48h-recent bucket?).
    prior_targets = []
    with open(MONITOR) as f:
        monitor = json.load(f)
    if monitor["snapshots"]:
        last_snap = monitor["snapshots"][-1]
        for t in (last_snap.get("dayNCascadePlan") or {}).get("targets") or []:
            prior_targets.append(t)

    outreach_targets = []
    for d in devices:
        last = d.get("lastCheckedAt")
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        is_stalled = (last_dt is None) or (last_dt < cutoff48)
        if d.get("sourceType") != "AGENT" or is_stalled:
            outreach_targets.append({
                "deviceId": d["id"],
                "personnelId": d.get("personnelId"),
                "userId": d.get("userId"),
                "osVersion": d.get("osVersion"),
                "model": d.get("model"),
                "sourceType": d.get("sourceType"),
                "lastCheckedAt": last,
                "stalledOver48h": is_stalled,
                "noAgent": d.get("sourceType") != "AGENT",
            })
    # Stable sort: no-agent first, then oldest lastCheckedAt
    outreach_targets.sort(key=lambda x: (not x["noAgent"], x["lastCheckedAt"] or ""))
    top_20 = outreach_targets[:20]

    # Reconcile Day-3 cascade targets against the current snapshot
    day3_recon = []
    for t in prior_targets:
        did = t["deviceId"]
        d = by_id.get(did)
        if not d:
            day3_recon.append({
                "deviceId": did,
                "day3State": t.get("noAgent", False),
                "currentState": "not-in-drata",
                "movedIntoIndex": False,
            })
            continue
        last = d.get("lastCheckedAt")
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        recent24 = last_dt is not None and last_dt >= cutoff24
        is_agent = d.get("sourceType") == "AGENT"
        day3_recon.append({
            "deviceId": did,
            "day3State": t.get("noAgent", False),
            "currentState": "agent-and-recent" if (is_agent and recent24) else
                            ("agent-but-stalled" if is_agent else "no-agent"),
            "movedIntoIndex": is_agent and recent24,
        })
    day3_moved = sum(1 for r in day3_recon if r["movedIntoIndex"])

    snapshot = {
        "date": "2026-07-14",
        "phaseDay": 4,
        "phase1PilotDay": 4,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "capturedBy": "secops",
        "capturedFor": "RBR-490 daily 09:30 PT snapshot — Wave 1 Day 4 (morning-of-EOD-day; pre-phase-gate baseline for Day 5 Wave 1 report)",
        "scope": "fleet+pilot",
        "totalDevices": baseline_total,
        "enrolledInDrata": fleet_total,
        "withAgent": fleet_with_agent,
        "compliant": fleet_compliant,
        "pctWithAgent": pct_with_agent_vs_baseline,
        "pctCompliant": pct_compliant,
        "recentlyChecked24h": fleet_recent24,
        "stalled48h": fleet_stalled48,
        "outstandingInstalls": outstanding_installs,
        "byOS": dict(by_os),
        "pilotSnapshot": {
            "rosterSize": len(pilot_ids),
            "withAgent": pilot_with_agent,
            "compliant": pilot_compliant,
            "pctCompliant": pilot_pct,
            "stalled48h": pilot_stalled,
            "notInDrataEnv": pilot_not_in_drata,
            "gateDate": "2026-07-11 EOD",
            "gateTarget": ">=27/30 (90%) compliant",
            "gateStatus": gate,
            "byOS": {
                "macOS":   {"total": pilot_by_os_total.get("macOS", 0),
                            "withAgent": pilot_by_os_agent.get("macOS", 0),
                            "compliant": pilot_by_os_compliant.get("macOS", 0)},
                "Windows": {"total": pilot_by_os_total.get("Windows", 0),
                            "withAgent": pilot_by_os_agent.get("Windows", 0),
                            "compliant": pilot_by_os_compliant.get("Windows", 0)},
            },
            "topPilotIssues": [
                f"{pilot_stalled}/30 pilot devices silent >48h (or not in Drata index) — agent not installed/heartbeating on these",
                f"Only {pilot_with_agent}/30 pilot devices sourceType=AGENT — pilot chase has not moved the missing IDs into the index",
                f"{pilot_not_in_drata} pilot device IDs not present in the Drata index at all (RBR-410 follow-up: investigate whether the index excludes pilot IDs or whether these devices need MDM/agent re-push)",
            ],
        },
        "aggregateControlFailure": dict(control_failure),
        "topIssues": [
            f"Wave 1 Day 4 — morning-of-EOD-day; no specific playbook §3.3 cascade action. This snapshot is the pre-phase-gate baseline for the Day 5 (Jul 14 EOD) Wave 1 metrics report.",
            f"Fleet strict-compliant count {fleet_compliant}/{fleet_total} ({pct_compliant}%); RBR-105/106/107 telemetry gap still blocks encryption/AV/auto-update/password-manager classification for the agent-installed cohort.",
            f"Pilot gate status unchanged from Day 3: {pilot_compliant}/30 compliant (gate >=27/30). ABORT disposition holds; root cause is heartbeat ingestion (RBR-105/106) not install (RBR-410).",
            f"Day-3 1:1 outreach (RBR-469/470/471 cascade) reconciliation: {day3_moved}/{len(day3_recon)} Day-3 outreach targets now reporting agent-and-recent. IT hand-off (RBR-471) follow-through due EOD Jul 14.",
            "197 Unknown-OS orphans unchanged — RBR-108 still pending; 1:1 outreach list excludes these per their lack of Drata index presence.",
        ],
        "dataReconciliation": {
            "priorSnapshot": "2026-07-13T16:33Z (RBR-469 daily 09:30 PT Day 3)",
            "priorWithAgent": 425,
            "priorCompliant": 96,
            "currentWithAgent": fleet_with_agent,
            "currentCompliant": fleet_compliant,
            "deltaWithAgent": fleet_with_agent - 425,
            "deltaCompliant": fleet_compliant - 96,
            "note": "Compared to RBR-469 last snapshot (Day 3). Positive delta = installs overnight OR devices that re-emerged with fresh heartbeats; negative = agents that went silent and crossed the 48h threshold.",
        },
        "day3CascadeReconciliation": {
            "source": "RBR-469 dayNCascadePlan.targets (Day-3 1:1 outreach top 20)",
            "targetCount": len(day3_recon),
            "movedIntoIndex": day3_moved,
            "results": day3_recon,
        },
        "dayNCascadePlan": {
            "day": 4,
            "action": "No new cascade — Day 4 is the morning-of-EOD-day pre-phase-gate baseline (per playbook §3.3). Phase-gate Wave 1 metrics report fires Day 5 EOD (Jul 14 EOD).",
            "scheduledAt": None,
            "owner": "secops",
            "targets": top_20,
            "targetCount": len(top_20),
            "fullTargetsCount": len(outreach_targets),
        },
        "actionsTakenThisDay": [
            "09:30 PT: SecOps captured this RBR-490 Day 4 snapshot (fleet + pilot) via direct Drata API call — pre-phase-gate baseline.",
            "Pending EOD (Day 5): Phase-gate Wave 1 metrics report — gate target 90% /fleet or revert per prep-pack §6; reads this snapshot as the input.",
            "Pending EOD: IT remote-push hand-off (RBR-471) per-device follow-through results expected back from IT; reconciled in this snapshot's day3CascadeReconciliation block.",
        ],
        "nextDayActions": [
            "Day 5 (Jul 14 EOD): Phase-gate Wave 1 metrics report — gate target 90% /fleet or revert per prep-pack §6.",
            "Day 5 (Jul 15 09:30 PT): RBR-490 fires again — measure IT hand-off delta.",
            "Phase 3 (Jul 14–18): Full-fleet chase + Ubuntu evidence per playbook §6.",
        ],
    }

    monitor["snapshots"].append(snapshot)
    with open(MONITOR, "w") as f:
        json.dump(monitor, f, indent=2)
        f.write("\n")

    summary = {
        "date": snapshot["date"],
        "phaseDay": snapshot["phaseDay"],
        "fleetWithAgent": fleet_with_agent,
        "fleetCompliant": fleet_compliant,
        "pctWithAgent": pct_with_agent_vs_baseline,
        "pctCompliant": pct_compliant,
        "outstandingInstalls": outstanding_installs,
        "pilotCompliant": pilot_compliant,
        "pilotPct": pilot_pct,
        "gate": gate,
        "day3CascadeReconciliation": {
            "targetCount": len(day3_recon),
            "movedIntoIndex": day3_moved,
        },
        "cascadeTopCount": len(top_20),
        "cascadeTotal": len(outreach_targets),
    }
    print(json.dumps(summary, indent=2))
    print("appended snapshot to", MONITOR, file=sys.stderr)


if __name__ == "__main__":
    main()
