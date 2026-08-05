# IOA Independent Verification — Silent Run Trace

**Verification of:** SecurityEngineering compliance monitor traceability for RBR-251 silent run
**IOA Run:** `9d07894e-ac73-4180-982d-9682f921ecb3`
**Date:** 2026-07-10
**Phase:** 0 — SHADOW / ADVISORY
**Issues:** [RBR-396](/RBR/issues/RBR-396) parent, [RBR-251](/RBR/issues/RBR-251) source, [RBR-336](/RBR/issues/RBR-336) CEO productivity review

> *"This finding is pre-tamper-evidence: the IOA currently detects honest mistakes and misconfiguration, not a competent adversarial CISO. Tamper-evident assurance requires the RAM-33 substrate."*

---

## 1. Audit-Trail Cross-Check

### Scope
Confirm the same `PAPERCLIP_RUN_ID` is embedded in GitHub Actions log, Paperclip run record, `snapshots/YYYY-MM-DD.json.meta`, and `docs/weekly-compliance-digest.md`.

### Artifacts Examined

| Artifact | Path | Run ID Found | Source |
|----------|------|-------------|--------|
| Latest snapshot | `Aira-ISO27001/snapshots/2026-07-11.json` | `1d96a596-1cf8-475a-8b2b-3e88e240b8cb` | Drata API (`meta.run_id`) |
| Certification data | `Aira-ISO27001/iso27001-certification-data.json` | `1d96a596-1cf8-475a-8b2b-3e88e240b8cb` | Drata API (`meta.run_id`) |
| Weekly digest | `Aira-ISO27001/docs/weekly-compliance-digest.md` | **NONE** | No run ID embedded |
| Metadata sidecar | `Aira-ISO27001/iso27001-certification-data.json.meta` | **MISSING** | File does not exist |
| Workflow def | `Aira-ISO27001/.github/workflows/compliance-monitor.yml` | **NOT SET** | `PAPERCLIP_RUN_ID` env var not configured |
| Monitor script | `Aira-ISO27001/monitor_iso27001_compliance.py` | `"manual"` (fallback) | Reads `PAPERCLIP_RUN_ID` from env; workflow never sets it |
| Paperclip run | SecurityEngineering (429dfce4) | **UNAVAILABLE** | API route not found; run lookup not possible |
| CISO review doc | `docs/securityengineering-silent-run-review.md` | `1b31d0ac` (CISO's doc run) | Self-reported; not independently verifiable |

### Finding IOA-006 (High): PAPERCLIP_RUN_ID not propagated through pipeline

**Evidence:**
1. `compliance-monitor.yml` (lines 102-117) does **not** set `PAPERCLIP_RUN_ID` in the monitor job's `env` block.
2. `monitor_iso27001_compliance.py` (line 27) reads `PAPERCLIP_RUN_ID` from the environment but falls back to `"manual"` when absent.
3. The `meta.run_id` value (`1d96a596`) in the snapshot JSON originates from the Drata API, **not** from Paperclip's run system.
4. There is no way to link a specific Paperclip SecurityEngineering run to the snapshot/digest artifacts it produced.

**Impact:** The traceability chain is broken at its first link. The GitHub Actions run, the Paperclip run, and the artifact metadata are not cross-referenced. This blocks independent tamper-evidence verification.

---

## 2. Tamper-Evident Review

### Scope
Confirm the snapshot JSON, the digest markdown, and the metadata file are not modified after the run completes. Raise follow-up if checksum/signature missing.

### Findings

**No cryptographic integrity on any artifact.**

| Artifact | SHA-256 | Checksum Embedded? | Signature? |
|----------|---------|-------------------|------------|
| `snapshots/2026-07-11.json` | `568567e0...6a4a0300` | No | No |
| `docs/weekly-compliance-digest.md` | `c95c8ec3...11fbc20` | No | No |
| `iso27001-certification-data.json` | (not computed) | No | No |
| `iso27001-certification-data.json.meta` | **MISSING** | N/A | N/A |

**File modification timestamps (cannot prove immutability):**

| File | Last Modified |
|------|--------------|
| `snapshots/2026-07-09.json` | Jul 9 16:23 |
| `snapshots/2026-07-10.json` | Jul 9 19:04 |
| `snapshots/2026-07-11.json` | Jul 10 21:23 |
| `docs/weekly-compliance-digest.md` | Jul 10 21:20 |
| `iso27001-certification-data.json` | Jul 9 20:39 |

Timestamps are consistent with their generation dates, but without cryptographic hashes or signatures, post-run modification cannot be disproven.

### Finding IOA-007 (High): No tamper-evidence mechanism on any artifact

**Evidence:**
1. The `.meta` sidecar file (`iso27001-certification-data.json.meta`) that should contain `paperclip_run_id` per the script design **does not exist**.
2. The `write_metadata()` function (lines 50-72 of the monitor script) is defined but **never called** from `main()`.
3. No SHA-256, signature, or hash chain is embedded in any artifact.
4. The workflow uploads artifacts to GitHub Actions (retention 90 days) but does not pin hashes or create a manifest.

**Impact:** Without a hash-pinned artifact manifest or a signed metadata sidecar, the IOA cannot prove these files were not modified after the run completed. This is a prerequisite for tamper-evidence in a non-tamper-evident storage medium (git repo).

---

## 3. Stage Log Completeness

### Scope
Spot-check stage banners (start, snapshot, digest, metadata) match the run log timestamps.

### Finding IOA-008 (Medium): Stage banner functions exist but are never invoked

**Evidence:**
1. `log_stage()` function (line 35) and `log_done()` function (line 45) are defined in `monitor_iso27001_compliance.py`.
2. Neither function is called from `main()` (lines 393-452). The script uses bare `print()` statements instead.
3. Because the stage banners are never emitted, the GitHub Actions workflow log cannot be searched for the canonical `PAPERCLIP_RUN_ID` at each stage boundary — even if the run ID were correctly set (which per IOA-006 it is not).

**Impact:** Stage log completeness cannot be independently verified. The stage banner instrumentation exists in code but is not wired to the main execution path. This is a latent bug, not a runtime gap — but it means the current run logs lack the structured trace points required by the tamper-evidence model.

---

## 4. Gap Summary

| ID | Severity | Gap | Owner | 
|----|----------|-----|-------|
| IOA-006 | High | `PAPERCLIP_RUN_ID` not propagated from Paperclip → workflow → artifacts | SecurityEngineering |
| IOA-007 | High | No `.meta` sidecar; no hash/signature on any artifact; `write_metadata()` never called | SecurityEngineering |
| IOA-008 | Medium | `log_stage()`/`log_done()` functions defined but never wired into `main()` | SecurityEngineering |

---

## 5. Disposition

**Trace is NOT clean.** Three gaps (2 high, 1 medium) must be resolved before the IOA can confirm traceability. The IOA cannot sign off on RBR-251 closure until:

1. `PAPERCLIP_RUN_ID` is injected by the workflow and flows from Paperclip through the pipeline to all artifacts.
2. `write_metadata()` is wired into `main()` and produces a `.meta` sidecar with `paperclip_run_id`, SHA-256 of artifacts, and generation timestamp.
3. `log_stage()` / `log_done()` stage banners are wired into `main()` so the GitHub Actions log contains structured trace points.
4. A new compliance monitor run completes with all three integrations active.
5. The IOA re-verifies the trace against the new run.

**Next action:** Create three child issues from [RBR-396](/RBR/issues/RBR-396) assigned to SecurityEngineering for IOA-006, IOA-007, and IOA-008. Re-verify after fixes land.

---

*Generated by IOA (168e1f8b), run `9d07894e-ac73-4180-982d-9682f921ecb3`*
*Phase 0 caveat applies — see top of document.*
