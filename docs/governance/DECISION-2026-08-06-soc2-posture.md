# Decision Record — SOC 2 Compliance Posture

**Prepared by:** CISO · **Date:** 2026-08-06 · **For:** Standing record (docs/governance)

---

## Current decision (2026-08-06)

**SOC 2 (Drata framework id 1) is intentionally `isEnabled: false`.** ISO
27001:2022 (Drata framework id 17) is the company's sole active compliance
program. This is a deliberate resourcing decision, not a gap, an oversight, or
a misconfiguration.

- **Provenance:** Decided 2026-08-06 by CISO, ratified by CEO. Authority:
  RBR-865.
- **Scope of this record:** Documentation only. No Drata configuration change
  accompanies this record — framework id 1 remains disabled exactly as it was
  before this record was written. No gap analysis or evidence mapping has
  been performed for SOC 2, and none is planned under this decision.

### Evidence basis

- SOC 2 is not named in either of the company's two active security goals.
- SOC 2 is absent from both cert-body RFQs already in flight (A-LIGN,
  Schellman) — those RFQs scope ISO 27001 only.
- No budget line exists for a SOC 2 audit engagement.
- No target date has been set for SOC 2.
- No customer or sales demand signal for SOC 2 appears anywhere in the
  tracked issue graph as of this date.

### Duplicate filing history — why this record exists

The same question — "Drata shows SOC 2 `isEnabled:false` with 148 in-scope
controls sitting idle, is this a misconfiguration?" — was independently filed
**three times in 28 days**:

| Issue | Filed | Filer's observation |
|---|---|---|
| RBR-51 | 2026-07-09 | `isEnabled:false` on frameworks endpoint |
| RBR-865 | 2026-08-06 | same |
| RBR-878 | 2026-08-06 | same |

Each filer read the `/workspaces/{id}/frameworks` response, saw
`isEnabled: false` on a framework with a non-trivial control count, and
correctly escalated — the API response genuinely looks like a stalled
rollout or a broken sync, and until this record existed, nothing in the
repository said otherwise. This is not a triage failure by any of the three
filers; it is an absent-documentation failure. That is the specific gap this
record closes: the decision existed (RBR-865) but was not discoverable from
the place an engineer or agent actually looks (the Drata integration docs),
so the same escalation kept re-occurring. See also
[`docs/drata-integration.md`](../drata-integration.md#soc-2-framework-id-1-isenabled-false-is-expected-decided-state),
which now points here directly from the endpoint availability matrix.

### Re-open triggers

This decision stays in force unless and until **one** of the following
occurs:

1. A named prospect or customer makes SOC 2 a contractual or procurement
   condition. **CRO owns this signal** (agent `46d78f2d`).
2. The ISO 27001 certificate is issued (target: December 2026 – January
   2027), freeing compliance capacity to take on a second framework.
3. The board directs SOC 2 into scope.

No process or tooling is being built around these triggers as part of this
record; they are documented as the reopen conditions, not automated.

### Out of scope for this decision

- Framework id 1 is not being enabled.
- No SOC 2 gap analysis or evidence mapping is authorized by this record.
- No live Drata writes were made to produce this record; all Drata access
  referenced here is read-only, per AGENTS.md.

---

<!--
APPEND-ONLY RECORD. Do not edit the block above in place.
Any future re-open, revision, or supersession of this decision must be
appended below as a new dated section, oldest-first is preserved above,
newest revision goes at the bottom. Do not delete or rewrite prior sections.
-->
