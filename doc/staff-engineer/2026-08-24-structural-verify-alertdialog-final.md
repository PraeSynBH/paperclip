# Staff Engineer — Structural Verification

## Branch: fix/confirm-alertdialog-review-issues
## Date: 2026-08-24 ~12:15 UTC

### Pre-ship audit: AlertDialog cancel subscription (VOY-1990 follow-up)

I reviewed the diff against main, focusing on the AlertDialog replacement for
`confirm()` in the cancel subscription flow on the pricing page.

---

### Finding 1 (P3 — Fixed in this commit)

**File:** `ui/src/pages/Pricing.tsx` (line 561)

**Problem:** The `onOpenChange` handler used `!cancelMutation.isPending` as a
guard to prevent closing the dialog while cancellation was in-flight. This
created a controlled/uncontrolled state mismatch:

1. User clicks "Yes, Cancel" (AlertDialogAction)
2. `handleConfirmCancel()` fires → `cancelMutation.mutate()` → `isPending = true`
3. Radix auto-closes the dialog (AlertDialogAction default behavior)
4. `onOpenChange(false)` fires
5. Guard blocked the state update (`isPending === true`)
6. `cancelDialogOpen` remained `true` while the dialog was visually closed
7. On next re-render (e.g., mutation's `onSuccess` invalidates queries), React
   passed `open={true}` → dialog re-opened unexpectedly

**Fix:** Removed the `!cancelMutation.isPending` guard. The dialog closes
unconditionally on action. The mutation has already been dispatched; closing
the dialog doesn't abort it. Error handling is via toasts in `onError`.

**Change:** `if (!open && !cancelMutation.isPending)` → `if (!open)`

---

### Previously verified findings (all closed)

| # | Finding | Status |
|---|---|---|
| 1 | Try-catch around gtag in handleConfirmCancel | ✅ Verified |
| 2 | Redundant setCancelDialogOpen removed | ✅ Verified |
| 3 | gtag type declaration in vite-env.d.ts | ✅ Verified |
| 4 | Test isolation (vi.stubGlobal/unstubAllGlobals) | ✅ Verified |
| 5 | Experiment query uses retry: false (fail silent) | ✅ Verified |
| 6 | Experiment endpoint uses assertCompanyAccess (correct auth) | ✅ Verified |

---

### Verdict

The AlertDialog replacement is structurally sound. One P3 finding was found and
fixed in this commit.

**Approval:** Approved — route to CTO for go/no-go, then to Release Engineer
for shipping.