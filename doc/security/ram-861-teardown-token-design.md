# RAM-861 — Tenant Teardown Principal + Dual-Control Token

**Issue**: [RAM-861](/RAM/issues/RAM-861)
**Parent**: [RAM-278](/RAM/issues/RAM-278) (G14.7, structural pre-landing review)
**Spec**: [tenant-offboarding-spec](/RAM/issues/RAM-152#document-tenant-offboarding-spec) §8.7
**Author**: [@SecurityEngineering](/RAM/agents/429dfce4-6b14-4c5d-a518-e4f5dced1ba0)
**Branch**: `ram-861-teardown-token`

## Vulnerability class closed

- **OWASP API1:2023 — Broken Object Level Authorization (BOLA/IDOR)**: a teardown
  token bound to tenant A is rejected when redeemed against tenant B
  (R7 cross-tenant test, plus the per-tenant HMAC derivation).
- **OWASP LLM06:2025 — Excessive Agency**: the teardown principal carries
  only the *destructive* teardown scopes; no `data.read`. So a holder of
  the token cannot pivot from "destroy" to "read".
- **STRIDE — Elevation of Privilege / Tampering**: signature verification
  refuses hand-edited claims bodies (G5.f); approver SoD refuses
  initiator==approver and operator==approver.
- **CWE-732 — Incorrect Permission Assignment for Critical Resource**:
  without dual-control, a single compromised approver could unilaterally
  trigger tenant teardown. The bar (R6 + G5) closes the EoP path.
- **CWE-613 — Insufficient Session Expiration**: ≤15min hard TTL cap with
  `nbf` and `exp` enforced at every redemption. Default 15min.

## Design (Foundational + OWASP LLM lenses)

### Token shape (JWS HS256, compact serialization)

```
header  = { "alg":"HS256", "typ":"JWT" }
claims  = {
  tenantId,                         // binds to one tenant
  op:    "teardown",                // NOT a "read"/"write" op
  scope: [keys.revoke, index.purge, // intentional: no data.read
          cache.invalidate, rows.delete, chain.append],
  nbf, iat, exp (≤ now+15min),      // hard TTL cap
  jti:    <uuid-v4>,                // single-use ledger key
  approvers: [<sub>, <sub>],        // two distinct approver subjects
  sub:    <initiator>,              // never == any approver
  operator: <operator>,             // never == any approver
  reason: <audit string>,
  breakGlass?: true,                // explicit; always audited
  iss:    "paperclip-teardown",
  aud:    "paperclip-tenant-offboarding",
}
signing = HMAC-SHA256(
            key = HMAC-SHA256(masterSecret, "teardown:"+tenantId).hex,
            msg = base64url(header) + "." + base64url(claims),
          ).base64url
```

The per-tenant signing key is **derived from the master secret at
issuance**, not the master secret itself. The same defense
`createLocalAgentJwt` already uses in `server/src/agent-auth-jwt.ts`
against cross-tenant token replay: a leaked teardown token signed
for tenant A cannot be replayed against tenant B because the
signature no longer verifies under tenant B's derived key. There
is no master-secret fallback for teardown tokens (default-fail-closed).

### Issuance (`mintTeardownToken`)

1. **Approver dual-control check** (IdP group membership + SoD).
   Each approver must (a) be a member of the configured approver group
   (e.g. `teardown-approvers`), (b) be a distinct subject, (c) not be
   the initiator, and (d) not be the operator. Refuses with
   `approver_check_failed` if any of these fail.
2. **Kill-switch check** — both `kill_tenant` for the target tenant and
   `kill_fleet` for `*`. Refuses with `kill_switch_held` if either is
   held. (Foundational Fail-Securely + Complete Mediation: a held
   kill-switch is the absolute stop-sign for new teardowns.)
3. **Claim construction** — SoD, TTL, scope allow-list.
4. **Per-tenant HMAC signing**.
5. **Single-use ledger** `recordIssued(jti, tenantId, iat, exp)` — idempotent.
6. **Break-glass notification** — if `breakGlass: true`, immediately
   notify CISO, Compliance, and the requester. The token still requires
   dual-control approvers (break-glass only relaxes the *who* in the
   audit-trail sense; it never suppresses the count).

### Redemption (`redeemTeardownToken`)

1. **Signature + claim verification** (per-tenant HMAC, op=`teardown`,
   iss/aud match, scope allow-list, approver SoD, time bounds).
   Refuses with `bad_token` on any failure.
2. **Tenant binding** — the token's `tenantId` MUST match the
   redeemer's `expectedTenantId`. Refuses with `tenant_mismatch`
   (this is R7 + BOLA closure).
3. **Single-use ledger `redeem`** — atomic per-`jti` (in-memory:
   per-jti mutex; DB: `SELECT … FOR UPDATE` will be the same shape).
   - First redemption: `ok`.
   - Any subsequent redemption: `already_redeemed` (replay detection).
   - A `jti` the ledger never saw: `unknown_jti`.

### Break-glass (G2)

- Token carries an explicit `breakGlass: true` claim.
- Issuance emits an immediate notification to CISO, Compliance, and
  the requester (the `BreakGlassNotifier` interface; default is
  `RecordingBreakGlassNotifier`, production wiring calls into the
  paging system).
- A 24h after-action record is required (`BREAK_GLASS_AFTER_ACTION_WINDOW_SECONDS`).
- Even with break-glass, dual-control approvers and the kill-switch
  are still enforced (the spec only relaxes the *who*-and-*how-much*
  audit, not the *count* of approvers or the runtime guardrails).

## Where this fits

- Builds on the **tenant-data-sinks registry** from [RAM-272](/RAM/issues/RAM-272)
  (the registry tells the teardown runtime *what* to destroy; this
  token tells it *who is authorized to do so*).
- Reuses the **per-company HMAC key derivation** pattern from
  `server/src/agent-auth-jwt.ts` (no master-secret signing).
- The IdP approver resolver is a small interface
  (`ApproverResolver.lookup(subject)`) — the eventual RAM-177 / RAM-9.2
  policy-plane principal model drops in as the live implementation.
- The kill-switch probe (`KillSwitchProbe.lookup(scope, subject)`)
  reads from `kill_epoch{scope=~"kill_tenant|kill_fleet"}` —
  the same source the `.paperclip/ram-396/ram87-p4-kill-plane-registration.json`
  registration feeds.

## Bar / regression tests

| Test | File | Asserts |
| ---- | ---- | ------- |
| **R6** | `__tests__/tenant-teardown-r6.test.ts` (6 cases) | teardown rejected when zero / one / duplicated / out-of-group / initiator-as-approver / operator-as-approver. |
| **R7** | `__tests__/tenant-teardown-r7.test.ts` (5 cases) | token with `op != "teardown"` or wrong `tenantId` → 403; signature-mismatched forgery rejected; out-of-allowlist scope rejected. |
| **G5** | `__tests__/tenant-teardown-g5.test.ts` (7 cases) | GameDay dual-control bypass rejected across G5.a–G5.g. |
| Baseline | `__tests__/tenant-teardown.test.ts` (6 cases) | mint/redeem lifecycle, single-use, kill-switch (tenant + fleet), break-glass notification + after-action, parallel redemption race. |

24 tests pass; `tsc --noEmit` is clean for the new module.

## Residual risk + follow-ups

1. **DB-backed single-use ledger** — the in-memory implementation is
   fine for tests and a single-instance deploy, but production
   should back this with a `teardown_token_jtis` table
   (`UNIQUE(jti)`, `redeemed_at TIMESTAMPTZ`, `redeemed_by TEXT`,
    `note TEXT`) and `SELECT … FOR UPDATE` to get the same
   atomicity across instances. Follow-up child issue to file.
2. **IdP integration** — the `ApproverResolver` interface is in
   place; the real IdP lookup is owned by RAM-177 / RAM-9.2 (policy-plane
   principal model). When that ships, the in-memory resolver here is
   swapped for the live one with no further token-side changes.
3. **Kill-switch live probe** — the `KillSwitchProbe` interface is in
   place; the production wiring should source `kill_epoch` from the
   runtime kill-plane (see `.paperclip/ram-396/ram87-p4-kill-plane-registration.json`)
   not the in-memory test probe.
4. **Audit chain entry on redemption** — the `RedemptionRecord` is
   the local in-memory shape; the production audit chain should
   record `{jti, tenantId, redeemedAt, redeemedBy, claims}` in
   a tamper-evident chain (track 8 / RAM-279).
5. **Per-record crypto-shred after teardown** — out of scope here;
   handled by the tenant-data-sinks handlers (track 1 / RAM-272
   plus the follow-up RAM-273/274/275/276/280/281).
