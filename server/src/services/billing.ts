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
import { ACTIVE_SUBSCRIPTION_STATUSES, FREE_FEATURES } from "@paperclipai/shared";
import { badRequest, notFound, paywall, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";

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

export function billingService(db: Db) {
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

    const customer = await stripe.customers.create({
      name: company.name,
      description: `Paperclip company: ${company.name} (${companyId})`,
      metadata: {
        paperclipCompanyId: companyId,
      },
    });

    const record = await db
      .insert(stripeCustomersTable)
      .values({
        companyId,
        stripeCustomerId: customer.id,
      })
      .returning()
      .then((r) => r[0]);

    logger.info({ companyId, stripeCustomerId: customer.id }, "Created Stripe customer");

    return { id: record.id, stripeCustomerId: customer.id };
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
  };

  const handleInvoicePaymentFailed = async (invoice: Stripe.Invoice) => {
    if (!invoice.subscription) return;
    const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;

    const result = await db
      .update(companySubscriptionsTable)
      .set({
        status: "past_due",
        updatedAt: new Date(),
      })
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId))
      .returning()
      .then((r) => r[0] ?? null);

    logger.warn({ stripeSubscriptionId: subId, invoiceId: invoice.id }, "Subscription payment failed");

    if (result) {
      publishLiveEvent({
        companyId: result.companyId,
        type: "subscription.status.updated",
        payload: {
          status: "past_due",
          stripeSubscriptionId: subId,
          cancelAtPeriodEnd: result.cancelAtPeriodEnd,
          tierId: result.tierId,
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

    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id))
        .then((r) => r[0] ?? null);

      if (existing) {
        await tx
          .update(companySubscriptionsTable)
          .set({
            status: stripeSub.status,
            currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            updatedAt: new Date(),
            ...(stripeSub.canceled_at ? { canceledAt: new Date(stripeSub.canceled_at * 1000) } : {}),
          })
          .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id));
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
          ON CONFLICT ("stripe_subscription_id") DO UPDATE SET
            "status" = EXCLUDED."status",
            "current_period_start" = EXCLUDED."current_period_start",
            "current_period_end" = EXCLUDED."current_period_end",
            "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
            "updated_at" = NOW()
        `);

        logger.info(
          { stripeSubscriptionId: stripeSub.id, companyId, tierId },
          "Created subscription record from Stripe webhook (fallback)",
        );
      }
    });

    logger.info({ stripeSubscriptionId: stripeSub.id, status: stripeSub.status }, "Subscription status synced from Stripe");

    publishLiveEvent({
      companyId,
      type: "subscription.status.updated",
      payload: {
        status: stripeSub.status,
        stripeSubscriptionId: stripeSub.id,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        tierId: tierId ?? null,
      },
    });
  };

  const handleSubscriptionDeleted = async (stripeSub: Stripe.Subscription) => {
    const companyId = stripeSub.metadata?.paperclipCompanyId;

    await db
      .update(companySubscriptionsTable)
      .set({
        status: "canceled",
        canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id));

    logger.info({ stripeSubscriptionId: stripeSub.id }, "Subscription canceled via Stripe");

    if (companyId) {
      publishLiveEvent({
        companyId,
        type: "subscription.status.updated",
        payload: {
          status: "canceled",
          stripeSubscriptionId: stripeSub.id,
          cancelAtPeriodEnd: false,
          tierId: stripeSub.metadata?.paperclipTierId ?? null,
        },
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
    const stripeSub = await stripe.subscriptions.retrieve(subId);

    const sessionCustomerId = session.customer
      ? (typeof session.customer === "string" ? session.customer : session.customer.id)
      : null;
    const stripeCustomerId = sessionCustomerId ?? stripeSub.customer as string;

    // Use transaction + upsert for idempotent handling of at-least-once Stripe delivery.
    // The UNIQUE index on stripe_subscription_id prevents duplicate rows; the upsert
    // makes the second-and-later deliveries a safe no-op.
    await db.transaction(async (tx) => {
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

      // Upsert: INSERT ... ON CONFLICT (stripe_subscription_id) DO UPDATE
      // Handles at-least-once delivery from Stripe (race-free with the UNIQUE index)
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
        ON CONFLICT ("stripe_subscription_id") DO UPDATE SET
          "status" = EXCLUDED."status",
          "current_period_start" = EXCLUDED."current_period_start",
          "current_period_end" = EXCLUDED."current_period_end",
          "cancel_at_period_end" = EXCLUDED."cancel_at_period_end",
          "updated_at" = NOW()
      `);

      // Insert usage metrics with ON CONFLICT DO NOTHING — if the row already exists
      // from a duplicate event the unique constraint silently prevents re-insertion.
      const usageMetrics: Array<{ metric: string; included: number }> = [
        { metric: "seats", included: tier.includedSeats },
        { metric: "agent_runs", included: tier.includedAgentRuns },
        { metric: "storage_gb", included: tier.includedStorageGb },
      ];

      for (const m of usageMetrics) {
        await tx.execute(sql`
          INSERT INTO "subscription_usage"
            ("company_id", "subscription_id", "metric", "usage", "included",
             "overage", "overage_cents", "period_start", "period_end")
          VALUES (
            ${companyId},
            (SELECT "id" FROM "company_subscriptions" WHERE "stripe_subscription_id" = ${subId}),
            ${m.metric}, 0, ${m.included},
            0, 0,
            ${new Date(stripeSub.current_period_start * 1000).toISOString()},
            ${new Date(stripeSub.current_period_end * 1000).toISOString()}
          )
          ON CONFLICT ("subscription_id", "metric", "period_start", "period_end") DO NOTHING
        `);
      }

      logger.info(
        { companyId, tierId, stripeSubscriptionId: subId },
        "Created subscription from Checkout Session",
      );
    });

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
    listTiers: async () => {
      return db
        .select()
        .from(subscriptionTiersTable)
        .where(eq(subscriptionTiersTable.isActive, true))
        .orderBy(subscriptionTiersTable.sortOrder);
    },

    getTier,

    getOrCreateStripeCustomer,

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

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        metadata: {
          paperclipCompanyId: companyId,
          paperclipTierId: data.tierId,
          billingPeriod: data.billingPeriod,
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      logger.info({ companyId, sessionId: session.id }, "Created Checkout Session");

      return { url: session.url, sessionId: session.id };
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
        const sub = await stripe.subscriptions.retrieve(existingSub.stripeSubscriptionId);
        const subscriptionItemId = sub.items.data[0]?.id;

        stripeSubscription = await stripe.subscriptions.update(existingSub.stripeSubscriptionId, {
          items: subscriptionItemId
            ? [{ id: subscriptionItemId, price: stripePriceId! }]
            : [{ price: stripePriceId! }],
          proration_behavior: "create_prorations",
          metadata: {
            paperclipCompanyId: companyId,
            paperclipTierId: data.tierId,
          },
        });

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

      stripeSubscription = await stripe.subscriptions.create({
        customer: cust.stripeCustomerId,
        items: [{ price: stripePriceId! }],
        metadata: {
          paperclipCompanyId: companyId,
          paperclipTierId: data.tierId,
        },
        proration_behavior: "create_prorations",
      });

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

      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

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
          status: subscription.status,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          cancelAtPeriodEnd: true,
          tierId: subscription.tierId,
        },
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

      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

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
          status: subscription.status,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
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
          await stripe.subscriptionItems.createUsageRecord(
            subscription.stripeSubscriptionItemId,
            {
              quantity: data.quantity,
              timestamp: Math.floor(Date.now() / 1000),
              action: "set",
            },
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

      const stripeInvoices = await stripe.invoices.list({
        subscription: subscription.stripeSubscriptionId,
        limit: 100,
      });

      for (const inv of stripeInvoices.data) {
        // Upsert: INSERT ... ON CONFLICT (stripe_invoice_id) DO UPDATE
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

      // Event-level dedup: record the event ID before processing.
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
          break;
        default:
          logger.info({ type: event.type }, "Unhandled Stripe webhook event type");
      }

      return { received: true, type: event.type };
    },

    handleInvoicePaid,
    handleInvoicePaymentFailed,
    handleSubscriptionUpdated,
    handleSubscriptionDeleted,
    handleCheckoutSessionCompleted,

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