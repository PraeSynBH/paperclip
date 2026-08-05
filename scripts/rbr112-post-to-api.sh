#!/bin/bash
# RBR-112: Post AI governance control mapping and create child issues for findings F04-F11
# Execute this when Paperclip API is reachable

set -euo pipefail

API_URL="${PAPERCLIP_API_URL:-http://macbook.praesyn.int:3100}"
API_KEY="${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY not set}"
RUN_ID="${PAPERCLIP_RUN_ID:-4010c0c0-35d9-45b6-bb86-de7d4a7592e9}"
COMPANY_ID="${PAPERCLIP_COMPANY_ID:-5cb37f67-a875-4073-ba4f-f8f942cb0775}"
AGENT_ID="${PAPERCLIP_AGENT_ID:-fdd2c995-c225-4885-bbf3-5f21781d5069}"
ISSUE_ID="66a6ad2b-17de-4662-a473-2ab9dc5046b2"

AUTH_HEADER="Authorization: Bearer $API_KEY"
RUN_HEADER="X-Paperclip-Run-Id: $RUN_ID"

echo "=== Step 1: Post mapping document to RBR-112 ==="

jq -n --arg body "$(cat /Users/benh/paperclip-rambur/Aira/Aira-ISO27001/docs/ai-governance/control-mapping.md)" '{
  title: "AI Governance Control Mapping & Evidence Plan",
  format: "markdown",
  body: $body,
  baseRevisionId: null
}' | curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X PUT "$API_URL/api/issues/$ISSUE_ID/documents/control-mapping" \
  -d @- | python3 -m json.tool

echo ""
echo "=== Step 2: Create 8 child issues for findings F04-F11 ==="

# F04: Export AI policies from Drata (LOW)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F04: Export AI policies from Drata to local workspace",
    "description": "Three AI policies (AI Governance, AI Risk Management, AI System Development and Evaluation) exist only in Drata as ACTIVE. Export to `policies/ai/` for independent audit verification.\n\n- Framework: ISO 42001:2023 A.5.2\n- Severity: LOW\n- Target: Jul 21, 2026\n- Blocked by: RBR-19 (Drata API scopes)\n\nAcceptance: 3 policy files present in `policies/ai/` with content matching Drata ACTIVE policy texts.",
    "priority": "low",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "goalId": null,
    "status": "blocked",
    "blockedByIssueIds": ["e3310366-1be8-4da1-9305-c93b5311b1e7"]
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F04 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

# F05: Cross-reference AI in ISMS policies (MEDIUM)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F05: Cross-reference AI governance in Phase 1 ISMS policies",
    "description": "Phase 1 ISMS policies (8 docs covering 31/82 ISO 27001 controls) do not reference AI governance controls. Update to cross-reference ISO 42001 controls.\n\n- Framework: ISO 42001:2023 A.5.3, ISO 27001:2022 A.5.1\n- Severity: MEDIUM\n- Target: Aug 1, 2026\n- Owner: Compliance + CISO\n\nAcceptance: Updated ISMS policy index showing AI cross-references. 3+ policies updated with AI governance sections.",
    "priority": "medium",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "status": "todo",
    "assigneeAgentId": "fdd2c995-c225-4885-bbf3-5f21781d5069"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F05 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

# F06: AI competence records (MEDIUM)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F06: Develop AI role competency matrix",
    "description": "No AI-specific competence records. ISMS competence records (RBR-26) cover ISO 27001 roles only. Create AI role competency matrix for all 20 agent roles defined in `src/ai/governance.ts`.\n\n- Framework: ISO 42001:2023 A.7.3\n- Severity: MEDIUM\n- Target: Aug 1, 2026\n- Owner: Awareness & Training + CISO\n\nAcceptance: Competency matrix document mapping each of 20 agent roles to AI-specific competencies with evidence of assessment.",
    "priority": "medium",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "status": "todo",
    "assigneeAgentId": "425573cb-6703-47c0-9929-3e13ae6913c8"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F06 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

# F07: AI awareness training (LOW)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F07: Create AI governance awareness training module",
    "description": "No AI governance awareness training module in `training/`. 3 existing modules (phishing, security awareness, micro-learning) do not cover AI governance.\n\n- Framework: ISO 42001:2023 A.7.4\n- Severity: LOW\n- Target: Aug 15, 2026\n- Owner: Awareness & Training\n\nAcceptance: New AI governance training module in training/ with completion tracking.",
    "priority": "low",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "status": "todo",
    "assigneeAgentId": "425573cb-6703-47c0-9929-3e13ae6913c8"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F07 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

# F08: AI impact assessment (HIGH)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F08: Create AI system impact assessment process and template",
    "description": "No formal AI system impact assessment process. Migration fallback thresholds (5% error, 50% latency, 15% parity, 30% cost) are operational, not risk-based. Must be created before Gemini migration cutover (~Jul 30).\n\n- Framework: ISO 42001:2023 A.8.2, A.8.3\n- Severity: HIGH\n- Target: Jul 21, 2026\n- Owner: CISO + Compliance\n\nAcceptance: Impact assessment template + completed assessment for Gemini migration documenting: stakeholders affected, data flows, risk analysis, mitigation measures, residual risk.",
    "priority": "high",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "status": "todo",
    "assigneeAgentId": "fdd2c995-c225-4885-bbf3-5f21781d5069"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F08 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

# F09: AI risk register (MEDIUM)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F09: Implement proactive AI risk register",
    "description": "AI risk assessment is reactive only (guardrails filter threats at runtime via `src/ai/guardrails.ts`). No proactive AI risk register with regular review cadence.\n\n- Framework: ISO 42001:2023 A.8.4\n- Severity: MEDIUM\n- Target: Aug 1, 2026\n- Owner: CISO + Compliance\n\nAcceptance: AI risk register document with: risk ID, description, likelihood, impact, mitigation, owner, review date. Integrated with ISMS risk assessment cycle.",
    "priority": "medium",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "status": "todo",
    "assigneeAgentId": "fdd2c995-c225-4885-bbf3-5f21781d5069"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F09 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

# F10: AI transparency documentation (MEDIUM)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F10: Create AI system description and transparency document",
    "description": "No AI system description or transparency documentation for stakeholders. GCP ISO 42001 attestation applies at IaaS level only, not at Aira'\''s AI integration layer.\n\n- Framework: ISO 42001:2023 A.11.2\n- Severity: MEDIUM\n- Target: Aug 1, 2026\n- Owner: Compliance + CTO\n\nAcceptance: AI system description document covering: system purpose, model providers, data handling, guardrails, limitations, stakeholder info. Publish alongside ISO 27001 SoA.",
    "priority": "medium",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "status": "todo",
    "assigneeAgentId": "fdd2c995-c225-4885-bbf3-5f21781d5069"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F10 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

# F11: AI concern reporting (LOW)
curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/api/companies/$COMPANY_ID/issues" \
  -d '{
    "title": "F11: Add AI concern reporting channel to incident response",
    "description": "Gemini safety filter violations are caught and reported internally (`src/ai/pipeline.ts:183-201`) but no formal external AI concern reporting channel exists.\n\n- Framework: ISO 42001:2023 A.11.3\n- Severity: LOW\n- Target: Aug 15, 2026\n- Owner: SecOps + Compliance\n\nAcceptance: Updated incident response procedure (AIS-ISMS-PRO-002) with AI concern reporting section. Reporting channel operational (Slack, email, or ticketing).",
    "priority": "low",
    "parentId": "66a6ad2b-17de-4662-a473-2ab9dc5046b2",
    "status": "todo",
    "assigneeAgentId": "fdd2c995-c225-4885-bbf3-5f21781d5069"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'F11 child: {d.get(\"id\",\"ERROR\")} - {d.get(\"identifier\",\"?\")}')"

echo ""
echo "=== Step 3: Post completion comment on RBR-112 ==="

jq -n --arg comment "## RBR-112: AI Governance Control Mapping Complete

Mapping document posted: [/RBR/issues/RBR-112#document-control-mapping](/RBR/issues/RBR-112#document-control-mapping)

### Summary

- **Framework:** ISO/IEC 42001:2023 Annex A + ISO/IEC 27001:2022 cross-reference
- **Controls mapped:** 24 of 38 ISO 42001 Annex A controls (14 deferred to Phase 2 for AI system development lifecycle, third-party AI, data provenance)
- **Readiness:** 15/24 MET (62.5% code-level), 18/24 including PARTIAL (75%)
- **ISO 27001 support:** 18+ Annex A controls have direct or indirect evidence from AI governance module
- **Document:** \`Aira-ISO27001/docs/ai-governance/control-mapping.md\` (20KB, 246 lines)

### Control Status

| Status | Count | Controls |
|--------|-------|----------|
| MET | 15 | A.5.4, A.6.2-A.6.4, A.7.2, A.7.5, A.9.2-A.9.5, A.10.2-A.10.4, A.12.2-A.12.4, A.13.2 |
| PARTIAL | 3 | A.5.2, A.5.3, A.7.3 |
| GAP | 6 | A.7.4, A.8.2, A.8.3, A.8.4, A.11.2, A.11.3 |
| N/A | 2 | A.10.5, A.13.3 |

### Findings (8 child issues created)

| Child | Severity | Control | Description | Owner | Target |
|-------|----------|---------|-------------|-------|--------|
| F04 | LOW | A.5.2 | AI policies Drata-only — export to workspace | Compliance | Jul 21 |
| F05 | MEDIUM | A.5.3 | ISMS policies missing AI cross-references | Compliance/CISO | Aug 1 |
| F06 | MEDIUM | A.7.3 | No AI competence records | Awareness/CISO | Aug 1 |
| F07 | LOW | A.7.4 | No AI awareness training | Awareness | Aug 15 |
| F08 | HIGH | A.8.2/A.8.3 | No AI impact assessment | CISO/Compliance | Jul 21 |
| F09 | MEDIUM | A.8.4 | Reactive-only AI risk mgmt | CISO/Compliance | Aug 1 |
| F10 | MEDIUM | A.11.2 | No AI transparency docs | Compliance/CTO | Aug 1 |
| F11 | LOW | A.11.3 | No AI concern reporting | SecOps/Compliance | Aug 15 |

### Top Risk

**HIGH:** Gemini migration proceeding without formal AI impact assessment. Operational thresholds (5% error, 50% latency) are not risk-based. F08 must be completed before cutover (~Jul 30).

### Evidence

- 15 code-level files in \`src/ai/\` providing direct AI governance evidence
- GCP ISO 42001:2023 attested at IaaS level
- All AI API calls pass through secure pipeline with 8 guardrail rules
- 3 AI policies registered in Drata (ACTIVE) — needs local export (F04)

### Status: done

Mapping complete. 8 findings filed as child issues with owners and target dates. PARA memory consolidated. Compliance monitoring begins when child issues are assigned and in progress." '{
  status: "done",
  comment: $comment
}' | curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X PATCH "$API_URL/api/issues/$ISSUE_ID" \
  -d @- | python3 -m json.tool

echo ""
echo "=== Done ==="