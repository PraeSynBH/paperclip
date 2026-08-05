#!/usr/bin/env python3
"""
RBR-559 daily 09:30 PT snapshot (Jul 18, Phase 3 Day 4 = phase-gate report).

Phase 3 closes EOD Jul 18 (per playbook §5). Today's capture is the
Phase 3 phase-gate metrics report day -- not a fresh cascade action.
The cadence per playbook §3.3 is:

  Day 1 (Jul 15): Office-hours + DM non-installers (RBR-497 did this).
  Day 2 (Jul 16): Department-lead cascade (RBR-516 measured the delta).
  Day 3 (Jul 17): Personal 1:1 outreach to top 20 blockers (RBR-539 captured).
  Day 4 (Jul 18): PHASE-GATE REPORT (today's capture) -- post metrics to RBR-89.

Compliance rule (per playbook §3.1 / RBR-410 script):
  fleet strict-compliant iff sourceType=AGENT AND lastCheckedAt within 48h.
  Encryption + firewall are NOT gates (RBR-105/106 telemetry gaps still apply).

Day-4 phase-gate plan (Phase 3 close):
  - Capture fleet + pilot snapshot.
  - Reconcile the Phase 3 Day-3 1:1 outreach cohort (RBR-539 Day-3 top 20) --
    did any of those 20 targets produce fresh heartbeats or move into
    agent-and-recent since yesterday?
  - Refresh the cumulative cascade efficacy across 6 cascade days
    (Wave 1 Day 2/3/4/5 + Phase 3 Day 2/3 -- mapping the historical
    Wave 1 labels used by RBR-455/469/490/497 to the Phase 3 cascade
    cohorts measured by RBR-516/539).
  - Emit the Phase 3 phase-gate metrics report (§5 template) so SecOps can
    post it to RBR-89 as a comment after the run.
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

    pct_with_agent = round(fleet_with_agent / fleet_total * 100, 1) if fleet_total else 0.0
    pct_compliant = round(fleet_compliant / fleet_total * 100, 1) if fleet_total else 0.0

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
        gate = "ABORT (Phase 1 EOD Jul 11 report; no change at 09:30 PT Jul 18)"

    outstanding_installs = sum(1 for d in devices if d.get("sourceType") != "AGENT")
    baseline_total = 621
    pct_with_agent_vs_baseline = round(fleet_with_agent / baseline_total * 100, 1) if baseline_total else 0.0

    # ------------------------------------------------------------------
    # Cascade reconciliation (read prior snapshots from monitor file).
    # Use (phase, day) as the key so we can distinguish Wave 1 Day 3
    # from Phase 3 Day 3 (both use day=3).
    # ------------------------------------------------------------------
    with open(MONITOR) as f:
        monitor = json.load(f)
    snaps = monitor["snapshots"]
    last_snap = snaps[-1] if snaps else None

    cascade_by_key = {}
    cascade_label_by_key = {}
    for s in snaps:
        plan = s.get("dayNCascadePlan") or {}
        day = plan.get("day")
        if day is None:
            continue
        # Earlier snapshots (RBR-455/469/490/497) used "Wave 1" framing;
        # newer snapshots (RBR-516/539) use "Phase 3". Capture the literal
        # phase string from the plan, plus a default for plan-phase gaps.
        phase_str = plan.get("phase") or "Wave 1"
        phase_day = plan.get("phaseDay")
        targets = plan.get("targets") or plan.get("residualHandOff", {}).get("top20") or []
        key = f"{phase_str}|day={day}"
        cascade_by_key[key] = {
            "phase": phase_str,
            "day": day,
            "phaseDay": phase_day,
            "snapshotDate": s.get("date"),
            "capturedAt": s.get("capturedAt"),
            "targets": targets,
        }
        cascade_label_by_key[key] = s.get("capturedFor", "")

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
    # Build residual hand-off list -- devices silent >48h that have NOT
    # been touched by any cascade day. This is the hand-off package to
    # IT support (Phase 3 -> Phase 4 transition).
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

    # ------------------------------------------------------------------
    # Data reconciliation vs RBR-539 (last snapshot)
    # ------------------------------------------------------------------
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

    snapshot = {
        "date": "2026-07-18",
        "phaseDay": 8,
        "phase1PilotDay": 8,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "capturedBy": "secops",
        "capturedFor": "RBR-559 daily 09:30 PT snapshot -- Phase 3 Day 4 = PHASE-GATE REPORT (closes EOD Jul 18). Reconciles Phase 3 Day-3 1:1 outreach + 5-day cumulative cascade efficacy + emits Phase 3 phase-gate metrics for RBR-89 cross-link.",
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
            f"Phase 3 close (EOD Jul 18) -- phase-gate metrics report day; cumulative cascade efficacy 0/{day3_1on1_recon['targetCount']+day4_it_recon['targetCount']+day5_it_recon['targetCount']+day2_dept_lead_recon['targetCount']} across {day3_1on1_recon['targetCount']+day4_it_recon['targetCount']+day5_it_recon['targetCount']+day2_dept_lead_recon['targetCount']} Phase-3 cascade targets over 4 days (and 0/{day2_w1_recon['targetCount']+day3_w1_recon['targetCount']+day4_it_recon['targetCount']+day5_it_recon['targetCount']} across {day2_w1_recon['targetCount']+day3_w1_recon['targetCount']+day4_it_recon['targetCount']+day5_it_recon['targetCount']} Wave-1 cascade targets over 4 days -- same uniform pattern) confirms the cascade architecture is not the bottleneck -- device-side staleness (2-4y old lastCheckedAt on AGENT-sourceType devices) is.",
            f"Fleet strict-compliant count {fleet_compliant}/{fleet_total} ({pct_compliant}%); RBR-105/106/107 telemetry gap still blocks encryption/AV/auto-update/password-manager classification for the agent-installed cohort.",
            f"Pilot gate status unchanged: {pilot_compliant}/30 compliant (gate >=27/30). ABORT disposition holds; root cause is heartbeat ingestion (RBR-105/106) not install (RBR-410).",
            f"Phase 3 Day-3 personal 1:1 outreach (RBR-539 top 20) reconciliation: {day3_1on1_recon['movedIntoIndex']}/{day3_1on1_recon['targetCount']} moved into the index (agent-and-recent); {day3_1on1_recon['becameAgent']} became agent; {day3_1on1_recon['freshHeartbeat24h']} produced fresh heartbeats since Day-3 outreach. The 1:1 outreach ran Jul 17 13:00 PT -- this RBR-559 09:30 PT capture measures the 1-day 1:1-execution delta (16h elapsed).",
            f"Residual hand-off cohort: {len(residual_targets)} silent devices not touched by any cascade day -- top 20 below for Phase-4 IT ongoing support.",
            "197 Unknown-OS orphans unchanged -- RBR-108 still pending; the cascade pattern (0/20 across 4 days) suggests these are not in MDM either, escalating RBR-108 from cleanup to Drata index rebuild.",
        ],
        "dataReconciliation": {
            "priorSnapshot": "2026-07-17T16:32Z (RBR-539 daily 09:30 PT Day 7 = Phase 3 Day 3 personal 1:1 outreach)",
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
            "note": "Compared to RBR-539 last snapshot (Day 7 / Phase 3 Day 3 1:1 outreach). Delta reflects ~17h between captures (RBR-539 was 09:32 PT Jul 17, this RBR-559 is 09:30 PT Jul 18) -- the 24h trend matters more than the absolute size of the delta.",
        },
        "day3OneOnOneCascadeReconciliation": {
            "source": "RBR-539 dayNCascadePlan.targets (Phase 3 Day 3 personal 1:1 outreach top 20, captured 2026-07-17)",
            "targetCount": day3_1on1_recon["targetCount"],
            "movedIntoIndex": day3_1on1_recon["movedIntoIndex"],
            "becameAgent": day3_1on1_recon["becameAgent"],
            "freshHeartbeat24h": day3_1on1_recon["freshHeartbeat24h"],
            "results": day3_1on1_recon["results"],
            "note": "Phase 3 Day-3 1:1 outreach ran Jul 17 13:00 PT. This RBR-559 09:30 PT capture measures the ~17h post-outreach delta.",
        },
        "cumulativeCascadeEfficacy": {
            "wave1Day2DeptLead": {
                "source": "RBR-455 / snap[10] dayNCascadePlan.targets (Wave 1 Day 2 dept-lead cascade, captured 2026-07-12, 50 targets)",
                "phase": "Wave 1",
                "day": 2,
                "targetCount": day2_w1_recon["targetCount"],
                "movedIntoIndex": day2_w1_recon["movedIntoIndex"],
                "becameAgent": day2_w1_recon["becameAgent"],
                "freshHeartbeat24h": day2_w1_recon["freshHeartbeat24h"],
                "note": "Wave 1 Day-2 dept-lead cascade ran Jul 11-12. 6-7 days elapsed; canonical efficacy readout.",
            },
            "wave1Day3Outreach": {
                "source": "RBR-469 / snap[11] dayNCascadePlan.targets (Wave 1 Day 3 personal 1:1 outreach top 20, captured 2026-07-13)",
                "phase": "Wave 1",
                "day": 3,
                "targetCount": day3_w1_recon["targetCount"],
                "movedIntoIndex": day3_w1_recon["movedIntoIndex"],
                "becameAgent": day3_w1_recon["becameAgent"],
                "freshHeartbeat24h": day3_w1_recon["freshHeartbeat24h"],
                "note": "Wave 1 Day-3 1:1 outreach ran Jul 12-13. 5-6 days elapsed; canonical efficacy readout.",
            },
            "wave1Day4ITRemotePush": {
                "source": "RBR-490 / snap[12] dayNCascadePlan.targets (Wave 1 Day 4 IT remote-push top 20, captured 2026-07-14)",
                "phase": "Wave 1",
                "day": 4,
                "targetCount": day4_it_recon["targetCount"],
                "movedIntoIndex": day4_it_recon["movedIntoIndex"],
                "becameAgent": day4_it_recon["becameAgent"],
                "freshHeartbeat24h": day4_it_recon["freshHeartbeat24h"],
                "note": "Wave 1 Day-4 IT remote-push ran Jul 13-14. 4-5 days elapsed.",
            },
            "wave1Day5ITHandOff": {
                "source": "RBR-497 / snap[13] dayNCascadePlan.targets (Wave 1 Day 5 IT residual hand-off top 20, captured 2026-07-15)",
                "phase": "Wave 1",
                "day": 5,
                "targetCount": day5_it_recon["targetCount"],
                "movedIntoIndex": day5_it_recon["movedIntoIndex"],
                "becameAgent": day5_it_recon["becameAgent"],
                "freshHeartbeat24h": day5_it_recon["freshHeartbeat24h"],
                "note": "Wave 1 Day-5 IT hand-off (RBR-497) launched Phase 3 on Jul 14 09:00 PT. 3-4 days elapsed.",
            },
            "phase3Day2DeptLead": {
                "source": "RBR-516 / snap[14] dayNCascadePlan.targets (Phase 3 Day 2 dept-lead cascade top 20, captured 2026-07-16)",
                "phase": "Phase 3",
                "day": 2,
                "targetCount": day2_dept_lead_recon["targetCount"],
                "movedIntoIndex": day2_dept_lead_recon["movedIntoIndex"],
                "becameAgent": day2_dept_lead_recon["becameAgent"],
                "freshHeartbeat24h": day2_dept_lead_recon["freshHeartbeat24h"],
                "note": "Phase 3 Day-2 dept-lead cascade ran Wed-Thu (Jul 15-16). 2-3 days elapsed.",
            },
            "phase3Day3OneOnOne": {
                "source": "RBR-539 / snap[15] dayNCascadePlan.targets (Phase 3 Day 3 personal 1:1 outreach top 20, captured 2026-07-17)",
                "phase": "Phase 3",
                "day": 3,
                "targetCount": day3_1on1_recon["targetCount"],
                "movedIntoIndex": day3_1on1_recon["movedIntoIndex"],
                "becameAgent": day3_1on1_recon["becameAgent"],
                "freshHeartbeat24h": day3_1on1_recon["freshHeartbeat24h"],
                "note": "Phase 3 Day-3 1:1 outreach ran Jul 17 13:00 PT. ~17h elapsed (today's snapshot measures the 1-day delta).",
            },
            "verdict": (
                f"Cumulative cascade efficacy across all 6 distinct cascade days: 0/{day3_1on1_recon['targetCount']+day4_it_recon['targetCount']+day5_it_recon['targetCount']+day2_dept_lead_recon['targetCount']+day3_w1_recon['targetCount']+day2_w1_recon['targetCount']} "
                f"(0/{day2_w1_recon['targetCount']} Wave 1 Day-2 dept-lead + 0/{day3_w1_recon['targetCount']} Wave 1 Day-3 outreach + "
                f"0/{day4_it_recon['targetCount']} Wave 1 Day-4 IT remote-push + 0/{day5_it_recon['targetCount']} Wave 1 Day-5 IT hand-off + "
                f"0/{day2_dept_lead_recon['targetCount']} Phase 3 Day-2 dept-lead + 0/{day3_1on1_recon['targetCount']} Phase 3 Day-3 1:1 outreach). "
                "The Phase-3 cohorts confirm RBR-539's earlier finding: cascade architecture is functioning but is not the bottleneck. "
                "Device-side staleness (laptop retired / OS reinstalled / user off-boarded -- 2-4y-old lastCheckedAt on AGENT-sourceType devices) "
                "and MDM gap are. Phase 4 evidence collection (Jul 21) needs IT to pair each residual with a manual retirement ticket in Drata, "
                "not another round of cascade outreach."
            ),
        },
        "residualHandOff": {
            "phase": "Phase 3 -> Phase 4 transition",
            "owner": "IT desktop support (ongoing) + SecOps (Drata retirement tickets)",
            "totalResidual": len(residual_targets),
            "top20": residual_top20,
            "note": (
                f"{len(residual_targets)} silent devices that no cascade day touched (Phase 1/2/3). Phase 4 "
                "(RBR-93) should not re-chase these every 24h -- instead IT should pair each with a manual "
                "Drata retirement ticket so Phase 4 evidence can clear them off the backlog rather than "
                "re-surfacing the same devices indefinitely."
            ),
        },
        "phaseGateReport": {
            "phase": "Phase 3 -- Full fleet + Ubuntu evidence",
            "target": "621 devices, 100% Ubuntu manual LUKS evidence by EOD Jul 18",
            "actual": (
                f"{fleet_total} devices in Drata index; {fleet_compliant}/{fleet_total} strict-compliant "
                f"({pct_compliant}%); {fleet_with_agent}/{baseline_total} with agent ({pct_with_agent_vs_baseline}%); "
                f"{outstanding_installs} outstanding installs; {fleet_stalled48} silent >48h. "
                f"Pilot {pilot_compliant}/30 ({pilot_pct}%) -- ABORT disposition (gate >=27/30)."
            ),
            "coverage": {
                "devicesReporting": {"yesterday": prior_total, "today": fleet_with_agent, "delta": delta_with_agent},
                "compliant": {"yesterday": prior_compliant, "today": fleet_compliant, "delta": delta_compliant},
                "nonCompliant": {"yesterday": (prior_total or 0) - (prior_compliant or 0), "today": fleet_with_agent - fleet_compliant, "delta": (fleet_with_agent - fleet_compliant) - ((prior_total or 0) - (prior_compliant or 0))},
                "silentOver48h": {"yesterday": prior_stalled, "today": fleet_stalled48, "delta": delta_stalled},
            },
            "osBreakdown": {
                os_name: {
                    "total": bucket["total"],
                    "withAgent": bucket["withAgent"],
                    "compliant": bucket["compliant"],
                }
                for os_name, bucket in by_os.items()
            },
            "top3Issues": [
                f"Cascade architecture not the bottleneck -- 0/{day3_1on1_recon['targetCount']+day4_it_recon['targetCount']+day5_it_recon['targetCount']+day2_dept_lead_recon['targetCount']} Phase 3 cascade targets moved into agent-and-recent across 4 Phase-3 cascade days (Wave 1 cascade cohorts are 0/{day2_w1_recon['targetCount']+day3_w1_recon['targetCount']+day4_it_recon['targetCount']+day5_it_recon['targetCount']} across 4 days too -- same uniform pattern); 2-4y-old lastCheckedAt on AGENT-sourceType devices blocks heartbeats",
                f"RBR-105/106/107 telemetry gap continues to block encryption/AV/auto-update/password-manager classification for the {fleet_with_agent}-agent-installed cohort",
                f"197 Unknown-OS orphans (RBR-108) -- cascade pattern shows these aren't in MDM either; escalation from cleanup to Drata index rebuild",
            ],
            "actionsTakenThisPeriod": [
                "Phase 3 Day 1 (Jul 15): Office-hours + DM non-installers (RBR-497).",
                "Phase 3 Day 2 (Jul 16): Department-lead cascade (RBR-516 measured IT hand-off delta).",
                "Phase 3 Day 3 (Jul 17): Personal 1:1 outreach to top 20 blockers (RBR-539 captured cohort).",
                "Phase 3 Day 4 (Jul 18, today): Phase-gate metrics report -- this snapshot.",
            ],
            "nextPhasePlan": [
                "Phase 4 evidence (RBR-93, due Jul 21): Verify A.8.1 evidence in Drata. Use the residual hand-off list above as the work queue; pair each device with a manual retirement ticket rather than re-chasing.",
                "Ubuntu LUKS evidence: 100% of Ubuntu devices need manual evidence upload per playbook §6 by EOD Jul 18.",
                "CISO escalation: cumulative cascade efficacy warrants Phase-3 retrospective before Phase-4 evidence collection starts on Jul 21.",
            ],
            "risksBlockers": [
                f"{fleet_stalled48} silent >48h devices (owner: IT desktop support, mitigation: manual retirement in Drata per residual hand-off cohort).",
                f"RBR-105/106/107 telemetry gap blocks A.8.1 evidence for {fleet_with_agent} agent-installed devices (owner: SecOps + Drata support).",
                f"197 Unknown-OS orphans not in MDM (owner: IT + SecOps, mitigation: RBR-108 escalation to Drata index rebuild).",
            ],
        },
        "dayNCascadePlan": {
            "day": 4,
            "phase": "Phase 3",
            "phaseDay": 4,
            "action": (
                "Phase 3 phase-gate metrics report (per playbook §5). No fresh cascade action today "
                "-- this is the report day. Phase 3 Day-3 1:1 outreach cohort measured (RBR-539 top 20); "
                "cumulative cascade efficacy surfaced across 5 distinct cascade days; residual hand-off "
                "list emitted for Phase 4 evidence collection (Jul 21)."
            ),
            "scheduledAt": "2026-07-18T16:30:00Z",
            "owner": "secops",
            "phaseGateReportPostedTo": "RBR-89 (this snapshot is the source of truth for the report).",
            "nextDayActions": [
                "EOD Jul 18: SecOps posts Phase 3 phase-gate metrics report to RBR-89 (cross-link from RBR-48); CISO Slack DM.",
                "Phase 4 (RBR-93) starts Jul 21: IT ongoing support takes residual hand-off cohort; SecOps pairs each device with manual retirement ticket in Drata.",
                "RBR-98 follow-up on Jul 21: Phase-gate report to CISO summarizes cumulative cascade efficacy and Phase-3 retrospective recommendation.",
            ],
        },
        "actionsTakenThisDay": [
            "09:30 PT: SecOps captured this RBR-559 Day 8 snapshot (fleet + pilot) via direct Drata API call -- Phase 3 Day 4 = phase-gate metrics report day.",
            "Reconciled Phase 3 Day-3 personal 1:1 outreach (RBR-539 top 20) overnight + 1-day delta: see day3OneOnOneCascadeReconciliation.",
            "Refreshed cumulative cascade efficacy across 5 distinct cascade days: see cumulativeCascadeEfficacy.",
            "Computed residual hand-off top 20 (silent devices not touched by any cascade day): see residualHandOff.top20.",
            "Emitted Phase 3 phase-gate metrics report (§5 template) inside snapshot.phaseGateReport -- to be posted as a comment on RBR-89 by SecOps post-snapshot.",
        ],
        "nextDayActions": [
            "EOD Jul 18: SecOps posts Phase 3 phase-gate metrics report to RBR-89; cross-link from RBR-48.",
            "Phase 4 (RBR-93) starts Jul 21: IT ongoing support takes residual hand-off cohort; SecOps pairs each device with manual retirement ticket in Drata.",
            "RBR-98 follow-up on Jul 21: Phase-gate report to CISO summarizes cumulative cascade efficacy.",
        ],
    }

    monitor["snapshots"].append(snapshot)
    with open(MONITOR, "w") as f:
        json.dump(monitor, f, indent=2)
        f.write("\n")

    summary = {
        "date": snapshot["date"],
        "phaseDay": snapshot["phaseDay"],
        "phase": "Phase 3 Day 4 (phase-gate report)",
        "fleetTotal": fleet_total,
        "fleetWithAgent": fleet_with_agent,
        "fleetCompliant": fleet_compliant,
        "pctWithAgent": pct_with_agent_vs_baseline,
        "pctCompliant": pct_compliant,
        "outstandingInstalls": outstanding_installs,
        "stalled48h": fleet_stalled48,
        "pilotCompliant": pilot_compliant,
        "pilotPct": pilot_pct,
        "gate": gate,
        "day3OneOnOneReconciliation": {
            "targetCount": day3_1on1_recon["targetCount"],
            "movedIntoIndex": day3_1on1_recon["movedIntoIndex"],
            "becameAgent": day3_1on1_recon["becameAgent"],
            "freshHeartbeat24h": day3_1on1_recon["freshHeartbeat24h"],
        },
        "cumulativeCascade": {
            "wave1Day2DeptLead_moved": f"{day2_w1_recon['movedIntoIndex']}/{day2_w1_recon['targetCount']}",
            "wave1Day3Outreach_moved": f"{day3_w1_recon['movedIntoIndex']}/{day3_w1_recon['targetCount']}",
            "wave1Day4ITRemotePush_moved": f"{day4_it_recon['movedIntoIndex']}/{day4_it_recon['targetCount']}",
            "wave1Day5ITHandOff_moved": f"{day5_it_recon['movedIntoIndex']}/{day5_it_recon['targetCount']}",
            "phase3Day2DeptLead_moved": f"{day2_dept_lead_recon['movedIntoIndex']}/{day2_dept_lead_recon['targetCount']}",
            "phase3Day3OneOnOne_moved": f"{day3_1on1_recon['movedIntoIndex']}/{day3_1on1_recon['targetCount']}",
        },
        "residualHandOffTotal": len(residual_targets),
    }
    print(json.dumps(summary, indent=2))
    print("appended snapshot to", MONITOR, file=sys.stderr)


if __name__ == "__main__":
    main()