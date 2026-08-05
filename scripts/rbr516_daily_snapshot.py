#!/usr/bin/env python3
"""
RBR-516 daily 09:30 PT snapshot (Jul 16, Phase 3 Day 2 = department-lead cascade).

Phase 3 cadence (per data/evidence/phase3-final-chance-email.md, playbook §3.3):
  Day 1 (Jul 15): Office-hours + DM non-installers (RBR-497 did this).
  Day 2 (Jul 16): Department-lead cascade -- IT lead sends per-team list to each lead.
  Day 3 (Jul 17): Personal 1:1 outreach to top 20 blockers.

Compliance rule (per playbook §3.1 / RBR-410 script):
  fleet strict-compliant iff sourceType=AGENT AND lastCheckedAt within 48h.
  Encryption + firewall are NOT gates (RBR-105 / RBR-106 telemetry gaps
  still apply to the fleet; we surface them under aggregateControlFailure).

Day-6 cascade plan (Phase 3 Day 2 = department-lead cascade per playbook §3.3):
  - Reconcile the residual cohort RBR-497 handed off to IT for Phase 3.
  - Build the fresh top-20 stalled/non-agent cohort for the dept-lead cascade
    (excludes the RBR-497 top-20 already in IT motion and Unknown-OS orphans
    covered by RBR-108).
  - Hand off the Day-2 cascade list as a department-lead ready file.
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
        print("DRATA_API_KEY missing -- aborting without touching monitor file", file=sys.stderr)
        sys.exit(2)
    with open(ROSTER) as f:
        roster = json.load(f)
    pilot_entries = roster["roster"]
    pilot_ids = [d["deviceId"] for d in pilot_entries]
    print(f"Fetching Drata /devices (target pilot ids: {len(pilot_ids)})...", file=sys.stderr)
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
        gate = "ABORT (Phase 1 EOD Jul 11 report; no change at 09:30 PT Jul 16)"

    outstanding_installs = sum(1 for d in devices if d.get("sourceType") != "AGENT")
    baseline_total = 621
    pct_with_agent_vs_baseline = round(fleet_with_agent / baseline_total * 100, 1) if baseline_total else 0.0

    # Day-6 cascade: per playbook §3.3, Phase 3 Day 2 = department-lead cascade;
    # flag silent >48h for IT remote-push. Reconcile the RBR-497 residual
    # hand-off (Day-5 IT-execution list) and produce a fresh top-20 for the
    # Day-2 dept-lead cascade.
    prior_targets_day5 = []
    day5_snap = None
    with open(MONITOR) as f:
        monitor = json.load(f)
    if monitor["snapshots"]:
        day5_snap = monitor["snapshots"][-1]
        for t in (day5_snap.get("dayNCascadePlan") or {}).get("targets") or []:
            prior_targets_day5.append(t)

    # All non-agent or stalled devices in current Drata index
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
                "serial": d.get("serialNumber"),
                "sourceType": d.get("sourceType"),
                "lastCheckedAt": last,
                "stalledOver48h": is_stalled,
                "noAgent": d.get("sourceType") != "AGENT",
            })
    outreach_targets.sort(key=lambda x: (not x["noAgent"], x["lastCheckedAt"] or ""))
    top_20 = outreach_targets[:20]

    # Reconcile Day-5 (RBR-497) IT hand-off targets against current snapshot.
    day5_recon = []
    for t in prior_targets_day5:
        did = t["deviceId"]
        d = by_id.get(did)
        if not d:
            day5_recon.append({
                "deviceId": did,
                "day5State": t.get("noAgent", False),
                "day5LastCheckedAt": t.get("lastCheckedAt"),
                "currentState": "not-in-drata",
                "movedIntoIndex": False,
                "becameAgent": False,
                "freshHeartbeat24h": False,
            })
            continue
        last = d.get("lastCheckedAt")
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00")) if last else None
        recent24 = last_dt is not None and last_dt >= cutoff24
        is_agent = d.get("sourceType") == "AGENT"
        prev_dt = None
        prev_last = t.get("lastCheckedAt")
        if prev_last:
            try:
                prev_dt = datetime.fromisoformat(prev_last.replace("Z", "+00:00"))
            except Exception:
                prev_dt = None
        became_agent = (not t.get("noAgent", True)) is False and is_agent
        fresh = last_dt is not None and prev_dt is not None and last_dt > prev_dt
        day5_recon.append({
            "deviceId": did,
            "day5State": t.get("noAgent", False),
            "day5LastCheckedAt": prev_last,
            "currentLastCheckedAt": last,
            "currentState": "agent-and-recent" if (is_agent and recent24) else
                            ("agent-but-stalled" if is_agent else "no-agent"),
            "movedIntoIndex": is_agent and recent24,
            "becameAgent": became_agent,
            "freshHeartbeat24h": fresh,
        })
    day5_moved = sum(1 for r in day5_recon if r["movedIntoIndex"])
    day5_became_agent = sum(1 for r in day5_recon if r["becameAgent"])
    day5_fresh = sum(1 for r in day5_recon if r["freshHeartbeat24h"])

    # Day-2 dept-lead cascade top-20: exclude Day-5 IT hand-off (already in motion)
    # and Unknown-OS orphans (RBR-108 cleanup path).
    day5_ids = {t["deviceId"] for t in prior_targets_day5}
    day2_targets = []
    for t in outreach_targets:
        if t["deviceId"] in day5_ids:
            continue
        if t["sourceType"] == "UNKNOWN" or t["osVersion"] is None:
            continue
        day2_targets.append(t)
    day2_top_20 = day2_targets[:20]

    snapshot = {
        "date": "2026-07-16",
        "phaseDay": 6,
        "phase1PilotDay": 6,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "capturedBy": "secops",
        "capturedFor": "RBR-516 daily 09:30 PT snapshot -- Phase 3 Day 2 (department-lead cascade per playbook §3.3; IT hand-off delta from RBR-497 Day-5 residual)",
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
                f"{pilot_stalled}/30 pilot devices silent >48h (or not in Drata index) -- agent not installed/heartbeating on these",
                f"Only {pilot_with_agent}/30 pilot devices sourceType=AGENT -- pilot chase has not moved the missing IDs into the index",
                f"{pilot_not_in_drata} pilot device IDs not present in the Drata index at all (RBR-410 follow-up: investigate whether the index excludes pilot IDs or whether these devices need MDM/agent re-push)",
            ],
        },
        "aggregateControlFailure": dict(control_failure),
        "topIssues": [
            "Phase 3 Day 2 (Jul 16) -- per playbook §3.3: department-lead cascade; flag silent >48h for IT remote-push.",
            f"Fleet strict-compliant count {fleet_compliant}/{fleet_total} ({pct_compliant}%); RBR-105/106/107 telemetry gap still blocks encryption/AV/auto-update/password-manager classification for the agent-installed cohort.",
            f"Pilot gate status unchanged: {pilot_compliant}/30 compliant (gate >=27/30). ABORT disposition holds; root cause is heartbeat ingestion (RBR-105/106) not install (RBR-410).",
            f"Day-5 IT hand-off (RBR-497) reconciliation: {day5_moved}/{len(day5_recon)} Day-5 residual hand-off targets moved into the index (agent-and-recent); {day5_became_agent} became agent since Day 5; {day5_fresh} produced fresh heartbeats since Day 5. The Phase-3 launch (Jul 14 09:00 PT) was the hand-off point; this RBR-516 09:30 PT capture measures the 2-day IT-execution delta.",
            f"Day-2 dept-lead cascade targets: {len(day2_top_20)} surfaced (top 20 below); cohort excludes Day-5 IT hand-off (already in motion) and Unknown-OS orphans (RBR-108 path).",
            "197 Unknown-OS orphans unchanged -- RBR-108 still pending; cascade list excludes these per their lack of Drata index presence.",
        ],
        "dataReconciliation": {
            "priorSnapshot": "2026-07-15T16:40Z (RBR-497 daily 09:30 PT Day 5)",
            "priorWithAgent": 427,
            "priorCompliant": 102,
            "priorDrataIndex": 623,
            "currentWithAgent": fleet_with_agent,
            "currentCompliant": fleet_compliant,
            "currentDrataIndex": fleet_total,
            "deltaWithAgent": fleet_with_agent - 427,
            "deltaCompliant": fleet_compliant - 102,
            "deltaDrataIndex": fleet_total - 623,
            "note": "Compared to RBR-497 last snapshot (Day 5). Positive delta = installs overnight OR devices that re-emerged with fresh heartbeats; negative = agents that went silent and crossed the 48h threshold.",
        },
        "day5ITHandOffReconciliation": {
            "source": "RBR-497 dayNCascadePlan.targets (Day-5 IT residual hand-off top 20)",
            "targetCount": len(day5_recon),
            "movedIntoIndex": day5_moved,
            "becameAgent": day5_became_agent,
            "freshHeartbeatSinceDay5": day5_fresh,
            "results": day5_recon,
            "note": "Day-5 IT hand-off (RBR-497) launched Phase 3 on Jul 14 09:00 PT. This RBR-516 09:30 PT capture measures the 2-day IT-execution delta (Wed-Thu).",
        },
        "dayNCascadePlan": {
            "day": 2,
            "phase": "Phase 3",
            "phaseDay": 2,
            "action": "Department-lead cascade -- IT lead sends per-team list to each lead (per playbook §3.3, Phase 3 cadence). Flag silent >48h for IT remote-push. Top 20 surfaced for Day-2 cascade; residual Day-3 (Jul 17) targets computed below for the personal 1:1 outreach preparation.",
            "scheduledAt": "2026-07-16T13:00:00-07:00",
            "owner": "secops -> people-ops + dept-leads",
            "targets": day2_top_20,
            "targetCount": len(day2_top_20),
            "fullTargetsCount": len(day2_targets),
            "day3OutreachPrep": {
                "purpose": "Pre-compute residual cohort for Phase 3 Day 3 (Jul 17) personal 1:1 outreach to top 20 blockers, per playbook §3.3.",
                "count": len(day2_targets[20:]),
                "top20": day2_targets[20:40],
                "excludeDay5HandOff": True,
                "excludeUnknownOrphans": True,
            },
        },
        "actionsTakenThisDay": [
            "09:30 PT: SecOps captured this RBR-516 Day 6 snapshot (fleet + pilot) via direct Drata API call -- Phase 3 Day 2 = department-lead cascade measurement.",
            "Reconciled Day-5 IT hand-off (RBR-497 residual) overnight + 2-day delta: see day5ITHandOffReconciliation.",
            "Computed Day-2 dept-lead cascade top 20: see dayNCascadePlan.targets.",
            "Pre-computed Day-3 (Jul 17) 1:1 outreach residual cohort: see dayNCascadePlan.day3OutreachPrep.",
        ],
        "nextDayActions": [
            "Day 2 EOD (Jul 16 EOD): dept-lead cascade fires per playbook §3.3; IT lead sends per-team list to each lead.",
            "Day 3 (Jul 17 09:30 PT): RBR-516 daily 09:30 PT snapshot routine fires again -- measure dept-lead cascade delta.",
            "Day 3 (Jul 17 13:00 PT): per playbook §3.3, personal 1:1 outreach to top 20 blockers; pre-computed list in dayNCascadePlan.day3OutreachPrep.top20.",
            "Phase 3 deadline: EOD Fri Jul 17 -- devices still silent at EOD Jul 18 flagged in phase-gate report to CISO (RBR-98 follow-up on Jul 21).",
            "RBR-108: 197 Unknown-OS orphans cleanup still pending -- separate workstream.",
            "RBR-105/106/107: Telemetry ingestion gap continues to block encryption/AV/auto-update/password-manager classification for the agent-installed cohort.",
        ],
    }

    monitor["snapshots"].append(snapshot)
    with open(MONITOR, "w") as f:
        json.dump(monitor, f, indent=2)
        f.write("\n")

    summary = {
        "date": snapshot["date"],
        "phaseDay": snapshot["phaseDay"],
        "phase": "Phase 3 Day 2 (dept-lead cascade)",
        "fleetTotal": fleet_total,
        "fleetWithAgent": fleet_with_agent,
        "fleetCompliant": fleet_compliant,
        "pctWithAgent": pct_with_agent_vs_baseline,
        "pctCompliant": pct_compliant,
        "outstandingInstalls": outstanding_installs,
        "pilotCompliant": pilot_compliant,
        "pilotPct": pilot_pct,
        "gate": gate,
        "day5ITHandOffReconciliation": {
            "targetCount": len(day5_recon),
            "movedIntoIndex": day5_moved,
            "becameAgent": day5_became_agent,
            "freshHeartbeatSinceDay5": day5_fresh,
        },
        "day2CascadeTopCount": len(day2_top_20),
        "day2CascadeTotal": len(day2_targets),
        "day3OutreachPrepCount": len(day2_targets[20:]),
    }
    print(json.dumps(summary, indent=2))
    print("appended snapshot to", MONITOR, file=sys.stderr)


if __name__ == "__main__":
    main()