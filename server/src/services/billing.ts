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
} from "@paperclipai/db";
import { badRequest, notFound, unprocessable } from "../errors.js";
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

    const sub = await db
      .select()
      .from(companySubscriptionsTable)
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId))
      .then((r) => r[0] ?? null);

    if (!sub) {
      logger.warn({ stripeSubscriptionId: subId }, "Received invoice for unknown subscription");
      return;
    }

    const existing = await db
      .select()
      .from(subscriptionInvoicesTable)
      .where(eq(subscriptionInvoicesTable.stripeInvoiceId, invoice.id))
      .then((r) => r[0] ?? null);

    const invoiceData = {
      companyId: sub.companyId,
      subscriptionId: sub.id,
      stripeInvoiceId: invoice.id,
      invoiceNumber: invoice.number ?? null,
      status: invoice.status ?? "paid",
      amountCents: invoice.total,
      amountPaidCents: invoice.amount_paid,
      amountRemainingCents: invoice.amount_remaining,
      currency: invoice.currency,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    };

    if (existing) {
      await db
        .update(subscriptionInvoicesTable)
        .set({ ...invoiceData, updatedAt: new Date() })
        .where(eq(subscriptionInvoicesTable.id, existing.id));
    } else {
      await db
        .insert(subscriptionInvoicesTable)
        .values(invoiceData);
    }
  };

  const handleInvoicePaymentFailed = async (invoice: Stripe.Invoice) => {
    if (!invoice.subscription) return;
    const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;

    await db
      .update(companySubscriptionsTable)
      .set({
        status: "past_due",
        updatedAt: new Date(),
      })
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, subId));

    logger.warn({ stripeSubscriptionId: subId, invoiceId: invoice.id }, "Subscription payment failed");
  };

  const handleSubscriptionUpdated = async (stripeSub: Stripe.Subscription) => {
    const companyId = stripeSub.metadata?.paperclipCompanyId;
    if (!companyId) {
      logger.warn({ stripeSubscriptionId: stripeSub.id }, "No paperclipCompanyId in subscription metadata");
      return;
    }

    const updateData: Record<string, unknown> = {
      status: stripeSub.status,
      currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      updatedAt: new Date(),
    };

    if (stripeSub.canceled_at) {
      updateData.canceledAt = new Date(stripeSub.canceled_at * 1000);
    }

    await db
      .update(companySubscriptionsTable)
      .set(updateData)
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id));

    logger.info({ stripeSubscriptionId: stripeSub.id, status: stripeSub.status }, "Subscription status synced from Stripe");
  };

  const handleSubscriptionDeleted = async (stripeSub: Stripe.Subscription) => {
    await db
      .update(companySubscriptionsTable)
      .set({
        status: "canceled",
        canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id));

    logger.info({ stripeSubscriptionId: stripeSub.id }, "Subscription canceled via Stripe");
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
        const existing = await db
          .select()
          .from(subscriptionInvoicesTable)
          .where(eq(subscriptionInvoicesTable.stripeInvoiceId, inv.id))
          .then((r) => r[0] ?? null);

        const invoiceData = {
          companyId,
          subscriptionId: subscription.id,
          stripeInvoiceId: inv.id,
          invoiceNumber: inv.number ?? null,
          status: inv.status ?? "unknown",
          amountCents: inv.total,
          amountPaidCents: inv.amount_paid,
          amountRemainingCents: inv.amount_remaining,
          currency: inv.currency,
          invoicePdfUrl: inv.invoice_pdf ?? null,
          hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
          periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
          periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
        };

        if (existing) {
          await db
            .update(subscriptionInvoicesTable)
            .set({ ...invoiceData, updatedAt: new Date() })
            .where(eq(subscriptionInvoicesTable.id, existing.id));
        } else {
          await db
            .insert(subscriptionInvoicesTable)
            .values(invoiceData);
        }
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
      const stripe = new Stripe("sk_placeholder_for_webhook_verification_only", {
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