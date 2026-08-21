import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  companySubscriptions,
  createDb,
  stripeCustomers,
  subscriptionTiers,
  subscriptionUsage,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping checkout session webhook tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// Mock the Stripe SDK at module level so no network calls are made.
const mockRetrieve = vi.fn();
vi.mock("stripe", () => ({
  default: function MockStripe() {
    return {
      subscriptions: { retrieve: mockRetrieve },
      webhooks: {
        constructEvent: vi.fn(),
      },
      checkout: {
        sessions: { create: vi.fn() },
      },
    };
  },
}));

describeEmbeddedPostgres("checkout.session.completed webhook handler", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let billing: ReturnType<typeof import("../services/billing.js")["billingService"]>;
  let companyId: string;
  let tierId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-billing-checkout-");
    db = createDb(tempDb.connectionString);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mockkeythatbypassesenvguard");

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Checkout Test Co",
      status: "active",
      issuePrefix: "CKO",
      updatedAt: new Date(),
    });

    tierId = randomUUID();
    await db.insert(subscriptionTiers).values({
      id: tierId,
      name: "Test Tier",
      priceMonthlyCents: 2900,
      priceYearlyCents: 29000,
      stripePriceMonthlyId: "price_mock_monthly",
      stripePriceYearlyId: "price_mock_yearly",
      includedSeats: 5,
      includedAgentRuns: 100,
      includedStorageGb: 10,
      features: [],
      isActive: true,
      sortOrder: 0,
    });

    await db.insert(stripeCustomers).values({
      companyId,
      stripeCustomerId: "cus_mock_customer",
    });

    billing = (await import("../services/billing.js")).billingService(db);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await tempDb?.cleanup();
  });

  it("creates subscription from checkout.session.completed event", async () => {
    mockRetrieve.mockResolvedValue({
      id: "sub_mock_checkout",
      status: "active",
      customer: "cus_mock_customer",
      current_period_start: Math.floor(Date.now() / 1000) - 86400,
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      trial_end: null,
      cancel_at: null,
      canceled_at: null,
      items: {
        data: [{ id: "si_mock_item" }],
      },
      metadata: {},
    });

    const session = {
      id: "cs_test_mock",
      mode: "subscription",
      subscription: "sub_mock_checkout",
      customer: "cus_mock_customer",
      metadata: {
        paperclipCompanyId: companyId,
        paperclipTierId: tierId,
        billingPeriod: "monthly",
      },
    };

    await billing.handleCheckoutSessionCompleted(session as any);

    const sub = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.stripeSubscriptionId, "sub_mock_checkout"))
      .then((r) => r[0] ?? null);

    expect(sub).not.toBeNull();
    expect(sub!.companyId).toBe(companyId);
    expect(sub!.tierId).toBe(tierId);
    expect(sub!.status).toBe("active");
    expect(sub!.billingPeriod).toBe("monthly");
    expect(sub!.stripeSubscriptionId).toBe("sub_mock_checkout");

    const usage = await db
      .select()
      .from(subscriptionUsage)
      .where(eq(subscriptionUsage.subscriptionId, sub!.id));

    expect(usage.length).toBe(3);
  });

  it("is idempotent — skips creation when subscription already exists", async () => {
    mockRetrieve.mockResolvedValue({
      id: "sub_mock_checkout",
      status: "active",
      customer: "cus_mock_customer",
      current_period_start: Math.floor(Date.now() / 1000) - 86400,
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      trial_end: null,
      cancel_at: null,
      canceled_at: null,
      items: {
        data: [{ id: "si_mock_item" }],
      },
      metadata: {},
    });

    const before = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.stripeSubscriptionId, "sub_mock_checkout"));

    const session = {
      id: "cs_test_mock",
      mode: "subscription",
      subscription: "sub_mock_checkout",
      customer: "cus_mock_customer",
      metadata: {
        paperclipCompanyId: companyId,
        paperclipTierId: tierId,
        billingPeriod: "monthly",
      },
    };

    await billing.handleCheckoutSessionCompleted(session as any);

    const after = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.stripeSubscriptionId, "sub_mock_checkout"));

    expect(after.length).toBe(before.length);
  });

  it("does nothing for non-subscription sessions (payment mode)", async () => {
    const session = {
      id: "cs_test_payment",
      mode: "payment",
      metadata: {
        paperclipCompanyId: companyId,
        paperclipTierId: tierId,
      },
    };

    await expect(billing.handleCheckoutSessionCompleted(session as any)).resolves.toBeUndefined();
  });

  it("does nothing when required metadata is missing", async () => {
    mockRetrieve.mockResolvedValue({
      id: "sub_mock_no_meta",
      status: "active",
      customer: "cus_mock_customer",
      current_period_start: Math.floor(Date.now() / 1000) - 86400,
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
      cancel_at_period_end: false,
      trial_end: null,
      cancel_at: null,
      canceled_at: null,
      items: { data: [{ id: "si_mock_item" }] },
      metadata: {},
    });

    const session = {
      id: "cs_test_no_meta",
      mode: "subscription",
      subscription: "sub_mock_no_meta",
      customer: "cus_mock_customer",
      metadata: {}, // missing paperclipCompanyId / paperclipTierId
    };

    await expect(billing.handleCheckoutSessionCompleted(session as any)).resolves.toBeUndefined();

    const sub = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.stripeSubscriptionId, "sub_mock_no_meta"))
      .then((r) => r[0] ?? null);

    expect(sub).toBeNull();
  });
});