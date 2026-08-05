#!/usr/bin/env python3
"""
RBR-633 daily 09:30 PT snapshot (Jul 29, Day 19).

Day 19 — Tuesday Jul 29, POST-AUDIT.
This is the first post-audit snapshot after the Jul 28 ISO 27001 Stage 1 audit.
Key questions for today:
  - Has the isDeviceCompliant null regression resolved? (was 85 true on Jul 26, 0 on Jul 28)
  - Any auditor feedback requiring action?
  - Has Drata index changed (IT retirement processing)?
  - A.8.7/A.8.8 telemetry still null fleet-wide?

Per playbook §3.3, post-audit Day 1 actions:
  - Capture fleet + pilot snapshot (same format as prior daily snapshots).
  - Reconcile against Jul 28 (RBR-631) for day-over-day delta.
  - Assess post-audit state: is Drata regression resolved? Any auditor findings?
  - Continue cumulative cascade efficacy readout.
  - Check Drata index for retirement ticket impact.

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
DAILY_FILE = f"{WORKSPACE}/data/evidence/daily-enrollment-2026-07-29.json"
HISTORY_FILE = f"{WORKSPACE}/data/evidence/enrollment-history.jsonl"


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
    fleet_drata_compliant = 0  # isDeviceCompliant flag from Drata
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
        # Check Drata's own isDeviceCompliant flag
        if d.get("isDeviceCompliant") is True:
            fleet_drata_compliant += 1
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
        gate = "ABORT (Phase 1 EOD Jul 11 report; no change at 09:30 PT Jul 29)"

    outstanding_installs = sum(1 for d in devices if d.get("sourceType") != "AGENT")

    # ------------------------------------------------------------------
    # Data reconciliation vs Jul 28 (RBR-631 audit day snapshot)
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

    # Retirement ticket impact check
    retirement_note = ""
    if delta_index < 0:
        retirement_note = f"Drata index shrunk by {abs(delta_index)} devices -- IT retirement tickets are taking effect."
    elif delta_index == 0:
        retirement_note = "Drata index unchanged -- no retirement tickets processed yet by IT."
    else:
        retirement_note = f"Drata index grew by {delta_index} devices -- new devices enrolled or index re-expanded."

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
    # Residual hand-off
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

    # ------------------------------------------------------------------
    # Post-audit assessment (A.8.1, A.8.7, A.8.8)
    # ------------------------------------------------------------------
    agent_devices = [d for d in devices if d.get("sourceType") == "AGENT"]
    evidence_a8_1 = {
        "control": "A.8.1 — User endpoint devices",
        "devicesWithAgent": len(agent_devices),
        "devicesWithRecentHeartbeat": fleet_recent24,
        "devicesCompliantStrict": fleet_compliant,
        "drataFlagCompliant": fleet_drata_compliant,
        "coveragePct": round(fleet_compliant / baseline_total * 100, 1) if baseline_total else 0,
        "gaps": [
            f"{fleet_stalled48} agent-installed devices stalled >48h (need heartbeat or Drata retirement)",
            f"{outstanding_installs} devices without agent installed",
            f"{by_os['Unknown']['total']} Unknown-OS orphans (RBR-108)",
        ],
    }
    evidence_a8_7 = {
        "control": "A.8.7 — Protection against malware",
        "devicesReportingAntimalware": control_failure["Anti-malware enabled"]["passing"],
        "devicesFailingAntimalware": control_failure["Anti-malware enabled"]["failing"],
        "devicesAntimalwareUnknown": control_failure["Anti-malware enabled"]["unknown"],
        "gaps": [
            f"{control_failure['Anti-malware enabled']['unknown']} agent devices with null antimalware telemetry (RBR-105)",
        ],
    }
    evidence_a8_8 = {
        "control": "A.8.8 — Management of technical vulnerabilities",
        "devicesReportingAutoUpdate": control_failure["OS auto-update enabled"]["passing"],
        "devicesFailingAutoUpdate": control_failure["OS auto-update enabled"]["failing"],
        "devicesAutoUpdateUnknown": control_failure["OS auto-update enabled"]["unknown"],
        "gaps": [
            f"{control_failure['OS auto-update enabled']['unknown']} agent devices with null auto-update telemetry (RBR-105)",
        ],
    }

    # ------------------------------------------------------------------
    # Post-audit regression check: isDeviceCompliant
    # ------------------------------------------------------------------
    drata_compliant_null_count = sum(1 for d in devices if d.get("isDeviceCompliant") is None)
    drata_compliant_true_count = fleet_drata_compliant
    drata_compliant_false_count = sum(1 for d in devices if d.get("isDeviceCompliant") is False)
    regression_status = "RESOLVED" if drata_compliant_true_count > 0 and drata_compliant_null_count == 0 else (
        "PARTIALLY RESOLVED" if drata_compliant_true_count > 0 and drata_compliant_null_count > 0 else
        "UNRESOLVED" if drata_compliant_null_count > 0 else "UNKNOWN"
    )

    snapshot = {
        "date": "2026-07-29",
        "phaseDay": 19,
        "phase1PilotDay": 19,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "capturedBy": "secops",
        "capturedFor": "RBR-633 daily 09:30 PT snapshot — Day 19 (Post-Audit Day 1). First snapshot after Jul 28 ISO 27001 Stage 1 audit.",
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
        "drataComplianceFlag": {
            "trueCount": drata_compliant_true_count,
            "falseCount": drata_compliant_false_count,
            "nullCount": drata_compliant_null_count,
            "regressionStatus": regression_status,
            "note": (
                f"isDeviceCompliant regression: {regression_status}. "
                f"Jul 26: 85 true / 0 null. Jul 28: 0 true / 626 null (Drata regression). "
                f"Jul 29: {drata_compliant_true_count} true / {drata_compliant_null_count} null."
            ),
        },
        "topIssues": [
            f"Day 19 — Post-Audit Day 1. Cumulative cascade efficacy: {total_moved}/{total_cascade_targets} across 6 cascade days (unchanged).",
            f"Fleet strict-compliant count {fleet_compliant}/{baseline_total} ({pct_compliant}%); delta vs Jul 28: agent {delta_with_agent:+d}, compliant {delta_compliant:+d}.",
            f"isDeviceCompliant regression: {regression_status}. Jul 26=85 true, Jul 28=0 true (null fleet-wide), Jul 29={drata_compliant_true_count} true.",
            f"Phase 4 evidence focus: A.8.1 ({evidence_a8_1['devicesCompliantStrict']} strict-compliant), A.8.7 ({evidence_a8_7['devicesReportingAntimalware']} antimalware-pass), A.8.8 ({evidence_a8_8['devicesReportingAutoUpdate']} autoupdate-pass).",
            f"Residual hand-off cohort: {len(residual_targets)} silent devices not touched by any cascade day. {retirement_note}",
            f"{by_os['Unknown']['total']} Unknown-OS orphans — RBR-108 status review.",
        ],
        "dataReconciliation": {
            "priorSnapshot": "2026-07-28 (RBR-631 audit day Day 18 snapshot)",
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
            "note": f"Day-over-day delta vs RBR-631 (Jul 28 audit day). Post-Audit Day 1 snapshot. {retirement_note}",
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
                "bottleneck, not cascade architecture. Post-Audit Day 1: monitor IT Drata retirement progress."
            ),
        },
        "residualHandOff": {
            "phase": "Post-Audit — IT continues manual Drata retirement + CISO addresses audit findings",
            "owner": "IT desktop support (manual Drata retirement tickets) + CISO (audit findings + Drata regression escalation) + SecOps (evidence verification)",
            "totalResidual": len(residual_targets),
            "top20": residual_top20,
            "note": (
                f"{len(residual_targets)} silent devices not touched by any cascade day. "
                f"Post-Audit Day 1: {retirement_note}"
            ),
        },
        "postAuditAssessment": {
            "auditDate": "2026-07-28",
            "daysSinceAudit": 1,
            "phase4EvidenceReadiness": {
                "phase4StartDate": "2026-07-21",
                "evidenceWindowEnd": "2026-07-28 (ISO 27001 Stage 1 audit — COMPLETED)",
                "daysRemaining": 0,
                "a8_1_endpointDevices": evidence_a8_1,
                "a8_7_antimalware": evidence_a8_7,
                "a8_8_vulnerabilityManagement": evidence_a8_8,
                "blockingIssues": {
                    "RBR-98": "Phase 4: Verify A.8.1/A.8.7/A.8.8 evidence in Drata -- blocked",
                    "RBR-105": "Drata Agent telemetry gap (anti-malware, auto-update, password-manager nulls) -- blocked",
                    "RBR-106": "Host firewall on 110 non-compliant devices -- blocked",
                    "RBR-107": "Disk encryption on 3 non-compliant macOS -- blocked",
                    "RBR-108": "Unknown-OS devices in Drata -- todo",
                },
            },
            "auditStatus": "Stage 1 audit occurred Jul 28. Post-audit findings pending.",
            "isDeviceCompliantRegression": {
                "status": regression_status,
                "jul26": "85 true / 0 null / rest false",
                "jul28": "0 true / 626 null (Drata regression)",
                "jul29": f"{drata_compliant_true_count} true / {drata_compliant_null_count} null / {drata_compliant_false_count} false",
                "action": "CISO escalation to Drata support required if UNRESOLVED",
            },
            "recommendation": (
                "Post-Audit Day 1 actions: (1) CISO escalate isDeviceCompliant null regression to Drata support. "
                "(2) Obtain auditor feedback/findings from Jul 28 Stage 1 audit. "
                "(3) IT continue device retirement processing for stalled devices. "
                "(4) If audit identified corrective actions on A.8.1/A.8.7/A.8.8, create remediation issues."
            ),
        },
        "dayNCascadePlan": {
            "day": 0,
            "phase": "Post-Audit monitoring",
            "phaseDay": 19,
            "action": (
                "Post-Audit Day 1 — monitor fleet state after Jul 28 Stage 1 audit. "
                "No cascade outreach today (all cascade days exhausted, 0/150 cumulative efficacy). "
                "Focus: CISO Drata regression escalation, auditor findings follow-up, IT retirement progress."
            ),
            "scheduledAt": now.isoformat().replace("+00:00", "Z"),
            "owner": "secops (evidence + monitoring) + CISO (Drata escalation + audit findings) + IT (device retirement)",
            "nextDayActions": [
                "Jul 30 (Wed): Post-Audit Day 2 — check for auditor findings, continue Drata regression tracking.",
                "If auditor issued corrective actions, create remediation issues for A.8.1/A.8.7/A.8.8 gaps.",
            ],
        },
        "actionsTakenThisDay": [
            f"09:30 PT: SecOps captured this RBR-633 Day 19 snapshot (fleet + pilot) via direct Drata API call — Post-Audit Day 1.",
            "Reconciled day-over-day delta vs RBR-631 (Jul 28 audit day).",
            "Refreshed cumulative cascade efficacy across 6 cascade days.",
            "Updated residual hand-off count for IT retirement queue.",
            "Checked Drata index for retirement ticket impact.",
            f"Checked isDeviceCompliant regression status: {regression_status} (true={drata_compliant_true_count}, null={drata_compliant_null_count}).",
            "Emitted post-audit evidence assessment (A.8.1, A.8.7, A.8.8).",
        ],
        "nextDayActions": [
            "Jul 30: Post-Audit Day 2 — check for auditor findings.",
            "If Drata regression unresolved, re-escalate to CISO.",
            "Continue IT retirement monitoring.",
        ],
    }

    monitor["snapshots"].append(snapshot)
    # Update rollout section for current phase
    monitor["rollout"] = {
        "phase": f"Post-Audit monitoring (Day 19)",
        "owningIssueId": "a686b3d4-cd17-409a-9b53-ae8e988d69c8",
        "owningIssueIdentifier": "RBR-633",
        "parentIssueId": "69edf21a-3194-41be-800e-d6ac7df967d8",
        "kickoffDate": "2026-07-10",
        "gateDate": "2026-07-28",
        "targetEnrollPctByGate": 90,
        "baselineEnrollPct": pct_with_agent,
    }
    with open(MONITOR, "w") as f:
        json.dump(monitor, f, indent=2)
        f.write("\n")

    # Write daily summary file
    daily_summary = {
        "snapshotAt": now.isoformat().replace("+00:00", "Z"),
        "total": fleet_total,
        "withAgent": fleet_with_agent,
        "compliant": fleet_compliant,
        "recentlyChecked": fleet_recent24,
        "stalled": fleet_stalled48,
        "pctWithAgent": str(pct_with_agent),
        "pctCompliant": str(pct_compliant),
        "drataFlagCompliant": fleet_drata_compliant,
        "drataFlagNull": drata_compliant_null_count,
        "byOS": dict(by_os),
        "outstandingInstalls": outstanding_installs,
    }
    with open(DAILY_FILE, "w") as f:
        json.dump(daily_summary, f, indent=2)
        f.write("\n")

    # Append to enrollment history
    history_entry = {
        "snapshotAt": now.isoformat().replace("+00:00", "Z"),
        "total": fleet_total,
        "withAgent": fleet_with_agent,
        "compliant": fleet_compliant,
        "recentlyChecked": fleet_recent24,
        "stalled": fleet_stalled48,
        "pctWithAgent": str(pct_with_agent),
        "pctCompliant": str(pct_compliant),
        "byOS": {k: {"total": v["total"], "withAgent": v["withAgent"], "compliant": v["compliant"], "reportingLast24h": v["reportingLast24h"]} for k, v in by_os.items()},
        "outstandingInstalls": outstanding_installs,
    }
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(history_entry) + "\n")

    summary = {
        "date": snapshot["date"],
        "phaseDay": snapshot["phaseDay"],
        "phase": "Post-Audit Day 1 (Day 19)",
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
        "deltaVsJul28": {
            "withAgent": delta_with_agent,
            "compliant": delta_compliant,
            "drataIndex": delta_index,
            "stalled48h": delta_stalled,
            "recent24h": delta_recent24,
        },
        "cumulativeCascade": f"{total_moved}/{total_cascade_targets}",
        "residualHandOffTotal": len(residual_targets),
        "retirementImpact": retirement_note,
        "drataComplianceFlag": {
            "trueCount": drata_compliant_true_count,
            "nullCount": drata_compliant_null_count,
            "regressionStatus": regression_status,
        },
        "postAuditEvidence": {
            "a8_1_compliant": fleet_compliant,
            "a8_7_antimalwarePass": control_failure["Anti-malware enabled"]["passing"],
            "a8_8_autoUpdatePass": control_failure["OS auto-update enabled"]["passing"],
        },
    }
    print(json.dumps(summary, indent=2))
    print(f"appended snapshot to {MONITOR}", file=sys.stderr)
    print(f"wrote daily summary to {DAILY_FILE}", file=sys.stderr)
    print(f"appended to history at {HISTORY_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
