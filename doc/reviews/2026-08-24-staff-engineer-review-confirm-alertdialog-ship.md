# Staff Engineer Review — fix/confirm-alertdialog-ship

**Branch:** `fix/confirm-alertdialog-ship`
**Base:** `main`
**Reviewer:** Staff Engineer
**Date:** 2026-08-24

## Summary

This branch cherry-picks the cancel-subscription AlertDialog replacement from the M6 branch (commit `e8435185bc` on `feat/m6-self-serve-trial-onboarding`). The change replaces `window.confirm()` with a styled `<AlertDialog>` component for the cancel subscription flow on the Pricing page. The diff is small: `Pricing.tsx` (+84 lines) and `Pricing.test.tsx` (+91 lines).

The implementation is mostly sound — the AlertDialog component is well-structured, Radix UI primitives are used correctly, and the tests cover the main flows. However, there is one **must-fix bug** and one **structural concern** that need addressing before shipping.

---

## Must Fix Before Shipping

### 1. `window.gtag` exception silently blocks cancellation (Critical Bug)

**File:** `ui/src/pages/Pricing.tsx:160-168`

```ts
const handleConfirmCancel = () => {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "subscription_cancellation_started", {
        company_id: companyId,
      });
    }
    cancelMutation.mutate();
    setCancelDialogOpen(false);
};
```

If `window.gtag` throws (e.g., ad blocker interception, privacy extension, or a monkey-patched gtag that errors), the exception propagates **before** `cancelMutation.mutate()` executes. The user clicked "Yes, Cancel" but the cancellation never fires. The dialog stays open, the buttons remain enabled, and the only signal is a React error boundary (which the user won't see as actionable).

**Fix:** Wrap the gtag call in a try-catch so a telemetry failure cannot prevent the mutation:

```ts
const handleConfirmCancel = () => {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", "subscription_cancellation_started", {
          company_id: companyId,
        });
      }
    } catch {
      // GA4 failure must not block cancellation
    }
    cancelMutation.mutate();
    setCancelDialogOpen(false);
};
```

(Or move the gtag call after `mutate()` — same effect, but the try-catch is more explicit about the invariant.)

---

## Should Fix Before Shipping

### 2. No guard against dialog dismissal during pending mutation

**File:** `ui/src/pages/Pricing.tsx:315`

```tsx
<AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
```

Compare with the existing pattern in `Connections.tsx:446-450`:

```tsx
onOpenChange={(open) => {
  if (!open && !deleteConnection.isPending) setConnectionToDelete(null);
}}
```

The current implementation lets the user dismiss the dialog (overlay click / Escape) while `cancelMutation.isPending` is true. The mutation continues and shows a result toast, but the user may reasonably believe the action was aborted. If they re-open the dialog and click confirm again, `cancelMutation.mutate()` is called while the first mutation is still in flight — React Query ignores the duplicate, but the UX is confusing.

**Fix:** Adopt the same guard pattern as Connections.tsx:

```tsx
onOpenChange={(open) => {
  if (!open && !cancelMutation.isPending) setCancelDialogOpen(false);
}}
```

---

## Minor Issues (Non-Blocking)

### 3. `window` guard is misleading / inconsistent

`typeof window !== "undefined"` at line 162 suggests SSR safety, but `window.location.origin` is used at line 96 without any guard. If SSR were relevant, line 96 would crash first. The guard provides a false sense of security. Remove the `typeof window !== "undefined"` check and keep only the `typeof window.gtag === "function"` check, or add a consistent guard.

### 4. No type declaration for `window.gtag`

`window.gtag(...)` is called without a type declaration. It compiles only because `skipLibCheck: true` masks the missing type. Consider adding `@types/gtag.js` or a local ambient declaration.

### 5. Test leaks `globalThis.gtag` across suites

The test sets `globalThis.gtag` via `Object.defineProperty` in `beforeEach` (line 133-136) but never cleans it up. `vi.restoreAllMocks()` does not undo `Object.defineProperty`. Other test suites running after this one will see a mocked `gtag`. Fix by using `vi.stubGlobal` / `vi.unstubGlobal` or explicitly deleting the property in `afterEach`.

### 6. Redundant `setCancelDialogOpen` in `handleConfirmCancel`

Radix UI's `AlertDialog.Action` automatically closes the dialog on click. The explicit `setCancelDialogOpen(false)` in `handleConfirmCancel` (line 168) is redundant. Harmless but unnecessary.

---

## Tests

All 8 tests pass. Coverage includes:
- Cancel button → dialog opens → "Yes, Cancel" → mutation fires ✓
- GA4 event fires on confirm ✓
- GA4 event does NOT fire on dismiss ✓
- Dismiss via "Keep Subscription" does NOT trigger mutation ✓
- Reactivate button shown when cancel is scheduled ✓

The tests correctly search `document.body` for portal-rendered AlertDialog content. No test gaps identified.

---

## Committed Documentation

The committed docs on this branch (support heartbeat, billing system support case update, heartbeat log) are accurate assessments of the AlertDialog change. No issues found there.

---

## Recommendation

**CONDITIONAL APPROVAL** — fix items 1 and 2 before shipping. Items 3-6 are non-blocking but should be addressed.

Routing to CTO for final go/no-go decision.
