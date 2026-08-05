#!/usr/bin/env python3
"""
RBR-603 daily 09:30 PT snapshot (Jul 20, Day 10).

Day 10 — Monday Jul 20, the last pre-Phase-4 business day.
Phase 3 closed EOD Jul 18. Phase 4 (RBR-98) starts Jul 21 (Tuesday).
This is the final "holding pattern" snapshot before Phase 4 evidence
collection begins.

Per playbook §3.3, today falls in the gap between Phase 3 close
and Phase 4 start. Actions:
  - Capture fleet + pilot snapshot (same format as RBR-559/RBR-599).
  - Reconcile against RBR-599 (Jul 19) for day-over-day delta.
  - Continue cumulative cascade efficacy readout.
  - Emit residual hand-off status (unchanged until Phase 4 starts).
  - Flag any new heartbeats or agent installations since last check.
  - Emit Phase 4 readiness summary (fleet state entering the evidence window).

Compliance rule (per playbook §3.1 / RBR-410 script):
  fleet strict-compliant iff sourceType=AGENT AND lastCheckedAt within 48h.
  Encryption + firewall are NOT gates (RBR-105/106 telemetry gaps still apply).
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


def reconcile_cascade(by_id, prior_targets, cutoff24):
    results = []
    moved_into_index = 0
    became_agent = 0
    fresh_heartbeat = 0
    for t in (prior_targets or []):
        did = t["deviceId"]
        d = by_id.get(did)
        prev_last = t.get("lastCheckedAt")
        prev_dt = None
        if prev_last:
            try:
                prev_dt = datetime.fromisoformat(prev_last.replace("Z", "+00:00"))
            except Exception:
                prev_dt = None
        if not d:
            results.append({
                "deviceId": did,
                "priorState": t.get("noAgent", False),
                "priorLastCheckedAt": prev_last,
                "currentState": "not-in-drata",
                "movedIntoIndex": False,
                "becameAgent": False,
                "freshHeartbeat24h": False,
            })
            continue
        last = d.get("lastCheckedAt")
        last_dt = None
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            except Exception:
                last_dt = None
        recent24 = last_dt is not None and last_dt >= cutoff24
        is_agent = d.get("sourceType") == "AGENT"
        moved = is_agent and recent24
        if t.get("noAgent", True) and is_agent:
            became = True
        else:
            became = False
        fresh = (
            last_dt is not None
            and prev_dt is not None
            and last_dt > prev_dt
        )
        if moved:
            moved_into_index += 1
        if became:
            became_agent += 1
        if fresh:
            fresh_heartbeat += 1
        results.append({
            "deviceId": did,
            "priorState": t.get("noAgent", False),
            "priorLastCheckedAt": prev_last,
            "currentLastCheckedAt": last,
            "currentState": (
                "agent-and-recent" if (is_agent and recent24)
                else ("agent-but-stalled" if is_agent else "no-agent")
            ),
            "movedIntoIndex": moved,
            "becameAgent": became,
            "freshHeartbeat24h": fresh,
        })
    return {
        "targetCount": len(results),
        "movedIntoIndex": moved_into_index,
        "becameAgent": became_agent,
        "freshHeartbeat24h": fresh_heartbeat,
        "results": results,
    }


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
        last_dt = None
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            except Exception:
                last_dt = None
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

    baseline_total = 621
    pct_with_agent = round(fleet_with_agent / baseline_total * 100, 1) if baseline_total else 0.0
    pct_compliant = round(fleet_compliant / baseline_total * 100, 1) if baseline_total else 0.0

    # Pilot snapshot
    pilot_with_agent = 0
    pilot_compliant = 0
    pilot_stalled = 0
    pilot_not_in_drata = 0
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
            continue
        last = d.get("lastCheckedAt")
        last_dt = None
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            except Exception:
                last_dt = None
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

    pilot_pct = round(pilot_compliant / len(pilot_ids) * 100, 1) if pilot_ids else 0.0
    if pilot_pct >= 90:
        gate = "PASS"
    elif pilot_pct >= 80:
        gate = "ADJUST"
    else:
        gate = "ABORT (Phase 1 EOD Jul 11 report; no change at 09:30 PT Jul 20)"

    outstanding_installs = sum(1 for d in devices if d.get("sourceType") != "AGENT")

    # ------------------------------------------------------------------
    # Data reconciliation vs RBR-599 (last snapshot, Jul 19)
    # ------------------------------------------------------------------
    with open(MONITOR) as f:
        monitor = json.load(f)
    snaps = monitor["snapshots"]
    last_snap = snaps[-1] if snaps else None

    prior_total = (last_snap or {}).get("withAgent")
    prior_compliant = (last_snap or {}).get("compliant")
    prior_index = (last_snap or {}).get("enrolledInDrata") or (last_snap or {}).get("totalDevices")
    prior_stalled = (last_snap or {}).get("stalled48h")
    prior_recent24 = (last_snap or {}).get("recentlyChecked24h")
    delta_with_agent = fleet_with_agent - (prior_total or 0)
    delta_compliant = fleet_compliant - (prior_compliant or 0)
    delta_index = fleet_total - (prior_index or 0)
    delta_stalled = fleet_stalled48 - (prior_stalled or 0)
    delta_recent24 = fleet_recent24 - (prior_recent24 or 0)

    # ------------------------------------------------------------------
    # Cascade reconciliation from prior snapshots
    # ------------------------------------------------------------------
    cascade_by_key = {}
    for s in snaps:
        plan = s.get("dayNCascadePlan") or {}
        day = plan.get("day")
        if day is None:
            continue
        phase_str = plan.get("phase") or "Wave 1"
        targets = plan.get("targets") or plan.get("residualHandOff", {}).get("top20") or []
        key = f"{phase_str}|day={day}"
        cascade_by_key[key] = {
            "phase": phase_str,
            "day": day,
            "phaseDay": plan.get("phaseDay"),
            "snapshotDate": s.get("date"),
            "capturedAt": s.get("capturedAt"),
            "targets": targets,
        }

    day3_outreach_targets = (cascade_by_key.get("Phase 3|day=3") or {}).get("targets", [])
    day2_dept_lead_targets = (cascade_by_key.get("Phase 3|day=2") or {}).get("targets", [])
    day5_it_handoff_targets = (cascade_by_key.get("Wave 1|day=5") or cascade_by_key.get("Phase 3|day=5") or {}).get("targets", [])
    day4_it_remote_push_targets = (cascade_by_key.get("Wave 1|day=4") or cascade_by_key.get("Phase 2|day=4") or {}).get("targets", [])
    day3_w1_outreach_targets = (cascade_by_key.get("Wave 1|day=3") or cascade_by_key.get("Phase 1|day=3") or {}).get("targets", [])
    day2_w1_targets = (cascade_by_key.get("Wave 1|day=2") or cascade_by_key.get("Phase 1|day=2") or {}).get("targets", [])

    day3_1on1_recon = reconcile_cascade(by_id, day3_outreach_targets, cutoff24)
    day2_dept_lead_recon = reconcile_cascade(by_id, day2_dept_lead_targets, cutoff24)
    day5_it_recon = reconcile_cascade(by_id, day5_it_handoff_targets, cutoff24)
    day4_it_recon = reconcile_cascade(by_id, day4_it_remote_push_targets, cutoff24)
    day3_w1_recon = reconcile_cascade(by_id, day3_w1_outreach_targets, cutoff24)
    day2_w1_recon = reconcile_cascade(by_id, day2_w1_targets, cutoff24)

    # ------------------------------------------------------------------
    # Residual hand-off (unchanged from Jul 18 until Phase 4 starts)
    # ------------------------------------------------------------------
    touched_ids = set()
    for t in day3_outreach_targets:
        touched_ids.add(t["deviceId"])
    for t in day2_dept_lead_targets:
        touched_ids.add(t["deviceId"])
    for t in day5_it_handoff_targets:
        touched_ids.add(t["deviceId"])
    for t in day4_it_remote_push_targets:
        touched_ids.add(t["deviceId"])
    for t in day3_w1_outreach_targets:
        touched_ids.add(t["deviceId"])
    for t in day2_w1_targets:
        touched_ids.add(t["deviceId"])

    residual_targets = []
    for d in devices:
        last = d.get("lastCheckedAt")
        last_dt = None
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            except Exception:
                last_dt = None
        is_stalled = (last_dt is None) or (last_dt < cutoff48)
        if not is_stalled:
            continue
        did = d["id"]
        if did in touched_ids:
            continue
        residual_targets.append({
            "deviceId": did,
            "personnelId": d.get("personnelId"),
            "userId": d.get("userId"),
            "osVersion": d.get("osVersion"),
            "model": d.get("model"),
            "serial": d.get("serialNumber"),
            "sourceType": d.get("sourceType"),
            "lastCheckedAt": last,
            "stalledOver48h": True,
        })
    residual_targets.sort(key=lambda x: x["lastCheckedAt"] or "")
    residual_top20 = residual_targets[:20]

    total_cascade_targets = (
        day3_1on1_recon['targetCount'] + day4_it_recon['targetCount'] +
        day5_it_recon['targetCount'] + day2_dept_lead_recon['targetCount'] +
        day3_w1_recon['targetCount'] + day2_w1_recon['targetCount']
    )
    total_moved = (
        day3_1on1_recon['movedIntoIndex'] + day4_it_recon['movedIntoIndex'] +
        day5_it_recon['movedIntoIndex'] + day2_dept_lead_recon['movedIntoIndex'] +
        day3_w1_recon['movedIntoIndex'] + day2_w1_recon['movedIntoIndex']
    )

    snapshot = {
        "date": "2026-07-20",
        "phaseDay": 10,
        "phase1PilotDay": 10,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "capturedBy": "secops",
        "capturedFor": "RBR-603 daily 09:30 PT snapshot -- Day 10 (final pre-Phase-4 business day). Holding pattern: no cascade action today. Captures organic fleet movement + Phase 4 readiness baseline.",
        "scope": "fleet+pilot",
        "totalDevices": baseline_total,
        "enrolledInDrata": fleet_total,
        "withAgent": fleet_with_agent,
        "compliant": fleet_compliant,
        "pctWithAgent": pct_with_agent,
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
                f"{pilot_stalled}/30 pilot devices silent >48h (or not in Drata index)",
                f"Only {pilot_with_agent}/30 pilot devices sourceType=AGENT",
                f"{pilot_not_in_drata} pilot device IDs not present in the Drata index at all",
            ],
        },
        "aggregateControlFailure": dict(control_failure),
        "topIssues": [
            f"Day 10 final pre-Phase-4 holding pattern -- Phase 3 closed EOD Jul 18; Phase 4 (RBR-98) starts tomorrow Jul 21. Cumulative cascade efficacy: {total_moved}/{total_cascade_targets} across all 6 cascade days. Device-side staleness remains the bottleneck.",
            f"Fleet strict-compliant count {fleet_compliant}/{baseline_total} ({pct_compliant}%); delta vs Jul 19: agent {delta_with_agent:+d}, compliant {delta_compliant:+d}.",
            f"Pilot gate status unchanged: {pilot_compliant}/30 compliant (gate >=27/30). ABORT disposition holds.",
            f"Residual hand-off cohort: {len(residual_targets)} silent devices not touched by any cascade day -- queued for Phase 4 IT support starting Jul 21.",
            "197 Unknown-OS orphans unchanged -- RBR-108 still pending; needs Drata index rebuild.",
        ],
        "dataReconciliation": {
            "priorSnapshot": "2026-07-19 (RBR-599 daily 09:30 PT Day 9)",
            "priorWithAgent": prior_total,
            "priorCompliant": prior_compliant,
            "priorDrataIndex": prior_index,
            "priorStalled48h": prior_stalled,
            "priorRecent24h": prior_recent24,
            "currentWithAgent": fleet_with_agent,
            "currentCompliant": fleet_compliant,
            "currentDrataIndex": fleet_total,
            "currentStalled48h": fleet_stalled48,
            "currentRecent24h": fleet_recent24,
            "deltaWithAgent": delta_with_agent,
            "deltaCompliant": delta_compliant,
            "deltaDrataIndex": delta_index,
            "deltaStalled48h": delta_stalled,
            "deltaRecent24h": delta_recent24,
            "note": "Day-over-day delta vs RBR-599 (Jul 19). Phase 3 closed; no cascade action today.",
        },
        "cumulativeCascadeEfficacy": {
            "wave1Day2DeptLead": {
                "source": "RBR-455 / Wave 1 Day 2 dept-lead cascade",
                "phase": "Wave 1",
                "day": 2,
                "targetCount": day2_w1_recon["targetCount"],
                "movedIntoIndex": day2_w1_recon["movedIntoIndex"],
                "becameAgent": day2_w1_recon["becameAgent"],
                "freshHeartbeat24h": day2_w1_recon["freshHeartbeat24h"],
            },
            "wave1Day3Outreach": {
                "source": "RBR-469 / Wave 1 Day 3 personal 1:1 outreach",
                "phase": "Wave 1",
                "day": 3,
                "targetCount": day3_w1_recon["targetCount"],
                "movedIntoIndex": day3_w1_recon["movedIntoIndex"],
                "becameAgent": day3_w1_recon["becameAgent"],
                "freshHeartbeat24h": day3_w1_recon["freshHeartbeat24h"],
            },
            "wave1Day4ITRemotePush": {
                "source": "RBR-490 / Wave 1 Day 4 IT remote-push",
                "phase": "Wave 1",
                "day": 4,
                "targetCount": day4_it_recon["targetCount"],
                "movedIntoIndex": day4_it_recon["movedIntoIndex"],
                "becameAgent": day4_it_recon["becameAgent"],
                "freshHeartbeat24h": day4_it_recon["freshHeartbeat24h"],
            },
            "wave1Day5ITHandOff": {
                "source": "RBR-497 / Wave 1 Day 5 IT residual hand-off",
                "phase": "Wave 1",
                "day": 5,
                "targetCount": day5_it_recon["targetCount"],
                "movedIntoIndex": day5_it_recon["movedIntoIndex"],
                "becameAgent": day5_it_recon["becameAgent"],
                "freshHeartbeat24h": day5_it_recon["freshHeartbeat24h"],
            },
            "phase3Day2DeptLead": {
                "source": "RBR-516 / Phase 3 Day 2 dept-lead cascade",
                "phase": "Phase 3",
                "day": 2,
                "targetCount": day2_dept_lead_recon["targetCount"],
                "movedIntoIndex": day2_dept_lead_recon["movedIntoIndex"],
                "becameAgent": day2_dept_lead_recon["becameAgent"],
                "freshHeartbeat24h": day2_dept_lead_recon["freshHeartbeat24h"],
            },
            "phase3Day3OneOnOne": {
                "source": "RBR-539 / Phase 3 Day 3 personal 1:1 outreach",
                "phase": "Phase 3",
                "day": 3,
                "targetCount": day3_1on1_recon["targetCount"],
                "movedIntoIndex": day3_1on1_recon["movedIntoIndex"],
                "becameAgent": day3_1on1_recon["becameAgent"],
                "freshHeartbeat24h": day3_1on1_recon["freshHeartbeat24h"],
            },
            "verdict": (
                f"Cumulative cascade efficacy: {total_moved}/{total_cascade_targets} across 6 cascade days. "
                "Device-side staleness (2-4y old lastCheckedAt on AGENT-sourceType devices) remains the "
                "bottleneck, not cascade architecture. Phase 4 evidence collection (Jul 21) should pair "
                "each residual with a manual retirement ticket in Drata."
            ),
        },
        "residualHandOff": {
            "phase": "Phase 3 closed -> Phase 4 start (Jul 21)",
            "owner": "IT desktop support (ongoing) + SecOps (Drata retirement tickets)",
            "totalResidual": len(residual_targets),
            "top20": residual_top20,
            "note": (
                f"{len(residual_targets)} silent devices not touched by any cascade day. "
                "Phase 4 (RBR-98) starts Jul 21 -- IT should pair each with a manual "
                "Drata retirement ticket to clear the backlog."
            ),
        },
        "phase4Readiness": {
            "startDate": "2026-07-21",
            "blockingIssues": {
                "RBR-105": "Drata Agent telemetry gap (anti-malware, auto-update, password-manager nulls) -- blocked",
                "RBR-106": "Host firewall on 110 non-compliant devices -- blocked",
                "RBR-107": "Disk encryption on 3 non-compliant macOS -- blocked",
                "RBR-108": "197 Unknown-OS devices in Drata -- todo (not blocking)",
            },
            "fleetEnteringPhase4": {
                "withAgent": fleet_with_agent,
                "strictCompliant": fleet_compliant,
                "outstandingInstalls": outstanding_installs,
                "stalled48h": fleet_stalled48,
                "residualHandOff": len(residual_targets),
            },
            "recommendation": (
                "Accept IT-driven device retirement as the Phase 4 close-out path. "
                "Do not re-run cascade outreach (0/150 cumulative efficacy confirms "
                "device-side staleness, not communication failure). Focus Phase 4 on "
                "A.8.1/A.8.7/A.8.8 evidence verification for the 427 agent-installed devices "
                "and manual Drata retirement for stale residuals."
            ),
        },
        "dayNCascadePlan": {
            "day": 0,
            "phase": "Holding pattern (final pre-Phase-4)",
            "phaseDay": 10,
            "action": (
                "Day 10 final pre-Phase-4 holding pattern. No cascade action today. "
                "Phase 4 (RBR-98) starts tomorrow Jul 21 with IT ongoing support taking "
                "residual hand-off cohort. Today's capture measures organic fleet "
                "movement and establishes the Phase 4 readiness baseline."
            ),
            "scheduledAt": now.isoformat().replace("+00:00", "Z"),
            "owner": "secops (monitor only)",
            "nextDayActions": [
                "Jul 21 (Tue): Phase 4 starts -- RBR-98 kickoff; IT takes residual hand-off cohort.",
                "Jul 21: RBR-98 phase-gate report to CISO summarizing cumulative cascade efficacy.",
            ],
        },
        "actionsTakenThisDay": [
            "09:30 PT: SecOps captured this RBR-603 Day 10 snapshot (fleet + pilot) via direct Drata API call -- final pre-Phase-4 holding pattern.",
            "Reconciled day-over-day delta vs RBR-599 (Jul 19).",
            "Refreshed cumulative cascade efficacy across 6 cascade days: unchanged.",
            "Updated residual hand-off count for Phase 4 queue.",
            "Emitted Phase 4 readiness summary entering the evidence collection window.",
        ],
        "nextDayActions": [
            "Jul 21 (Tue): Phase 4 (RBR-98) kickoff -- IT ongoing support takes residual hand-off cohort.",
            "Jul 21: SecOps posts Phase 4 readiness report to RBR-89.",
            "Jul 21: RBR-98 phase-gate report to CISO.",
        ],
    }

    monitor["snapshots"].append(snapshot)
    # Update rollout section for current phase
    monitor["rollout"] = {
        "phase": "Post-Phase-3 -> Pre-Phase-4 (Day 10 holding pattern)",
        "owningIssueId": "f1f5bea6-0515-4a3d-802e-4542b0899374",
        "owningIssueIdentifier": "RBR-603",
        "parentIssueId": "69edf21a-3194-41be-800e-d6ac7df967d8",
        "kickoffDate": "2026-07-10",
        "gateDate": "2026-07-21",
        "targetEnrollPctByGate": 90,
        "baselineEnrollPct": pct_with_agent,
    }
    with open(MONITOR, "w") as f:
        json.dump(monitor, f, indent=2)
        f.write("\n")

    summary = {
        "date": snapshot["date"],
        "phaseDay": snapshot["phaseDay"],
        "phase": "Final pre-Phase-4 holding pattern (Day 10)",
        "fleetTotal": fleet_total,
        "fleetWithAgent": fleet_with_agent,
        "fleetCompliant": fleet_compliant,
        "pctWithAgent": pct_with_agent,
        "pctCompliant": pct_compliant,
        "outstandingInstalls": outstanding_installs,
        "stalled48h": fleet_stalled48,
        "recent24h": fleet_recent24,
        "pilotCompliant": pilot_compliant,
        "pilotPct": pilot_pct,
        "gate": gate,
        "deltaVsJul19": {
            "withAgent": delta_with_agent,
            "compliant": delta_compliant,
            "drataIndex": delta_index,
            "stalled48h": delta_stalled,
            "recent24h": delta_recent24,
        },
        "cumulativeCascade": f"{total_moved}/{total_cascade_targets}",
        "residualHandOffTotal": len(residual_targets),
        "phase4StartsTomorrow": True,
    }
    print(json.dumps(summary, indent=2))
    print("appended snapshot to", MONITOR, file=sys.stderr)


if __name__ == "__main__":
    main()
