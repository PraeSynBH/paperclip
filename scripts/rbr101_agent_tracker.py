#!/usr/bin/env python3
"""Drata Agent Distribution Tracker — RBR-101

Queries Drata API for current employee list and device compliance status.
Produces a tracking report of:
  - Employees with/without agent on all their devices
  - Device compliance field breakdown
  - Coverage and compliance percentages

Run: python3 scripts/rbr101_agent_tracker.py
"""

import json, os, sys
from datetime import datetime, timezone
from pathlib import Path

import requests

API_KEY = os.environ["DRATA_API_KEY"]
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"}
BASE = "https://public-api.drata.com/public/v2"

ROOT = Path(__file__).resolve().parent.parent
REPORT_DIR = ROOT / "data" / "evidence"
REPORT_DIR.mkdir(parents=True, exist_ok=True)


def paginate(endpoint, limit=100):
    """Fetch all pages of a Drata collection endpoint."""
    all_records = []
    cursor = None
    while True:
        url = f"{BASE}/{endpoint}?limit={limit}"
        if cursor:
            url += f"&cursor={cursor}"
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        data = r.json()
        records = data.get("data", [])
        if not records:
            break
        all_records.extend(records)
        cursor = data.get("pagination", {}).get("cursor")
        if not cursor:
            break
    return all_records


def main():
    now = datetime.now(timezone.utc).isoformat()

    # Fetch all personnel, users, devices
    personnel = paginate("personnel")
    users = paginate("users")
    devices = paginate("devices")

    # Build user map
    user_map = {u["id"]: u for u in users}

    # Current employees
    current = [p for p in personnel if p.get("employmentStatus") == "CURRENT_EMPLOYEE"]

    # Map personnel -> devices
    personnel_devices = {}
    for d in devices:
        pid = d.get("personnelId")
        if pid not in personnel_devices:
            personnel_devices[pid] = {"agent": 0, "unknown": 0, "total": 0, "compliant": 0}
        personnel_devices[pid]["total"] += 1
        if d.get("sourceType") == "AGENT":
            personnel_devices[pid]["agent"] += 1
            # Check if compliant (all key fields true/non-null)
            is_compliant = (
                d.get("encryptionEnabled") is True
                and d.get("firewallEnabled") is True
                and d.get("screenLockTime") is not None and d.get("screenLockTime") != False
            )
            if is_compliant:
                personnel_devices[pid]["compliant"] += 1
        else:
            personnel_devices[pid]["unknown"] += 1

    # Classify employees
    no_agent = []
    partial_agent = []
    fully_covered = []

    for p in current:
        uid = p.get("userId")
        user = user_map.get(uid, {})
        email = user.get("email", "unknown")
        name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or email
        devs = personnel_devices.get(p["id"], {"agent": 0, "unknown": 0, "total": 0, "compliant": 0})
        entry = {"personnel_id": p["id"], "user_id": uid, "email": email, "name": name, "devices": devs}
        if devs["agent"] == 0:
            no_agent.append(entry)
        elif devs["unknown"] > 0:
            partial_agent.append(entry)
        else:
            fully_covered.append(entry)

    # Compliance field breakdown (agent devices only)
    agent_devices = [d for d in devices if d.get("sourceType") == "AGENT"]
    field_status = {}
    for field in ["encryptionEnabled", "firewallEnabled", "screenLockTime",
                  "antivirusEnabled", "autoUpdateEnabled", "passwordManagerEnabled"]:
        field_status[field] = {
            "true": sum(1 for d in agent_devices if d.get(field) is True),
            "false": sum(1 for d in agent_devices if d.get(field) is False),
            "null": sum(1 for d in agent_devices if d.get(field) is None),
        }

    # OS breakdown
    os_counts = {}
    for d in agent_devices:
        os_ver = d.get("osVersion", "Unknown") or "Unknown"
        if "Windows" in os_ver:
            os_counts["Windows"] = os_counts.get("Windows", 0) + 1
        elif "macOS" in os_ver or "Mac OS X" in os_ver:
            os_counts["macOS"] = os_counts.get("macOS", 0) + 1
        elif "Ubuntu" in os_ver or "Linux" in os_ver:
            os_counts["Linux"] = os_counts.get("Linux", 0) + 1
        else:
            os_counts["Other"] = os_counts.get("Other", 0) + 1

    total_devices = len(devices)
    agent_count = len(agent_devices)
    unknown_count = len([d for d in devices if d.get("sourceType") == "UNKNOWN"])

    # Build report
    report = {
        "timestamp": now,
        "issue": "RBR-101",
        "summary": {
            "total_devices": total_devices,
            "agent_installed": agent_count,
            "no_agent_unknown": unknown_count,
            "coverage_pct": round(agent_count / total_devices * 100, 1) if total_devices else 0,
            "current_employees": len(current),
            "no_agent_employees": len(no_agent),
            "partial_agent_employees": len(partial_agent),
            "fully_covered_employees": len(fully_covered),
        },
        "os_breakdown": os_counts,
        "compliance_field_status": field_status,
        "no_agent_employees": no_agent,
        "partial_agent_employees": partial_agent,
    }

    # Save JSON report
    report_path = REPORT_DIR / "rbr101-agent-tracker.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    # Also append to CSV log
    csv_path = REPORT_DIR / "rbr101-compliance-log.csv"
    if not csv_path.exists():
        csv_path.write_text("date,total_devices,agent_installed,coverage_pct,current_employees,no_agent_employees,fully_covered_employees\n")
    with open(csv_path, "a") as f:
        f.write(f"{now[:10]},{total_devices},{agent_count},{report['summary']['coverage_pct']},{len(current)},{len(no_agent)},{len(fully_covered)}\n")

    # Print summary
    print(f"=== RBR-101 Drata Agent Distribution Tracker ===")
    print(f"Date: {now[:10]}")
    print(f"")
    print(f"Devices: {agent_count}/{total_devices} have agent ({report['summary']['coverage_pct']}%)")
    print(f"Employees: {len(fully_covered)}/{len(current)} fully covered, {len(no_agent)} need agent")
    print(f"")
    print(f"No-agent employees ({len(no_agent)}):")
    for e in no_agent:
        print(f"  {e['name']} <{e['email']}> (devices: agent={e['devices']['agent']}, unknown={e['devices']['unknown']})")
    print(f"")
    print(f"Compliance field gaps (agent devices):")
    for field, counts in field_status.items():
        if counts["null"] > 0 or counts["false"] > 0:
            print(f"  {field}: {counts['null']} null, {counts['false']} false, {counts['true']} true")
    print(f"")
    print(f"Report saved to: {report_path}")
    print(f"CSV log: {csv_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
