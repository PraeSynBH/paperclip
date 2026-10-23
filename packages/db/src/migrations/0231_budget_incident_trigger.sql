-- PRX-5485: record WHAT triggered the evaluation that created a budget incident.
-- Before this column, `evaluateCostEvent` (a cost-event crossing) and `upsertPolicy`
-- (a re-arm evaluating spend already booked in the window) wrote identical rows, so
-- incident 139d8730 ($808 vs a $500 cap) read as "the gate let $308 through" when it
-- was actually a cap armed on spend booked while the policy was disarmed (PRX-5347).
--
-- Backfill is deliberately `unknown`, not inferred: only `139d8730` can be proven
-- (34 h 38 m after the last cost event, 2 s before `budget.policy_upserted amount=50000`),
-- and that single row is backfilled separately with its evidence cited on the card.
ALTER TABLE "budget_incidents" ADD COLUMN "trigger" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_incidents" ADD CONSTRAINT "budget_incidents_trigger_check" CHECK ("budget_incidents"."trigger" in ('cost_event', 'policy_rearm', 'window_reset', 'unknown'));