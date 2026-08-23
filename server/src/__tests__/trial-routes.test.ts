import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
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

// Mock Stripe to avoid requiring real API keys during trial tests
vi.mock("stripe", () => {
  // Must be a function compatible with `new Stripe(key, opts)`
  let stripeCustomerCounter = 0;
  const stripeInstance = {
    customers: {
      create: vi.fn().mockImplementation(() => ({
        id: `cus_mock_trial_${++stripeCustomerCounter}`,
      })),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({
        id: "sub_mock_trial",
        status: "trialing",
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 14 * 86400,
        items: { data: [{ id: "si_mock" }] },
      }),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "cs_mock_trial_convert",
          url: "https://checkout.stripe.com/mock-session",
        }),
      },
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  };
  return {
    default: function MockStripe() { return stripeInstance; },
  };
});

type Billing = ReturnType<typeof import("../services/billing.js")["billingService"]>;

describeEmbeddedPostgres("Self-serve trial service", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let billing: Billing;
  let trialTierId: string;
  let companyId: string;
  let company2Id: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-trial-service-");
    db = createDb(tempDb.connectionString);
    billing = (await import("../services/billing.js")).billingService(db);

    // Seed the Trial tier (as migration 0232 would)
    const [tier] = await db
      .insert(subscriptionTiers)
      .values({
        name: "Trial",
        description: "14-day free trial with full access to all features",
        priceMonthlyCents: 0,
        priceYearlyCents: 0,
        includedSeats: 5,
        includedAgentRuns: 100,
        includedStorageGb: 1,
        features: ["custom_plugins", "advanced_agents", "audit_logs", "api_access"],
        isActive: true,
        sortOrder: 0,
      })
      .onConflictDoNothing({ target: subscriptionTiers.name })
      .returning();

    if (tier) {
      trialTierId = tier.id;
    } else {
      const existing = await db
        .select()
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.name, "Trial"))
        .then((r) => r[0]!);
      trialTierId = existing.id;
    }

    // Seed companies
    companyId = randomUUID();
    company2Id = randomUUID();
    const now = new Date();
    for (const cid of [companyId, company2Id]) {
      await db.insert(companies).values({
        id: cid,
        name: `TrialCo ${cid.slice(0, 6)}`,
        status: "active",
        issuePrefix: `TRIAL-${cid.slice(0, 2)}`,
        updatedAt: now,
      });
    }
  });

  afterAll(async () => {
    await db.delete(subscriptionUsage);
    await db.delete(companySubscriptions);
    await db.delete(stripeCustomers);
    await db.delete(subscriptionTiers);
    await db.delete(companies);
    await tempDb?.cleanup();
  });

  describe("startTrial", () => {
    it("creates a trial subscription for a new company", async () => {
      const result = await billing.startTrial(companyId, { billingPeriod: "monthly" });

      expect(result.alreadyExisted).toBe(false);
      expect(result.tierName).toBe("Trial");
      expect(result.status).toBe("trialing");
      expect(result.trialEnd).toBeTruthy();
      expect(result.subscriptionId).toBeTruthy();
    });

    it("is idempotent — returns existing subscription on second call", async () => {
      const first = await billing.startTrial(company2Id, { billingPeriod: "monthly" });
      expect(first.alreadyExisted).toBe(false);

      const second = await billing.startTrial(company2Id, { billingPeriod: "monthly" });
      expect(second.alreadyExisted).toBe(true);
      expect(second.subscriptionId).toBe(first.subscriptionId);
    });
  });

  describe("getTrialStatus", () => {
    it("returns not-trialing when no subscription exists", async () => {
      const noSubId = randomUUID();
      await db.insert(companies).values({
        id: noSubId,
        name: `NoSubCo ${noSubId.slice(0, 6)}`,
        status: "active",
        issuePrefix: `NOSUB-${noSubId.slice(0, 2)}`,
        updatedAt: new Date(),
      });

      const status = await billing.getTrialStatus(noSubId);
      expect(status.isTrialing).toBe(false);
      expect(status.trialEnd).toBeNull();
    });

    it("returns trialing status after trial start", async () => {
      const status = await billing.getTrialStatus(companyId);
      expect(status.isTrialing).toBe(true);
      expect(status.tierName).toBe("Trial");
      expect(status.daysRemaining).toBeGreaterThan(0);
    });
  });
});