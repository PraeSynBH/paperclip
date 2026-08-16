-- Add CHECK constraint on plan_review_gates.status (M-4 from VOY-1210 review).
-- The application layer constrains status via PLAN_REVIEW_GATE_STATUSES; this
-- constraint closes the gap for stray direct inserts.
--> statement-breakpoint
ALTER TABLE "plan_review_gates" ADD CONSTRAINT "plan_review_gates_status_check" CHECK (
  "status" IN ('pending', 'approved', 'rejected', 'superseded')
);
