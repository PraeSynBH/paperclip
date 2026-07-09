# Training Schedule & Attendance Tracking

**Programme:** Aira ISMS Awareness & Training Programme  
**Initial Rollout:** July 2026  

---

## Training Schedule

| Module | Title | Duration | Target Audience | Deadline |
|--------|-------|----------|-----------------|----------|
| MOD-1 | ISO 27001 Fundamentals & ISMS Overview | 45 min | All Personnel | 2026-07-24 |
| MOD-2 | Aira ISMS Policies & Acceptable Use | 30 min | All Personnel | 2026-07-24 |
| MOD-3 | Role-Based Security Responsibilities | 30 min | All Personnel (role tracks) | 2026-07-24 |
| ASSESS-1 | Post-Training Effectiveness Assessment | 20 min | All Personnel | 2026-07-31 |
| ONBOARD | New-Hire Onboarding Module | 60 min | New Hires | Within week 1 |
| REFRESH | Annual Refresher Training | 45 min | All Personnel | Annually (July) |

## Delivery Method

- Self-paced reading of training modules (markdown documents)
- Knowledge check quizzes for each module
- Policy acknowledgment form
- Records maintained in this directory

## Attendance Tracking

Attendance is tracked in `training/records/attendance.csv`.

### CSV Schema

```
personnel_id,name,role,department,module_id,completion_date,score,policy_acknowledged,notes
```

### Status Values

| Status | Meaning |
|--------|---------|
| `not_started` | Training not yet begun |
| `in_progress` | Modules in progress |
| `completed` | All mandatory modules completed |
| `exempt` | Exempted by CISO (e.g., temporary staff) |
| `overdue` | Past deadline, not completed |

### Completion Criteria

A person is marked `completed` when:
1. All three modules (MOD-1, MOD-2, MOD-3) are done
2. Assessment (ASSESS-1) passed with >= 70%
3. Policy acknowledgment signed

### Reporting

- Weekly: Completion rate snapshot reported to CISO
- Monthly: Trend report with pass rates and common knowledge gaps
- Quarterly: Management review input (completion rates by team)
- Annually: Full programme effectiveness review

## Manager Responsibilities

- Ensure team members are allocated time for training.
- Follow up with overdue team members.
- Escalate persistent non-compliance to CISO.

## Audit Trail

All attendance records are:
- Stored in version control (git-tracked CSV)
- Time-stamped with completion dates
- Available for auditor review as evidence of A.6.3 compliance