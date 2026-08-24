import { and, desc, eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import type { Db } from "@paperclipai/db";
import {
  companies as companiesTable,
  subscriptionTiers as subscriptionTiersTable,
  stripeCustomers as stripeCustomersTable,
  companySubscriptions as companySubscriptionsTable,
  subscriptionUsage as subscriptionUsageTable,
  subscriptionInvoices as subscriptionInvoicesTable,
  stripeWebhookEvents as stripeWebhookEventsTable,
} from "@paperclipai/db";
import { ACTIVE_SUBSCRIPTION_STATUSES, FREE_FEATURES, type TrialStatusResponse } from "@paperclipai/shared";
import { badRequest, notFound, paywall, unprocessable } from "../errors.js";
import { publishLiveEvent } from "./live-events.js";
import { getGa4AnalyticsService, buildTrialStartEvent } from "./ga4-analytics.js";
import type { PricingExperimentVariant, PricingExperimentService } from "./pricing-experiment.js";
import { captureMetric } from "./posthog.js";
import { logger } from "../middleware/logger.js";

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY environment variable is not set. Billing operations are unavailable.",
    );
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });
}

/** Max attempts for Stripe API retries in webhook handler contexts. */
const STRIPE_RETRY_MAX_ATTEMPTS = 3;
/** Base delay in ms for exponential backoff (1st retry: ~1s, 2nd: ~2s). */
const STRIPE_RETRY_BASE_DELAY_MS = 1000;

/**
 * Wrap a Stripe API call with exponential-backoff retry.
 * Only retries on transient/rate-limit errors (5xx, 429, network).
 * Idempotent callers (our handlers use upserts) can safely retry.
 */
async function withStripeRetry<T>(fn: () => Promise<T>, ctx?: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= STRIPE_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const stripeErr = err as { type?: string; statusCode?: number; code?: string };
      const statusCode = stripeErr?.statusCode;
      const isTransient =
        statusCode === 429 ||
        (statusCode !== undefined && statusCode >= 500) ||
        stripeErr?.type === "StripeConnectionError" ||
        stripeErr?.type === "StripeTimeoutError" ||
        stripeErr?.code === "service_unavailable";

      if (!isTransient || attempt === STRIPE_RETRY_MAX_ATTEMPTS) {
        throw err;
      }

      const delay = STRIPE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
      logger.warn(
        { attempt, maxAttempts: STRIPE_RETRY_MAX_ATTEMPTS, delayMs: delay, ctx },
        "Stripe API call failed — retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

function currentPeriodRange(billingPeriod: "monthly" | "yearly", now = new Date()) {
  let periodStart: Date;
  let periodEnd: Date;

  if (billingPeriod === "monthly") {
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  } else {
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
  }

  return { periodStart, periodEnd };
}

export function billingService(db: Db, experiment?: PricingExperimentService) {
  const getTier = async (tierId: string) => {
    const tier = await db
      .select()
      .from(subscriptionTiersTable)
      .where(eq(subscriptionTiersTable.id, tierId))
      .then((r) => r[0] ?? null);
    if (!tier) throw notFound("Subscription tier not found");
    return tier;
  };

  const getOrCreateStripeCustomer = async (companyId: string): Promise<{ id: string; stripeCustomerId: string }> => {
    const stripe = getStripeClient();

    const existing = await db
      .select()
      .from(stripeCustomersTable)
      .where(eq(stripeCustomersTable.companyId, companyId))
      .then((r) => r[0] ?? null);

    if (existing) {
      return { id: existing.id, stripeCustomerId: existing.stripeCustomerId };
    }

    const company = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .then((r) => r[0] ?? null);
    if (!company) throw notFound("Company not found");

    const customer = await withStripeRetry(
      () => stripe.customers.create({
        name: company.name,
        description: `Paperclip company: ${company.name} (${companyId})`,
        metadata: {
          paperclipCompanyId: companyId,
        },
      }),
      "stripe.customers.create",
    );

    // Upsert: INSERT ... ON CONFLICT (company_id) DO NOTHING with fallback SELECT.
    // Closes the race where two concurrent calls both pass the SELECT guard above,
    // create two Stripe customers, and the second INSERT would crash on the unique
    // constraint. The winner's record is returned; the orphan Stripe customer is
    // tolerated (very rare in practice; Stripe supports cleanup via metadata).
    const record = await db
      .insert(stripeCustomersTable)
      .values({
        companyId,
        stripeCustomerId: customer.id,
      })
      .onConflictDoNothing({ target: stripeCustomersTable.companyId })
      .returning()
      .then((r) => r[0] ?? null);

    if (record) {
      logger.info({ companyId, stripeCustomerId: customer.id }, "Created Stripe customer");
      return { id: record.id, stripeCustomerId: customer.id };
    }

    // Another request won the race — fetch the existing record
    const winner = await db
      .select()
      .from(stripeCustomersTable)
      .where(eq(stripeCustomersTable.companyId, companyId))
      .then((r) => r[0]!);

    return { id: winner.id, stripeCustomerId: winner.stripeCustomerId };
  };

  const listInvoices = async (companyId: string) => {
    return db
      .select()
      .from(subscriptionInvoicesTable)
      .where(eq(subscriptionInvoicesTable.companyId, companyId))
      .orderBy(desc(subscriptionInvoicesTable.createdAt));
  };

  const handleInvoicePaid = async (invoice: Stripe.Invoice) => {
    if (!invoice.subscription) return;
    const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;

    let companyId: string | undefined;

    await db.transaction(async (tx) => {
      const sub = await tx
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId))
        .then((r) => r[0] ?? null);

      if (!sub) {
        logger.warn({ stripeSubscriptionId: subId }, "Received invoice for unknown subscription");
        return;
      }

      companyId = sub.companyId;

      // Upsert: INSERT ... ON CONFLICT (stripe_invoice_id) DO UPDATE
      // Handles at-least-once delivery from Stripe (race-free with the UNIQUE index)
      await tx.execute(sql`
        INSERT INTO "subscription_invoices"
          ("company_id", "subscription_id", "stripe_invoice_id", "invoice_number", "status",
           "amount_cents", "amount_paid_cents", "amount_remaining_cents", "currency",
           "invoice_pdf_url", "hosted_invoice_url", "period_start", "period_end",
           "created_at", "updated_at")
        VALUES (
          ${sub.companyId}, ${sub.id}, ${invoice.id}, ${invoice.number ?? null}, ${invoice.status ?? "paid"},
          ${invoice.total}, ${invoice.amount_paid}, ${invoice.amount_remaining}, ${invoice.currency},
          ${invoice.invoice_pdf ?? null}, ${invoice.hosted_invoice_url ?? null},
          ${invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null},
          ${invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null},
          NOW(), NOW()
        )
        ON CONFLICT ("stripe_invoice_id") DO UPDATE SET
          "company_id" = EXCLUDED."company_id",
          "subscription_id" = EXCLUDED."subscription_id",
          "invoice_number" = EXCLUDED."invoice_number",
          "status" = EXCLUDED."status",
          "amount_cents" = EXCLUDED."amount_cents",
          "amount_paid_cents" = EXCLUDED."amount_paid_cents",
          "amount_remaining_cents" = EXCLUDED."amount_remaining_cents",
          "currency" = EXCLUDED."currency",
          "invoice_pdf_url" = EXCLUDED."invoice_pdf_url",
          "hosted_invoice_url" = EXCLUDED."hosted_invoice_url",
          "period_start" = EXCLUDED."period_start",
          "period_end" = EXCLUDED."period_end",
          "updated_at" = NOW()
      `);
    });

    // Fire subscription_activated conversion event (best-effort, never blocks)
    if (companyId) {
      captureMetric("pricing.subscription_activated", companyId, {
        companyId,
        stripeSubscriptionId: subId,
        invoiceAmountCents: invoice.amount_paid ?? invoice.total ?? 0,
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
      });
    }
  };

  const handleInvoicePaymentFailed = async (invoice: Stripe.Invoice) => {
    if (!invoice.subscription) return;
    const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;

    // Fetch the current subscription record to get companyId before updating
    const currentSub = await db
      .select()
      .from(companySubscriptionsTable)
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId))
      .then((r) => r[0] ?? null);

    await db
      .update(companySubscriptionsTable)
      .set({
        status: "past_due",
        updatedAt: new Date(),
      })
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId));

    logger.warn({ stripeSubscriptionId: subId, invoiceId: invoice.id }, "Subscription payment failed");

    if (currentSub) {
      publishLiveEvent({
        companyId: currentSub.companyId,
        type: "subscription.status.updated",
        payload: {
          status: "past_due",
          stripeSubscriptionId: subId,
          cancelAtPeriodEnd: currentSub.cancelAtPeriodEnd,
          tierId: currentSub.tierId,
        },
      });
    }
  };

  const handleSubscriptionUpdated = async (stripeSub: Stripe.Subscription) => {
    const companyId = stripeSub.metadata?.paperclipCompanyId;
    if (!companyId) {
      logger.warn({ stripeSubscriptionId: stripeSub.id }, "No paperclipCompanyId in subscription metadata");
      return;
    }

    const tierId = stripeSub.metadata?.paperclipTierId;
    let oldStatus: string | undefined;

    await db.transaction(async (tx) => {
      // Search by stripe_subscription_id first, then fallback to companyId for
      // trial rows that have stripe_subscription_id = NULL (P0 fix).
      let existing = await tx
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id))
        .then((r) => r[0] ?? null);

      if (!existing) {
        existing = await tx
          .select()
          .from(companySubscriptionsTable)
          .where(eq(companySubscriptionsTable.companyId, companyId))
          .then((r) => r[0] ?? null);
      }

      if (existing) {
        oldStatus = existing.status;
        await tx
          .update(companySubscriptionsTable)
          .set({
            status: stripeSub.status,
            currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            updatedAt: new Date(),
            stripeSubscriptionId: existing.stripeSubscriptionId ?? stripeSub.id,
            ...(stripeSub.canceled_at ? { canceledAt: new Date(stripeSub.canceled_at * 1000) } : {}),
            ...(stripeSub.trial_end ? { trialEnd: new Date(stripeSub.trial_end * 1000) } : {}),
          })
          .where(eq(companySubscriptionsTable.id, existing.id));

        publishLiveEvent({
          companyId,
          type: "subscription.status.updated",
          payload: {
            status: stripeSub.status,
            stripeSubscriptionId: stripeSub.id,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            tierId: stripeSub.metadata?.paperclipTierId ?? null,
          },
        });
      } else {
        // Subscription was created outside our normal flow (e.g. via Checkout Session)
        // but the checkout.session.completed handler may not have fired yet.
        // Use INSERT ... ON CONFLICT DO UPDATE to handle race between create and update events.
        if (!tierId) {
          logger.warn(
            { stripeSubscriptionId: stripeSub.id, companyId },
            "Cannot create subscription record — no paperclipTierId in metadata",
          );
          return;
        }

        const cust = await tx
          .select()
          .from(stripeCustomersTable)
          .where(eq(stripeCustomersTable.companyId, companyId))
          .then((r) => r[0] ?? null);
        if (!cust) {
          logger.warn(
            { stripeSubscriptionId: stripeSub.id, companyId },
            "Cannot create subscription record — no Stripe customer record",
          );
          return;
        }

        const stripeSubItemId = stripeSub.items.data[0]?.id ?? null;

        await tx.execute(sql`
          INSERT INTO "company_subscriptions"
            ("company_id", "tier_id", "stripe_customer_id", "status", "billing_period",
             "current_period_start", "current_period_end", "stripe_subscription_id",
             "stripe_subscription_item_id", "cancel_at_period_end", "trial_end",
             "created_at", "updated_at")
          VALUES (
            ${companyId}, ${tierId}, ${cust.id}, ${stripeSub.status},
            ${stripeSub.metadata?.billingPeriod ?? "monthly"},
            ${new Date(stripeSub.current_period_start * 1000).toISOString()},
            ${new Date(stripeSub.current_period_end * 1000).toISOString()},
            ${stripeSub.id}, ${stripeSubItemId},
            ${stripeSub.cancel_at_period_end},
            ${stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null},
            NOW(), NOW()
          )
          ON CONFLICT ("company_id") DO UPDATE SET
            "tier_id" = EXCLUDED."tier_id",
            "stripe_customer_id" = EXCLUDED."stripe_customer_id",
            "status" = EXCLUDED."status",
            "billing_period" = EXCLUDED."billing_period",
            "current_period_start" = EXCLUDED."current_period_start",
            "current_period_end" = EXCLUDED."current_period_end",
            "stripe_subscription_id" = EXCLUDED."stripe_subscription_id",
            "stripe_subscription_item_id" = EXCLUDED."stripe_subscription_item_id",
            "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
            "trial_end" = EXCLUDED."trial_end",
            "updated_at" = NOW()
        `);

        // Fetch the subscription record (created or upserted) to get its ID
        const subRecord = await tx
          .select()
          .from(companySubscriptionsTable)
          .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id))
          .then((r) => r[0]!);

        // Fetch the tier for included usage amounts
        const tier = await tx
          .select()
          .from(subscriptionTiersTable)
          .where(eq(subscriptionTiersTable.id, tierId))
          .then((r) => r[0]!);

        // Create usage records — idempotent via ON CONFLICT DO NOTHING
        // using the unique index on (subscription_id, metric, period_start, period_end).
        const usageMetrics: Array<{ metric: string; included: number }> = [
          { metric: "seats", included: tier.includedSeats },
          { metric: "agent_runs", included: tier.includedAgentRuns },
          { metric: "storage_gb", included: tier.includedStorageGb },
        ];

        for (const m of usageMetrics) {
          await tx.execute(sql`
            INSERT INTO "subscription_usage"
              ("company_id", "subscription_id", "metric", "usage", "included",
               "overage", "overage_cents", "period_start", "period_end",
               "created_at", "updated_at")
            VALUES (
              ${companyId}, ${subRecord.id}, ${m.metric}, 0, ${m.included},
              0, 0,
              ${subRecord.currentPeriodStart.toISOString()}, ${subRecord.currentPeriodEnd.toISOString()},
              NOW(), NOW()
            )
            ON CONFLICT ("subscription_id", "metric", "period_start", "period_end") DO NOTHING
          `);
        }

        logger.info(
          { stripeSubscriptionId: stripeSub.id, companyId, tierId },
          "Created subscription record from Stripe webhook (fallback)",
        );

        publishLiveEvent({
          companyId,
          type: "subscription.status.updated",
          payload: {
            status: stripeSub.status,
            stripeSubscriptionId: stripeSub.id,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            tierId,
          },
        });

        // GA4 tracking: fire trial_started when a new subscription with a trial is created
        if (stripeSub.trial_end && stripeSub.trial_end * 1000 > Date.now()) {
          const billingPeriod = stripeSub.metadata?.billingPeriod ?? "monthly";
          getGa4AnalyticsService().send(buildTrialStartEvent(companyId, tierId, billingPeriod));
        }
      }
    });

    logger.info({ stripeSubscriptionId: stripeSub.id, status: stripeSub.status }, "Subscription status synced from Stripe");

    // After the subscription update, check if the trial has ended and handle
    // the transition to grace period if needed.
    await handlePostTrialStatus(stripeSub);

    // Fire trial_converted event when a trialing subscription becomes active
    // (best-effort, never blocks)
    if (oldStatus === "trialing" && stripeSub.status === "active") {
      captureMetric("pricing.trial_converted", companyId, {
        companyId,
        stripeSubscriptionId: stripeSub.id,
        tierId: tierId ?? null,
        trialEnd: stripeSub.trial_end
          ? new Date(stripeSub.trial_end * 1000).toISOString()
          : null,
      });
    }
  };

  const handleSubscriptionDeleted = async (stripeSub: Stripe.Subscription) => {
    const companyId = stripeSub.metadata?.paperclipCompanyId;
    const tierId = stripeSub.metadata?.paperclipTierId ?? null;

    // Fetch current subscription record to get companyId before deleting.
    // Search by stripe_subscription_id first, then fallback to companyId for
    // trial rows that have stripe_subscription_id = NULL.
    let existing = await db
      .select()
      .from(companySubscriptionsTable)
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id))
      .then((r) => r[0] ?? null);

    if (!existing && companyId) {
      existing = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);
    }

    const whereId = existing?.id ?? null;
    if (whereId) {
      await db
        .update(companySubscriptionsTable)
        .set({
          status: "canceled",
          canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companySubscriptionsTable.id, whereId));
    } else {
      // Fallback: try matching by stripe_subscription_id directly
      await db
        .update(companySubscriptionsTable)
        .set({
          status: "canceled",
          canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id));
    }

    logger.info({ stripeSubscriptionId: stripeSub.id }, "Subscription canceled via Stripe");

    if (existing) {
      publishLiveEvent({
        companyId: existing.companyId,
        type: "subscription.status.updated",
        payload: {
          status: "canceled",
          stripeSubscriptionId: stripeSub.id,
          cancelAtPeriodEnd: false,
          tierId: existing.tierId,
        },
      });
    }

    // Fire subscription_canceled conversion event (best-effort, never blocks)
    if (companyId) {
      captureMetric("pricing.subscription_canceled", companyId, {
        companyId,
        stripeSubscriptionId: stripeSub.id,
        tierId,
        canceledAt: stripeSub.canceled_at
          ? new Date(stripeSub.canceled_at * 1000).toISOString()
          : new Date().toISOString(),
        source: "stripe_webhook",
      });
    }
  };

  const handleCheckoutSessionCompleted = async (session: Stripe.Checkout.Session) => {
    if (session.mode !== "subscription") return;
    const subId = session.subscription
      ? (typeof session.subscription === "string" ? session.subscription : session.subscription.id)
      : null;
    if (!subId) {
      logger.warn({ sessionId: session.id }, "Checkout session completed without subscription");
      return;
    }

    const companyId = session.metadata?.paperclipCompanyId;
    const tierId = session.metadata?.paperclipTierId;
    const billingPeriod = (session.metadata?.billingPeriod ?? "monthly") as "monthly" | "yearly";

    if (!companyId || !tierId) {
      logger.warn(
        { sessionId: session.id, metadata: session.metadata },
        "Missing required metadata (paperclipCompanyId or paperclipTierId) in checkout session",
      );
      return;
    }

    const stripe = getStripeClient();
    const stripeSub = await withStripeRetry(
      () => stripe.subscriptions.retrieve(subId),
      "checkout.session.completed:subscriptions.retrieve",
    );

    const sessionCustomerId = session.customer
      ? (typeof session.customer === "string" ? session.customer : session.customer.id)
      : null;
    const stripeCustomerId = sessionCustomerId ?? stripeSub.customer as string;

    // Use a single transaction with upsert to handle at-least-once Stripe delivery
    // and TOCTOU races between checkout.session.completed and customer.subscription.updated.
    await db.transaction(async (tx) => {
      // Check if subscription already exists inside the transaction.
      // Search by stripe_subscription_id first, then fallback to companyId for
      // trial rows that have stripe_subscription_id = NULL (P0 fix).
      let existing = await tx
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId))
        .then((r) => r[0] ?? null);

      if (!existing) {
        existing = await tx
          .select()
          .from(companySubscriptionsTable)
          .where(eq(companySubscriptionsTable.companyId, companyId))
          .then((r) => r[0] ?? null);
      }

      if (existing) {
        // ── Subscription row exists (either found by stripe_subscription_id or
        //     companyId fallback for trial rows with NULL stripe_subscription_id).
        //     Ensure usage records exist, and update stripe_subscription_id if the
        //     trial row was found via companyId and doesn't have it set yet. ──
        const needsStripeIdUpdate = !existing.stripeSubscriptionId;

        if (needsStripeIdUpdate) {
          // Trial→paid conversion: update the existing row with the real
          // Stripe subscription details and set stripe_subscription_id.
          const stripeSubItemId = stripeSub.items.data[0]?.id ?? null;
          await tx
            .update(companySubscriptionsTable)
            .set({
              stripeSubscriptionId: subId,
              stripeSubscriptionItemId: stripeSubItemId,
              status: stripeSub.status,
              currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
              currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
              trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : existing.trialEnd,
              updatedAt: new Date(),
            })
            .where(eq(companySubscriptionsTable.id, existing.id));

          logger.info(
            { companyId, stripeSubscriptionId: subId, tierId },
            "Trial→paid conversion: updated subscription row with Stripe details",
          );
        }

        logger.info(
          { stripeSubscriptionId: subId },
          "Subscription already exists — ensuring usage records",
        );

        // Idempotent usage metric creation via ON CONFLICT DO NOTHING
        const tier = await getTier(existing.tierId);
        const usageMetrics: Array<{ metric: string; included: number }> = [
          { metric: "seats", included: tier.includedSeats },
          { metric: "agent_runs", included: tier.includedAgentRuns },
          { metric: "storage_gb", included: tier.includedStorageGb },
        ];

        for (const m of usageMetrics) {
          await tx.execute(sql`
            INSERT INTO "subscription_usage"
              ("company_id", "subscription_id", "metric", "usage", "included",
               "overage", "overage_cents", "period_start", "period_end",
               "created_at", "updated_at")
            VALUES (
              ${existing.companyId}, ${existing.id}, ${m.metric}, 0, ${m.included},
              0, 0,
              ${existing.currentPeriodStart.toISOString()}, ${existing.currentPeriodEnd.toISOString()},
              NOW(), NOW()
            )
            ON CONFLICT ("subscription_id", "metric", "period_start", "period_end") DO NOTHING
          `);
        }

        publishLiveEvent({
          companyId,
          type: "subscription.status.updated",
          payload: {
            status: stripeSub.status,
            stripeSubscriptionId: subId,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            tierId,
          },
        });

        return;
      }

      const cust = await tx
        .select()
        .from(stripeCustomersTable)
        .where(eq(stripeCustomersTable.stripeCustomerId, stripeCustomerId as string))
        .then((r) => r[0] ?? null);

      if (!cust) {
        logger.warn(
          { stripeCustomerId, companyId },
          "No local Stripe customer record found — cannot create subscription",
        );
        return;
      }

      const tier = await getTier(tierId);
      const stripeSubItemId = stripeSub.items.data[0]?.id ?? null;

      // Upsert: INSERT ... ON CONFLICT (company_id) DO UPDATE
      // Handles at-least-once delivery from Stripe and trial→paid conversion
      // where the trial row has stripe_subscription_id = NULL (P0 fix: use
      // company_id UNIQUE constraint instead of stripe_subscription_id index).
      await tx.execute(sql`
        INSERT INTO "company_subscriptions"
          ("company_id", "tier_id", "stripe_customer_id", "status", "billing_period",
           "current_period_start", "current_period_end", "stripe_subscription_id",
           "stripe_subscription_item_id", "cancel_at_period_end", "trial_end",
           "created_at", "updated_at")
        VALUES (
          ${companyId}, ${tierId}, ${cust.id}, ${stripeSub.status},
          ${billingPeriod},
          ${new Date(stripeSub.current_period_start * 1000).toISOString()},
          ${new Date(stripeSub.current_period_end * 1000).toISOString()},
          ${subId}, ${stripeSubItemId},
          ${stripeSub.cancel_at_period_end},
          ${stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null},
          NOW(), NOW()
        )
        ON CONFLICT ("company_id") DO UPDATE SET
          "tier_id" = EXCLUDED."tier_id",
          "stripe_customer_id" = EXCLUDED."stripe_customer_id",
          "status" = EXCLUDED."status",
          "billing_period" = EXCLUDED."billing_period",
          "current_period_start" = EXCLUDED."current_period_start",
          "current_period_end" = EXCLUDED."current_period_end",
          "stripe_subscription_id" = EXCLUDED."stripe_subscription_id",
          "stripe_subscription_item_id" = EXCLUDED."stripe_subscription_item_id",
          "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
          "trial_end" = EXCLUDED."trial_end",
          "updated_at" = NOW()
      `);

      // Fetch the newly created subscription record to get its database ID
      const created = await tx
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId))
        .then((r) => r[0]!);

      // Create usage records — idempotent via ON CONFLICT DO NOTHING
      const usageMetrics: Array<{ metric: string; included: number }> = [
        { metric: "seats", included: tier.includedSeats },
        { metric: "agent_runs", included: tier.includedAgentRuns },
        { metric: "storage_gb", included: tier.includedStorageGb },
      ];

      for (const m of usageMetrics) {
        await tx.execute(sql`
          INSERT INTO "subscription_usage"
            ("company_id", "subscription_id", "metric", "usage", "included",
             "overage", "overage_cents", "period_start", "period_end",
             "created_at", "updated_at")
          VALUES (
            ${companyId}, ${created.id}, ${m.metric}, 0, ${m.included},
            0, 0,
            ${created.currentPeriodStart.toISOString()}, ${created.currentPeriodEnd.toISOString()},
            NOW(), NOW()
          )
          ON CONFLICT ("subscription_id", "metric", "period_start", "period_end") DO NOTHING
        `);
      }
    });

    logger.info(
      { companyId, tierId, stripeSubscriptionId: subId },
      "Created subscription from Checkout Session",
    );

    publishLiveEvent({
      companyId,
      type: "subscription.status.updated",
      payload: {
        status: stripeSub.status,
        stripeSubscriptionId: subId,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        tierId,
      },
    });

    // Fire subscription_completed conversion event (best-effort, never blocks)
    captureMetric("pricing.subscription_completed", companyId, {
      companyId,
      tierId,
      billingPeriod,
      stripeSubscriptionId: subId,
      status: stripeSub.status,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null,
    });

    // Fire trial_started conversion event when the subscription enters a trial
    // (best-effort, never blocks)
    if (stripeSub.trial_end) {
      captureMetric("pricing.trial_started", companyId, {
        companyId,
        tierId,
        billingPeriod,
        stripeSubscriptionId: subId,
        trialEnd: new Date(stripeSub.trial_end * 1000).toISOString(),
        trialDurationDays: stripeSub.trial_start
          ? Math.round((stripeSub.trial_end - stripeSub.trial_start) / 86400)
          : null,
      });
    }
  };

  /**
   * Number of days after trial expiry during which the company retains
   * access to its data but paid features are denied. After this period
   * the subscription transitions to "expired" but data is preserved.
   */
  const TRIAL_GRACE_PERIOD_DAYS = 7;

  /**
   * Handle `customer.subscription.trial_will_end` — Stripe sends this 3 days
   * before the trial period ends. We log the event and flag the impending
   * expiry so the system can surface upgrade prompts.
   */
  const handleTrialWillEnd = async (stripeSub: Stripe.Subscription) => {
    const companyId = stripeSub.metadata?.paperclipCompanyId;
    if (!companyId) {
      logger.warn(
        { stripeSubscriptionId: stripeSub.id },
        "No paperclipCompanyId in subscription metadata for trial_will_end",
      );
      return;
    }

    const trialEnd = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;
    const gracePeriodEnd = trialEnd
      ? new Date(trialEnd.getTime() + TRIAL_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
      : null;

    logger.info(
      {
        companyId,
        stripeSubscriptionId: stripeSub.id,
        trialEnd: trialEnd?.toISOString(),
        gracePeriodEnd: gracePeriodEnd?.toISOString(),
      },
      "Trial will end soon — grace period starts after trial expiry",
    );

    // Update the subscription record's trialEnd if it's not already set
    if (trialEnd) {
      await db
        .update(companySubscriptionsTable)
        .set({
          trialEnd,
          updatedAt: new Date(),
        })
        .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id));
    }

    publishLiveEvent({
      companyId,
      type: "subscription.status.updated",
      payload: {
        stripeSubscriptionId: stripeSub.id,
        trialEnd: trialEnd?.toISOString(),
        gracePeriodEnd: gracePeriodEnd?.toISOString(),
        event: "trial_will_end",
      },
    });

    // Fire trial_will_end conversion event (best-effort, never blocks)
    const tierId = stripeSub.metadata?.paperclipTierId ?? null;
    captureMetric("pricing.trial_will_end", companyId, {
      companyId,
      stripeSubscriptionId: stripeSub.id,
      tierId,
      trialEnd: trialEnd?.toISOString() ?? null,
      currentPeriodEnd: stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000).toISOString()
        : null,
    });
  };

  /**
   * Handle post-trial subscription status: if the subscription transitions
   * from "trialing" to "incomplete" or "past_due" (no payment method), we
   * enter the grace period rather than immediately blocking access.
   */
  const handlePostTrialStatus = async (stripeSub: Stripe.Subscription) => {
    const companyId = stripeSub.metadata?.paperclipCompanyId;
    if (!companyId) return;

    // If the subscription was in trial and is now past_due/incomplete,
    // we keep it in a "trialing" state locally during the grace period
    // so the company retains access to their data.
    const existingSub = await db
      .select()
      .from(companySubscriptionsTable)
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id))
      .then((r) => r[0] ?? null);

    if (!existingSub) return;

    const trialEnded = existingSub.trialEnd && existingSub.trialEnd.getTime() <= Date.now();
    const isNonPayableStatus = stripeSub.status === "incomplete" || stripeSub.status === "past_due";

    if (trialEnded && isNonPayableStatus) {
      // Grace period: keep the subscription in a "trialing" state locally
      // so the company retains data access. Only mark as expired after
      // the grace period elapses.
      const gracePeriodEnd = new Date(
        existingSub.trialEnd!.getTime() + TRIAL_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
      );
      const now = new Date();

      if (now < gracePeriodEnd) {
        // Within grace period — keep status as "trialing" or set to "grace_period"
        await db
          .update(companySubscriptionsTable)
          .set({
            status: "grace_period",
            currentPeriodStart: existingSub.currentPeriodStart,
            currentPeriodEnd: gracePeriodEnd,
            updatedAt: now,
          })
          .where(eq(companySubscriptionsTable.id, existingSub.id));

        logger.info(
          { companyId, stripeSubscriptionId: stripeSub.id, gracePeriodEnd: gracePeriodEnd.toISOString() },
          "Trial expired — entered grace period; data retained",
        );
      } else {
        // Grace period has elapsed — mark as expired (data preserved)
        await db
          .update(companySubscriptionsTable)
          .set({
            status: "expired",
            canceledAt: now,
            updatedAt: now,
          })
          .where(eq(companySubscriptionsTable.id, existingSub.id));

        logger.info(
          { companyId, stripeSubscriptionId: stripeSub.id },
          "Grace period elapsed — subscription marked as expired; data retained for re-activation",
        );
      }
    }
  };

  const getSubscriptionInternal = async (companyId: string) => {
    const subscription = await db
      .select()
      .from(companySubscriptionsTable)
      .where(eq(companySubscriptionsTable.companyId, companyId))
      .then((r) => r[0] ?? null);

    if (!subscription) return null;

    const tier = await db
      .select()
      .from(subscriptionTiersTable)
      .where(eq(subscriptionTiersTable.id, subscription.tierId))
      .then((r) => r[0] ?? null);

    const usage = await db
      .select()
      .from(subscriptionUsageTable)
      .where(
        and(
          eq(subscriptionUsageTable.subscriptionId, subscription.id),
          eq(subscriptionUsageTable.periodStart, subscription.currentPeriodStart),
          eq(subscriptionUsageTable.periodEnd, subscription.currentPeriodEnd),
        ),
      );

    return {
      ...subscription,
      tier,
      usage,
    };
  };

  /**
   * Evaluate whether the company's current subscription grants access to a
   * feature key. Pure check — never throws; callers decide how to react.
   *
   * Rules:
   * 1. Free features (FREE_FEATURES) are always allowed.
   * 2. A paid feature requires an active/trialing subscription.
   * 3. If the subscription is scheduled to cancel (cancelAtPeriodEnd) and the
   *    current period has already ended, the company is degraded: paid
   *    features are denied (Stripe keeps the sub "active" until period end).
   * 4. The tier's `features` array must include the requested key.
   */
  const checkFeatureAccess = async (
    companyId: string,
    featureKey: string,
  ) => {
    const subscription = await db
      .select()
      .from(companySubscriptionsTable)
      .where(eq(companySubscriptionsTable.companyId, companyId))
      .then((r) => r[0] ?? null);

    const isFreeFeature = FREE_FEATURES.includes(featureKey as (typeof FREE_FEATURES)[number]);

    if (!subscription) {
      return {
        allowed: isFreeFeature,
        reason: isFreeFeature ? "free_feature" : "no_subscription",
        subscription: null,
        tier: null,
      } as const;
    }

    const tier = await db
      .select()
      .from(subscriptionTiersTable)
      .where(eq(subscriptionTiersTable.id, subscription.tierId))
      .then((r) => r[0] ?? null);

    if (!tier) {
      return {
        allowed: isFreeFeature,
        reason: isFreeFeature ? "free_feature" : "feature_not_in_tier",
        subscription,
        tier: null,
      } as const;
    }

    if (isFreeFeature) {
      return { allowed: true, reason: "free_feature", subscription, tier } as const;
    }

    if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status as (typeof ACTIVE_SUBSCRIPTION_STATUSES)[number])) {
      return { allowed: false, reason: "subscription_inactive", subscription, tier } as const;
    }

    // Degradation: cancellation takes effect at period end. Once the paid
    // period has elapsed, paid features are denied even though Stripe may
    // still report the subscription as "active" until it finally cancels.
    if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
      const now = new Date();
      if (subscription.currentPeriodEnd.getTime() <= now.getTime()) {
        return { allowed: false, reason: "canceled_at_period_end", subscription, tier } as const;
      }
    }

    const tierFeatures = Array.isArray(tier.features) ? tier.features : [];
    if (tierFeatures.includes(featureKey)) {
      return { allowed: true, reason: "tier_includes_feature", subscription, tier } as const;
    }

    return { allowed: false, reason: "feature_not_in_tier", subscription, tier } as const;
  };

  /**
   * Require feature access for a company, throwing a 403 Paywall error when
   * the feature is not available under the company's current subscription.
   * This is the primary API for route/service-level gating.
   */
  const requireFeature = async (companyId: string, featureKey: string) => {
    const result = await checkFeatureAccess(companyId, featureKey);
    if (result.allowed) return result;

    const tierName = result.tier?.name ?? null;
    const messageByReason: Record<string, string> = {
      no_subscription: "This feature requires an active subscription.",
      subscription_inactive: "Your subscription is not active. Reactivate it to use this feature.",
      canceled_at_period_end: "Your subscription has ended. Renew to keep using this feature.",
      feature_not_in_tier: `This feature is not included in your current plan${tierName ? ` (${tierName})` : ""}.`,
    };

    throw paywall(messageByReason[result.reason ?? "feature_not_in_tier"], {
      featureKey,
      tierName: tierName ?? undefined,
    });
  };

  return {
    listTiers: async (companyId?: string) => {
      const tiers = await db
        .select()
        .from(subscriptionTiersTable)
        .where(eq(subscriptionTiersTable.isActive, true))
        .orderBy(subscriptionTiersTable.sortOrder);

      // Fire conversion-tracking event (best-effort, never blocks the response)
      if (companyId) {
        let hasExistingSubscription = false;
        try {
          const existing = await db
            .select({ id: companySubscriptionsTable.id })
            .from(companySubscriptionsTable)
            .where(
              and(
                eq(companySubscriptionsTable.companyId, companyId),
                sql`${companySubscriptionsTable.status} = ANY(${ACTIVE_SUBSCRIPTION_STATUSES}::text[])`,
              ),
            )
            .limit(1)
            .then((r) => r[0] ?? null);
          hasExistingSubscription = existing !== null;
        } catch {
          // Best-effort — analytics failure never blocks the response.
        }

        captureMetric("pricing.page_view", companyId, {
          companyId,
          tierIds: tiers.map((t) => t.id),
          tierNames: tiers.map((t) => t.name),
          hasExistingSubscription,
        });
      }

      // Apply pricing experiment tier overrides when companyId is provided
      if (companyId && experiment) {
        const variant = await experiment.getOrAssignVariant(companyId);
        return experiment.applyTierOverrides(tiers, variant);
      }
      return tiers;
    },

    getTier,

    getOrCreateStripeCustomer,

    /**
     * Start a self-serve trial for a company.
     *
     * Creates or reuses a Stripe customer and provisions a trial subscription
     * with the Trial tier. Idempotent: returns the existing subscription if
     * one already exists for this company.
     *
     * Does NOT require board-level access — this is the self-serve entry point.
     */
    startTrial: async (companyId: string, data: { billingPeriod: "monthly" | "yearly" }) => {
      // Check for existing subscription — idempotent: if the company already
      // has a subscription (trial or paid), return it as-is.
      const existingSub = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      if (existingSub) {
        const tier = await getTier(existingSub.tierId);
        return {
          subscriptionId: existingSub.id,
          tierId: existingSub.tierId,
          tierName: tier?.name ?? null,
          status: existingSub.status,
          trialEnd: existingSub.trialEnd?.toISOString() ?? null,
          currentPeriodEnd: existingSub.currentPeriodEnd?.toISOString() ?? null,
          alreadyExisted: true,
        };
      }

      // Look up the Trial tier
      const [trialTier] = await db
        .select()
        .from(subscriptionTiersTable)
        .where(eq(subscriptionTiersTable.name, "Trial"))
        .then((r) => r);

      if (!trialTier) {
        throw notFound("Trial tier not found. Run migration 0232_trial_tier_seed to create it.");
      }

      // Create or get Stripe customer
      const { id: stripeCustomerId, stripeCustomerId: stripeCustId } =
        await getOrCreateStripeCustomer(companyId);

      // Determine the trial duration: 14 days from now.
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const { periodStart, periodEnd } = currentPeriodRange(data.billingPeriod);

      // Create a subscription record directly. The trial is handled locally
      // without requiring a Stripe subscription — we track trialEnd locally
      // and the feature gate checks the "trialing" status.
      // If Stripe is configured, also create a trial subscription in Stripe
      // so it can handle payment collection at trial end.
      const stripe = getStripeClient();
      const stripePriceId = data.billingPeriod === "yearly"
        ? (trialTier.stripePriceYearlyId ?? trialTier.stripePriceMonthlyId)
        : (trialTier.stripePriceMonthlyId ?? trialTier.stripePriceYearlyId);

      let stripeSubscriptionId: string | null = null;
      let stripeSubscriptionItemId: string | null = null;
      let stripeStatus: string = "trialing";

      if (stripePriceId) {
        try {
          const stripeSub = await withStripeRetry(
            () => stripe.subscriptions.create({
              customer: stripeCustId,
              items: [{ price: stripePriceId }],
              trial_period_days: 14,
              metadata: {
                paperclipCompanyId: companyId,
                paperclipTierId: trialTier.id,
                billingPeriod: data.billingPeriod,
              },
              proration_behavior: "create_prorations",
              trial_settings: {
                end_behavior: {
                  missing_payment_method: "cancel",
                },
              },
            }),
            "startTrial",
          );
          stripeSubscriptionId = stripeSub.id;
          stripeSubscriptionItemId = stripeSub.items.data[0]?.id ?? null;
          stripeStatus = stripeSub.status;
        } catch (err) {
          logger.warn(
            { companyId, err },
            "Failed to create Stripe trial subscription — falling back to local-only trial",
          );
        }
      }

      const created = await db
        .insert(companySubscriptionsTable)
        .values({
          companyId,
          tierId: trialTier.id,
          stripeCustomerId,
          status: stripeStatus,
          billingPeriod: data.billingPeriod,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          stripeSubscriptionId: stripeSubscriptionId,
          stripeSubscriptionItemId,
          cancelAtPeriodEnd: false,
          trialEnd,
        })
        .returning()
        .then((r) => r[0]!);

      // Create initial usage records for the trial tier
      const usageMetrics: Array<{ metric: string; included: number }> = [
        { metric: "seats", included: trialTier.includedSeats },
        { metric: "agent_runs", included: trialTier.includedAgentRuns },
        { metric: "storage_gb", included: trialTier.includedStorageGb },
      ];

      for (const m of usageMetrics) {
        await db.insert(subscriptionUsageTable).values({
          companyId,
          subscriptionId: created.id,
          metric: m.metric,
          usage: 0,
          included: m.included,
          overage: 0,
          overageCents: 0,
          periodStart,
          periodEnd,
        });
      }

      logger.info(
        { companyId, tierId: trialTier.id, trialEnd: trialEnd.toISOString() },
        "Self-serve trial started",
      );

      publishLiveEvent({
        companyId,
        type: "subscription.status.updated",
        payload: {
          status: stripeStatus,
          stripeSubscriptionId,
          cancelAtPeriodEnd: false,
          tierId: trialTier.id,
        },
      });

      // GA4 tracking: fire trial_started event
      getGa4AnalyticsService().send(buildTrialStartEvent(companyId, trialTier.id, data.billingPeriod));

      return {
        subscriptionId: created.id,
        tierId: trialTier.id,
        tierName: trialTier.name,
        status: stripeStatus,
        trialEnd: trialEnd.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        alreadyExisted: false,
      };
    },

    /**
     * Get the current trial status for a company.
     */
    getTrialStatus: async (companyId: string): Promise<TrialStatusResponse> => {
      const subscription = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      if (!subscription || !subscription.trialEnd) {
        return {
          isTrialing: false,
          trialEnd: null,
          tierId: null,
          tierName: null,
          daysRemaining: null,
          status: subscription?.status ?? null,
        };
      }

      const tier = await getTier(subscription.tierId);
      const now = new Date();
      const daysRemaining = subscription.trialEnd.getTime() > now.getTime()
        ? Math.ceil((subscription.trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : 0;

      return {
        isTrialing: subscription.status === "trialing" || daysRemaining > 0,
        trialEnd: subscription.trialEnd.toISOString(),
        tierId: subscription.tierId,
        tierName: tier?.name ?? null,
        daysRemaining,
        status: subscription.status,
      };
    },

    getSubscription: getSubscriptionInternal,

    checkFeatureAccess,
    requireFeature,

    createCheckoutSession: async (
      companyId: string,
      data: { tierId: string; billingPeriod: "monthly" | "yearly"; successUrl?: string; cancelUrl?: string },
    ) => {
      const stripe = getStripeClient();
      const tier = await getTier(data.tierId);

      const stripePriceId = data.billingPeriod === "yearly"
        ? (tier.stripePriceYearlyId ?? tier.stripePriceMonthlyId)
        : (tier.stripePriceMonthlyId ?? tier.stripePriceYearlyId);

      if (!stripePriceId) {
        throw unprocessable("Selected tier does not have a Stripe price configured");
      }

      const { stripeCustomerId } = await getOrCreateStripeCustomer(companyId);

      const publicUrl = process.env.PAPERCLIP_PUBLIC_URL ?? "http://localhost:5173";
      const successUrl = data.successUrl ?? `${publicUrl}/boards/${companyId}`;
      const cancelUrl = data.cancelUrl ?? `${publicUrl}/pricing`;

      const session = await withStripeRetry(
        () => stripe.checkout.sessions.create({
          mode: "subscription",
          customer: stripeCustomerId,
          line_items: [{ price: stripePriceId, quantity: 1 }],
          subscription_data: {
            trial_settings: {
              end_behavior: {
                missing_payment_method: "cancel",
              },
            },
          },
          metadata: {
            paperclipCompanyId: companyId,
            paperclipTierId: data.tierId,
            billingPeriod: data.billingPeriod,
          },
          success_url: successUrl,
          cancel_url: cancelUrl,
        }),
        "createCheckoutSession",
      );

      logger.info({ companyId, sessionId: session.id }, "Created Checkout Session");

      // Fire checkout_started conversion event (best-effort, never blocks)
      captureMetric("pricing.checkout_started", companyId, {
        companyId,
        tierId: data.tierId,
        billingPeriod: data.billingPeriod,
        sessionId: session.id,
      });

      return { url: session.url, sessionId: session.id };
    },

    getBillingPortalLink: async (companyId: string, returnUrl?: string) => {
      const stripe = getStripeClient();
      const { stripeCustomerId } = await getOrCreateStripeCustomer(companyId);

      const publicUrl = process.env.PAPERCLIP_PUBLIC_URL ?? "http://localhost:5173";
      const portalReturnUrl = returnUrl ?? `${publicUrl}/boards/${companyId}`;

      const portalSession = await withStripeRetry(
        () => stripe.billingPortal.sessions.create({
          customer: stripeCustomerId,
          return_url: portalReturnUrl,
        }),
        "getBillingPortalLink",
      );

      logger.info({ companyId, portalUrl: portalSession.url }, "Created billing portal session");

      return { url: portalSession.url };
    },

    createOrUpdateSubscription: async (
      companyId: string,
      data: { tierId: string; billingPeriod: "monthly" | "yearly" },
    ) => {
      const stripe = getStripeClient();
      const tier = await db
        .select()
        .from(subscriptionTiersTable)
        .where(eq(subscriptionTiersTable.id, data.tierId))
        .then((r) => r[0] ?? null);
      if (!tier) throw notFound("Subscription tier not found");

      if (!tier.stripePriceMonthlyId && !tier.stripePriceYearlyId) {
        throw unprocessable("Selected tier does not have a Stripe price configured");
      }

      const stripePriceId = data.billingPeriod === "yearly"
        ? (tier.stripePriceYearlyId ?? tier.stripePriceMonthlyId)
        : (tier.stripePriceMonthlyId ?? tier.stripePriceYearlyId);

      const { id: stripeCustomerId } = await getOrCreateStripeCustomer(companyId);
      const { periodStart, periodEnd } = currentPeriodRange(data.billingPeriod);

      const existingSub = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      let stripeSubscription: Stripe.Subscription;
      let stripeSubItemId: string | null = null;

      if (existingSub?.stripeSubscriptionId) {
        const existingSubId = existingSub.stripeSubscriptionId!;
        const sub = await withStripeRetry(
          () => stripe.subscriptions.retrieve(existingSubId),
          "createOrUpdateSubscription:subscriptions.retrieve",
        );
        const subscriptionItemId = sub.items.data[0]?.id;

        stripeSubscription = await withStripeRetry(
          () => stripe.subscriptions.update(existingSubId, {
            items: subscriptionItemId
              ? [{ id: subscriptionItemId, price: stripePriceId! }]
              : [{ price: stripePriceId! }],
            proration_behavior: "create_prorations",
            metadata: {
              paperclipCompanyId: companyId,
              paperclipTierId: data.tierId,
            },
          }),
          "createOrUpdateSubscription:subscriptions.update",
        );

        stripeSubItemId = stripeSubscription.items.data[0]?.id ?? null;

        const updated = await db
          .update(companySubscriptionsTable)
          .set({
            tierId: data.tierId,
            billingPeriod: data.billingPeriod,
            stripeSubscriptionItemId: stripeSubItemId,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            status: stripeSubscription.status,
            updatedAt: new Date(),
          })
          .where(eq(companySubscriptionsTable.id, existingSub.id))
          .returning()
          .then((r) => r[0]);

        logger.info(
          { companyId, tierId: data.tierId, stripeSubscriptionId: stripeSubscription.id },
          "Updated subscription",
        );

        publishLiveEvent({
          companyId,
          type: "subscription.status.updated",
          payload: {
            status: stripeSubscription.status,
            stripeSubscriptionId: stripeSubscription.id,
            cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            tierId: data.tierId,
          },
        });

        return updated;
      }

      const cust = await db
        .select()
        .from(stripeCustomersTable)
        .where(eq(stripeCustomersTable.id, stripeCustomerId))
        .then((r) => r[0]);

      stripeSubscription = await withStripeRetry(
        () => stripe.subscriptions.create({
          customer: cust.stripeCustomerId,
          items: [{ price: stripePriceId! }],
          metadata: {
            paperclipCompanyId: companyId,
            paperclipTierId: data.tierId,
          },
          proration_behavior: "create_prorations",
        }),
        "createOrUpdateSubscription:subscriptions.create",
      );

      stripeSubItemId = stripeSubscription.items.data[0]?.id ?? null;

      const created = await db
        .insert(companySubscriptionsTable)
        .values({
          companyId,
          tierId: data.tierId,
          stripeCustomerId,
          status: stripeSubscription.status,
          billingPeriod: data.billingPeriod,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          stripeSubscriptionId: stripeSubscription.id,
          stripeSubscriptionItemId: stripeSubItemId,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
        })
        .returning()
        .then((r) => r[0]);

      const usageMetrics: Array<{ metric: string; included: number }> = [
        { metric: "seats", included: tier.includedSeats },
        { metric: "agent_runs", included: tier.includedAgentRuns },
        { metric: "storage_gb", included: tier.includedStorageGb },
      ];

      for (const m of usageMetrics) {
        await db.insert(subscriptionUsageTable).values({
          companyId,
          subscriptionId: created.id,
          metric: m.metric,
          usage: 0,
          included: m.included,
          overage: 0,
          overageCents: 0,
          periodStart: created.currentPeriodStart,
          periodEnd: created.currentPeriodEnd,
        });
      }

      logger.info(
        { companyId, tierId: data.tierId, stripeSubscriptionId: stripeSubscription.id },
        "Created subscription",
      );

      publishLiveEvent({
        companyId,
        type: "subscription.status.updated",
        payload: {
          status: stripeSubscription.status,
          stripeSubscriptionId: stripeSubscription.id,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          tierId: data.tierId,
        },
      });

      return created;
    },

    cancelSubscription: async (companyId: string) => {
      const stripe = getStripeClient();

      const subscription = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      if (!subscription) throw notFound("No active subscription found");
      if (!subscription.stripeSubscriptionId) throw unprocessable("No Stripe subscription to cancel");

      const cancelSubId = subscription.stripeSubscriptionId!;
      await withStripeRetry(
        () => stripe.subscriptions.update(cancelSubId, {
          cancel_at_period_end: true,
        }),
        "cancelSubscription",
      );

      const updated = await db
        .update(companySubscriptionsTable)
        .set({
          cancelAtPeriodEnd: true,
          updatedAt: new Date(),
        })
        .where(eq(companySubscriptionsTable.id, subscription.id))
        .returning()
        .then((r) => r[0]);

      logger.info({ companyId, stripeSubscriptionId: subscription.stripeSubscriptionId }, "Scheduled subscription cancellation");

      publishLiveEvent({
        companyId,
        type: "subscription.status.updated",
        payload: {
          status: "active",
          stripeSubscriptionId: subscription.stripeSubscriptionId!,
          cancelAtPeriodEnd: true,
          tierId: subscription.tierId,
        },
      });

      // Fire subscription_canceled conversion event (best-effort, never blocks)
      captureMetric("pricing.subscription_canceled", companyId, {
        companyId,
        stripeSubscriptionId: subscription.stripeSubscriptionId!,
        tierId: subscription.tierId,
        canceledAt: new Date().toISOString(),
        cancelAtPeriodEnd: true,
        source: "api",
      });

      return updated;
    },

    reactivateSubscription: async (companyId: string) => {
      const stripe = getStripeClient();

      const subscription = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      if (!subscription) throw notFound("No active subscription found");
      if (!subscription.stripeSubscriptionId) throw unprocessable("No Stripe subscription to reactivate");
      if (!subscription.cancelAtPeriodEnd) throw unprocessable("Subscription is not scheduled for cancellation");

      const reactivateSubId = subscription.stripeSubscriptionId!;
      await withStripeRetry(
        () => stripe.subscriptions.update(reactivateSubId, {
          cancel_at_period_end: false,
        }),
        "reactivateSubscription",
      );

      const updated = await db
        .update(companySubscriptionsTable)
        .set({
          cancelAtPeriodEnd: false,
          updatedAt: new Date(),
        })
        .where(eq(companySubscriptionsTable.id, subscription.id))
        .returning()
        .then((r) => r[0]);

      logger.info({ companyId }, "Reactivated subscription");

      publishLiveEvent({
        companyId,
        type: "subscription.status.updated",
        payload: {
          status: "active",
          stripeSubscriptionId: subscription.stripeSubscriptionId!,
          cancelAtPeriodEnd: false,
          tierId: subscription.tierId,
        },
      });

      return updated;
    },

    reportUsage: async (
      companyId: string,
      data: { metric: "seats" | "agent_runs" | "storage_gb"; quantity: number },
    ) => {
      const subscription = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      if (!subscription) throw notFound("No active subscription found");
      if (subscription.status !== "active") throw unprocessable("Subscription is not active");

      const { periodStart, periodEnd } = currentPeriodRange(
        subscription.billingPeriod as "monthly" | "yearly",
      );

      let usageRecord = await db
        .select()
        .from(subscriptionUsageTable)
        .where(
          and(
            eq(subscriptionUsageTable.subscriptionId, subscription.id),
            eq(subscriptionUsageTable.metric, data.metric),
            eq(subscriptionUsageTable.periodStart, periodStart),
            eq(subscriptionUsageTable.periodEnd, periodEnd),
          ),
        )
        .then((r) => r[0] ?? null);

      const tier = await getTier(subscription.tierId);
      const includedMap: Record<string, number> = {
        seats: tier.includedSeats,
        agent_runs: tier.includedAgentRuns,
        storage_gb: tier.includedStorageGb,
      };
      const priceMap: Record<string, number> = {
        seats: tier.extraSeatPriceCents,
        agent_runs: tier.extraAgentRunPriceCents,
        storage_gb: tier.extraStorageGbPriceCents,
      };

      const included = includedMap[data.metric] ?? 0;
      const usage = data.quantity;
      const overage = Math.max(0, usage - included);
      const overageCents = overage * (priceMap[data.metric] ?? 0);

      if (usageRecord) {
        usageRecord = await db
          .update(subscriptionUsageTable)
          .set({
            usage,
            overage,
            overageCents,
            updatedAt: new Date(),
          })
          .where(eq(subscriptionUsageTable.id, usageRecord.id))
          .returning()
          .then((r) => r[0]);
      } else {
        usageRecord = await db
          .insert(subscriptionUsageTable)
          .values({
            companyId,
            subscriptionId: subscription.id,
            metric: data.metric,
            usage,
            included,
            overage,
            overageCents,
            periodStart,
            periodEnd,
          })
          .returning()
          .then((r) => r[0]);
      }

      if (subscription.stripeSubscriptionItemId) {
        try {
          const stripe = getStripeClient();
          const itemId: string = subscription.stripeSubscriptionItemId;
          await withStripeRetry(
            () => stripe.subscriptionItems.createUsageRecord(
              itemId,
              {
                quantity: data.quantity,
                timestamp: Math.floor(Date.now() / 1000),
                action: "set",
              },
            ),
            "reportUsage",
          );
        } catch (err) {
          logger.warn(
            { err, companyId, metric: data.metric },
            "Failed to report usage to Stripe (non-fatal)",
          );
        }
      }

      return usageRecord;
    },

    getUsage: async (companyId: string) => {
      const subscription = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      if (!subscription) return [];

      return db
        .select()
        .from(subscriptionUsageTable)
        .where(
          and(
            eq(subscriptionUsageTable.subscriptionId, subscription.id),
            eq(subscriptionUsageTable.periodStart, subscription.currentPeriodStart),
            eq(subscriptionUsageTable.periodEnd, subscription.currentPeriodEnd),
          ),
        );
    },

    listInvoices,

    syncInvoicesFromStripe: async (companyId: string) => {
      const stripe = getStripeClient();
      const subscription = await db
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, companyId))
        .then((r) => r[0] ?? null);

      if (!subscription?.stripeSubscriptionId) {
        throw notFound("No subscription with Stripe integration found");
      }

      const subId: string = subscription.stripeSubscriptionId;
      const stripeInvoices = await withStripeRetry(
        () => stripe.invoices.list({
          subscription: subId as string | undefined,
          limit: 100,
        }),
        "syncInvoicesFromStripe",
      );

      for (const inv of stripeInvoices.data) {
        // Upsert: INSERT ... ON CONFLICT (stripe_invoice_id) DO UPDATE
        // Handles at-least-once sync without a SELECT-then-INSERT race.
        await db.execute(sql`
          INSERT INTO "subscription_invoices"
            ("company_id", "subscription_id", "stripe_invoice_id", "invoice_number", "status",
             "amount_cents", "amount_paid_cents", "amount_remaining_cents", "currency",
             "invoice_pdf_url", "hosted_invoice_url", "period_start", "period_end",
             "created_at", "updated_at")
          VALUES (
            ${companyId}, ${subscription.id}, ${inv.id}, ${inv.number ?? null}, ${inv.status ?? "unknown"},
            ${inv.total}, ${inv.amount_paid}, ${inv.amount_remaining}, ${inv.currency},
            ${inv.invoice_pdf ?? null}, ${inv.hosted_invoice_url ?? null},
            ${inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null},
            ${inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null},
            NOW(), NOW()
          )
          ON CONFLICT ("stripe_invoice_id") DO UPDATE SET
            "company_id" = EXCLUDED."company_id",
            "subscription_id" = EXCLUDED."subscription_id",
            "invoice_number" = EXCLUDED."invoice_number",
            "status" = EXCLUDED."status",
            "amount_cents" = EXCLUDED."amount_cents",
            "amount_paid_cents" = EXCLUDED."amount_paid_cents",
            "amount_remaining_cents" = EXCLUDED."amount_remaining_cents",
            "currency" = EXCLUDED."currency",
            "invoice_pdf_url" = EXCLUDED."invoice_pdf_url",
            "hosted_invoice_url" = EXCLUDED."hosted_invoice_url",
            "period_start" = EXCLUDED."period_start",
            "period_end" = EXCLUDED."period_end",
            "updated_at" = NOW()
        `);
      }

      return listInvoices(companyId);
    },

    // ── Pricing experiment integration ─────────────────────────────────

    getExperimentVariant: async (companyId: string): Promise<{ variant: PricingExperimentVariant; enabled: boolean }> => {
      if (!experiment) {
        return { variant: "A" as PricingExperimentVariant, enabled: false };
      }
      const variant = await experiment.getOrAssignVariant(companyId);
      const config = experiment.loadConfig();
      return { variant, enabled: config.enabled };
    },

    getExperimentResults: async () => {
      if (!experiment) {
        return { enabled: false, totalAssigned: 0, variantA: { count: 0 }, variantB: { count: 0 } };
      }
      return experiment.getResults();
    },

    // GA4 analytics helpers for pricing events
    trackPricingEvent: (eventName: string, companyId: string, params?: Record<string, string | number | boolean | null | undefined>) => {
      const ga4 = getGa4AnalyticsService();
      ga4.event(eventName, { company_id: companyId, ...params });
    },

    handleWebhook: async (rawBody: string, signature: string) => {
      if (!STRIPE_WEBHOOK_SECRET) {
        throw badRequest(
          "STRIPE_WEBHOOK_SECRET is not configured. Webhook signature verification is unavailable.",
        );
      }
      // Create a minimal Stripe client for signature verification only.
      // constructEvent() does not need the secret API key, only the webhook secret.
      const stripe = new Stripe("«redacted:sk_…»", {
        apiVersion: "2025-02-24.acacia",
      });
      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown webhook error";
        throw badRequest(`Webhook signature verification failed: ${message}`);
      }

      logger.info({ type: event.type, id: event.id }, "Processing Stripe webhook event");

      switch (event.type) {
        case "invoice.paid":
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          await handleInvoicePaid(invoice);
          break;
        }
        case "invoice.payment_failed": {
          const failedInvoice = event.data.object as Stripe.Invoice;
          await handleInvoicePaymentFailed(failedInvoice);
          break;
        }
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          await handleSubscriptionUpdated(sub);
          break;
        }
        case "customer.subscription.deleted": {
          const deletedSub = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(deletedSub);
          break;
        }
        case "customer.subscription.created": {
          const createdSub = event.data.object as Stripe.Subscription;
          await handleSubscriptionUpdated(createdSub);
          break;
        }
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          await handleCheckoutSessionCompleted(session);
          break;
        }
        case "customer.subscription.trial_will_end":
                // Trial ending soon — send notification and record the impending expiry
                await handleTrialWillEnd(event.data.object as Stripe.Subscription);
                break;
        default:
          logger.info({ type: event.type }, "Unhandled Stripe webhook event type");
      }

      // Event-level dedup: record the event AFTER successful processing.
      // If the INSERT succeeds it's the first time we see this event.
      // If it fails with a unique violation (23505), the event was already
      // processed — silently acknowledge.
      try {
        await db.insert(stripeWebhookEventsTable).values({
          stripeEventId: event.id,
          eventType: event.type,
        });
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr?.code === "23505") {
          logger.info(
            { type: event.type, id: event.id },
            "Duplicate Stripe webhook event — skipping (already processed)",
          );
          return { received: true, type: event.type };
        }
        throw err;
      }

      return { received: true, type: event.type };
    },

    handleInvoicePaid,
    handleInvoicePaymentFailed,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handleCheckoutSessionCompleted,
    handleTrialWillEnd,
    handlePostTrialStatus,

    getBillingOverview: async (companyId: string) => {
      const subscription = await getSubscriptionInternal(companyId);
      const invoices = await listInvoices(companyId);

      const totalSpentResult = await db
        .select({
          total: sql<number>`coalesce(sum(${subscriptionInvoicesTable.amountPaidCents}), 0)::int`,
        })
        .from(subscriptionInvoicesTable)
        .where(
          and(
            eq(subscriptionInvoicesTable.companyId, companyId),
            eq(subscriptionInvoicesTable.status, "paid"),
          ),
        )
        .then((r) => r[0] ?? null);

      return {
        companyId,
        subscription,
        invoices,
        usage: subscription?.usage ?? [],
        totalSpentCents: Number(totalSpentResult?.total ?? 0),
      };
    },
  };
}