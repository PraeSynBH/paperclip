import { and, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companySubscriptions as companySubscriptionsTable } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";

/**
 * Trial reaper — periodic sweeper for expired subscription trials.
 *
 * - Companies with status "trialing" and past-due trialEnd are moved to
 *   "grace_period" (7-day grace window starts).
 * - Companies already in "grace_period" whose grace window has fully elapsed
 *   are moved to "expired" (data preserved, paid features denied).
 *
 * The reaper is a safety net supplementing Stripe's webhook-triggered
 * handlePostTrialStatus logic.  If Stripe fails to deliver a webhook, or
 * the webhook handler fails mid-transaction, the reaper catches the
 * transition on its next sweep.
 */

/** Grace period in days — matches the constant in billing.ts. */
export const TRIAL_GRACE_PERIOD_DAYS = 7;

export interface TrialReapResult {
  /** Number of subscriptions moved from "trialing" to "grace_period". */
  enteredGracePeriod: number;
  /** Number of subscriptions moved from "grace_period" to "expired". */
  expired: number;
  /** Total subscriptions processed. */
  total: number;
}

export interface TrialReaperDeps {
  db: Db;
  now?: () => Date;
}

export function createTrialReaper(deps: TrialReaperDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Perform one sweep of the trial reaper.
   * Returns a summary of all transitions made.
   */
  async function sweep(): Promise<TrialReapResult> {
    const result: TrialReapResult = { enteredGracePeriod: 0, expired: 0, total: 0 };
    const currentTime = now();

    // ── Phase 1: Expired trials → grace period ───────────────────────────
    // Find subscriptions still in "trialing" status with trialEnd in the past.
    const expiredTrials = await deps.db
      .select()
      .from(companySubscriptionsTable)
      .where(
        and(
          eq(companySubscriptionsTable.status, "trialing"),
          lt(companySubscriptionsTable.trialEnd, currentTime),
        ),
      );

    for (const sub of expiredTrials) {
      const gracePeriodEnd = new Date(
        sub.trialEnd!.getTime() + TRIAL_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
      );

      await deps.db
        .update(companySubscriptionsTable)
        .set({
          status: "grace_period",
          currentPeriodEnd: gracePeriodEnd,
          updatedAt: currentTime,
        })
        .where(eq(companySubscriptionsTable.id, sub.id));

      logger.info(
        {
          companyId: sub.companyId,
          subscriptionId: sub.id,
          trialEnd: sub.trialEnd?.toISOString(),
          gracePeriodEnd: gracePeriodEnd.toISOString(),
        },
        "Trial reaper: trial expired — entered grace period",
      );

      publishLiveEvent({
        companyId: sub.companyId,
        type: "subscription.status.updated",
        payload: {
          status: "grace_period",
          stripeSubscriptionId: sub.stripeSubscriptionId,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          tierId: sub.tierId,
        },
      });

      result.enteredGracePeriod++;
    }

    // ── Phase 2: Expired grace period → expired ──────────────────────────
    // Find subscriptions in "grace_period" where the grace period has elapsed.
    // The grace period end is recorded in currentPeriodEnd (set in Phase 1).
    const expiredGracePeriods = await deps.db
      .select()
      .from(companySubscriptionsTable)
      .where(
        and(
          eq(companySubscriptionsTable.status, "grace_period"),
          lt(companySubscriptionsTable.currentPeriodEnd, currentTime),
        ),
      );

    for (const sub of expiredGracePeriods) {
      await deps.db
        .update(companySubscriptionsTable)
        .set({
          status: "expired",
          canceledAt: currentTime,
          updatedAt: currentTime,
        })
        .where(eq(companySubscriptionsTable.id, sub.id));

      logger.info(
        {
          companyId: sub.companyId,
          subscriptionId: sub.id,
          trialEnd: sub.trialEnd?.toISOString(),
        },
        "Trial reaper: grace period elapsed — subscription marked as expired",
      );

      publishLiveEvent({
        companyId: sub.companyId,
        type: "subscription.status.updated",
        payload: {
          status: "expired",
          stripeSubscriptionId: sub.stripeSubscriptionId,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          tierId: sub.tierId,
        },
      });

      result.expired++;
    }

    result.total = expiredTrials.length + expiredGracePeriods.length;
    return result;
  }

  return { sweep };
}

export type TrialReaper = ReturnType<typeof createTrialReaper>;

/**
 * Start the trial reaper interval.
 * Runs a sweep immediately, then on the configured interval (default: 1 hour).
 * Returns a disposer function to clear the interval (for graceful shutdown).
 */
export function startTrialReaperScheduler(
  deps: TrialReaperDeps,
  intervalMs: number = 60 * 60 * 1000, // default: every hour
): () => void {
  const reaper = createTrialReaper(deps);

  // Run immediately (but don't await — startup shouldn't block on this)
  reaper.sweep()
    .then((r) => {
      if (r.total > 0) {
        logger.info(r, "Trial reaper: initial sweep complete");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Trial reaper: initial sweep failed");
    });

  const timer = setInterval(() => {
    reaper.sweep()
      .then((r) => {
        if (r.total > 0) {
          logger.info(r, "Trial reaper: sweep complete");
        }
      })
      .catch((err) => {
        logger.error({ err }, "Trial reaper: sweep failed");
      });
  }, intervalMs);

  timer.unref();

  return () => {
    clearInterval(timer);
  };
}