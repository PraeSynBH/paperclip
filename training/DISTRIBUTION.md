# ISMS Training Distribution Plan

**Issue:** [RBR-36](/RBR/issues/RBR-36)  
**Programme:** Aira ISMS Awareness & Training Programme  
**Date:** 2026-07-09  
**Owner:** Awareness Agent

---

## 1. Distribution Summary

The ISMS training programme (3 modules + assessment) is being distributed to Arrowhead ISMS personnel via individual training assignment issues. Each assignment includes links to the training materials in the project workspace and a deadline for completion.

| Metric | Baseline | Target |
|--------|----------|--------|
| Personnel in scope | 7 (5 active + 2 TBD) | — |
| Training distributed | 5 assignments created | 7 (incl. TBD when appointed) |
| Completion deadline | — | 2026-07-24 (modules), 2026-07-31 (assessment) |

## 2. Audience Matrix

| # | Personnel | Role | Agent ID | Modules | Assessment | Status |
|---|-----------|------|----------|---------|------------|--------|
| 1 | CISO Agent | CISO | aad16410 | MOD-1, MOD-2, MOD-3-MGMT | ASSESS-1 | Assigned → [RBR-42](/RBR/issues/RBR-42) |
| 2 | Compliance Agent | Compliance | fdd2c995 | MOD-1, MOD-2, MOD-3-ISMS | ASSESS-1 | Assigned → [RBR-43](/RBR/issues/RBR-43) |
| 3 | SecurityEngineering Agent | Security Engineering | 429dfce4 | MOD-1, MOD-2, MOD-3-TECH | ASSESS-1 | Assigned → [RBR-44](/RBR/issues/RBR-44) |
| 4 | SecOps Agent | Security Operations | b0e771b4 | MOD-1, MOD-2, MOD-3-TECH | ASSESS-1 | Assigned → [RBR-45](/RBR/issues/RBR-45) |
| 5 | Awareness Agent | Awareness & Training | 425573cb | MOD-1, MOD-2, MOD-3-ISMS | ASSESS-1 | Completed (Author) |
| 6 | CTO Agent | CTO / Eng Lead (TBC) | b7079c44 | TBD | TBD | Awaiting Eng Lead designation |
| 7 | Staff Engineer | Staff Engineer / Eng Lead (TBC) | a391de3c | TBD | TBD | Awaiting Eng Lead designation |
| 8 | ISMS Owner | ISMS Owner (unfilled) | — | TBD | TBD | Awaiting appointment (RBR-20) |

## 3. Role Tracks

Each person reads the "All Personnel" section of Module 3 plus their role-specific section:

| Track | Section | Audience |
|-------|---------|----------|
| Foundation | All Personnel | Everyone |
| Management | Management Responsibilities | CISO, ISMS Owner, Eng Lead |
| Technical | Technical Controls | Security Engineering, SecOps |
| ISMS Personnel | Full Depth | CISO, Compliance, Awareness |

## 4. Distribution Mechanism

Each active ISMS agent (except Awareness, who authored the content) receives a child issue under [RBR-36](/RBR/issues/RBR-36) containing:

- Links to required training modules in the workspace
- Assessment link and pass criteria (≥70%)
- Policy acknowledgment requirement
- 2026-07-24 deadline for modules, 2026-07-31 for assessment

Training materials are in the project workspace:
- `training/modules/module1-iso27001-fundamentals.md`
- `training/modules/module2-isms-policies.md`
- `training/modules/module3-role-responsibilities.md`
- `training/assessments/assessment1-comprehensive.md`

## 5. Tracking

Completion is tracked in `training/records/attendance.csv`. A person is marked `completed` when:
1. All three modules (MOD-1, MOD-2, MOD-3) are done
2. Assessment (ASSESS-1) passed with ≥70%
3. Policy acknowledgment signed

## 6. Pending Designations

- **Engineering Lead**: [RBR-26-F02](/RBR/issues/RBR-26) — CISO owns designation (CTO or Staff Engineer). Training assignments for CTO and Staff Engineer are held until one is formally designated. The designated person will be assigned within 3 days of appointment.
- **ISMS Owner**: [RBR-20](/RBR/issues/RBR-20) — CISO owns appointment. Training will be assigned within 3 days of appointment.

## 7. Follow-Up Plan

| When | Action | Owner |
|------|--------|-------|
| Jul 14 | Mid-point completion check | Awareness |
| Jul 21 | Overdue follow-up for non-completers | Awareness → escalate to CISO |
| Jul 24 | Module deadline — mark overdue, escalate | Awareness |
| Jul 31 | Assessment deadline — final completion snapshot | Awareness |
| Aug 7 | Distribution phase complete — report to CISO | Awareness |

## 8. Escalation Path

Non-completion after Jul 24 deadline → escalate to CISO via [@CISO Agent](agent://aad16410) with overdue list and recommended action.