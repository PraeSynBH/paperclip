import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  companySubscriptions,
  createDb,
  stripeCustomers,
  subscriptionTiers,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping trial reaper tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("Trial reaper", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;
  let tierId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-trial-reaper-");
    db = createDb(tempDb.connectionString);

    // Seed a tier for subscription references
    const [tier] = await db
      .insert(subscriptionTiers)
      .values({
        name: "Pro",
        description: "Pro tier for reaper tests",
        priceMonthlyCents: 2900,
        priceYearlyCents: 29000,
        includedSeats: 5,
        includedAgentRuns: 100,
        includedStorageGb: 1,
        features: [],
        isActive: true,
        sortOrder: 1,
      })
      .onConflictDoNothing({ target: subscriptionTiers.name })
      .returning();

    if (tier) {
      tierId = tier.id;
    } else {
      const existing = await db
        .select()
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.name, "Pro"))
        .then((r) => r[0]!);
      tierId = existing.id;
    }
  });

  afterAll(async () => {
    await db.delete(companySubscriptions);
    await db.delete(stripeCustomers);
    await db.delete(subscriptionTiers);
    await db.delete(companies);
    await tempDb?.cleanup();
  });

  function seedCompany(name: string): Promise<string> {
    const id = randomUUID();
    return db
      .insert(companies)
      .values({
        id,
        name,
        status: "active",
        issuePrefix: `REAP-${id.slice(0, 2).toUpperCase()}`,
        updatedAt: new Date(),
      })
      .then(() => id);
  }

  async function seedStripeCustomer(companyId: string): Promise<string> {
    const [cust] = await db
      .insert(stripeCustomers)
      .values({
        companyId,
        stripeCustomerId: `cus_reap_${randomUUID().slice(0, 8)}`,
      })
      .returning();
    return cust.id;
  }

  async function seedSubscription(
    companyId: string,
    stripeCustomerId: string,
    overrides: Partial<{
      status: string;
      trialEnd: Date;
      currentPeriodEnd: Date;
      billingPeriod: string;
    }> = {},
  ): Promise<{ id: string; trialEnd: Date | null }> {
    const now = new Date();
    const [sub] = await db
      .insert(companySubscriptions)
      .values({
        companyId,
        tierId,
        stripeCustomerId,
        status: overrides.status ?? "trialing",
        billingPeriod: overrides.billingPeriod ?? "monthly",
        currentPeriodStart: new Date(now.getTime() - 30 * 86400_000),
        currentPeriodEnd: overrides.currentPeriodEnd ?? now,
        trialEnd: overrides.trialEnd ?? null,
      })
      .returning();
    return { id: sub.id, trialEnd: sub.trialEnd };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 1: Expired trials → grace period
  // ───────────────────────────────────────────────────────────────────────────
  it("moves expired trialing subscriptions to grace_period", async () => {
    // Set a fixed "now" for deterministic testing
    const now = new Date("2026-06-15T12:00:00Z");
    const trialEnd = new Date("2026-06-10T12:00:00Z"); // 5 days ago

    const companyId = await seedCompany("Reap Phase1 Co");
    const custId = await seedStripeCustomer(companyId);
    await seedSubscription(companyId, custId, { trialEnd });

    // Import and create reaper with overridden clock
    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(1);
    expect(result.enteredGracePeriod).toBe(1);
    expect(result.expired).toBe(0);

    // Verify the subscription was updated
    const updated = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.stripeCustomerId, custId))
      .then((r) => r[0]);

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("grace_period");
    // Grace period end = trialEnd + 7 days
    const expectedGraceEnd = new Date(
      trialEnd.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    expect(updated!.currentPeriodEnd?.getTime()).toBe(
      expectedGraceEnd.getTime(),
    );
    expect(updated!.updatedAt?.getTime()).toBe(now.getTime());
  });

  it("does not touch active trialing subscriptions (future trialEnd)", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const trialEnd = new Date("2026-06-20T12:00:00Z"); // 5 days in the future

    const companyId = await seedCompany("Reap Active Co");
    const custId = await seedStripeCustomer(companyId);
    const { id: subId } = await seedSubscription(companyId, custId, {
      trialEnd,
    });

    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(0);
    expect(result.enteredGracePeriod).toBe(0);

    // Verify status unchanged
    const updated = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.id, subId))
      .then((r) => r[0]);
    expect(updated!.status).toBe("trialing");
  });

  it("does not touch non-trialing subscriptions with past trialEnd", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const trialEnd = new Date("2026-06-10T12:00:00Z"); // expired

    const companyId = await seedCompany("Reap NonTrial Co");
    const custId = await seedStripeCustomer(companyId);
    const { id: subId } = await seedSubscription(companyId, custId, {
      status: "active",
      trialEnd,
    });

    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(0);
    expect(result.enteredGracePeriod).toBe(0);

    // Verify status unchanged
    const updated = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.id, subId))
      .then((r) => r[0]);
    expect(updated!.status).toBe("active");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 2: Expired grace period → expired
  // ───────────────────────────────────────────────────────────────────────────
  it("moves expired grace_period subscriptions to expired", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const trialEnd = new Date("2026-06-01T12:00:00Z"); // 14 days ago
    const gracePeriodEnd = new Date(
      trialEnd.getTime() + 7 * 24 * 60 * 60 * 1000,
    ); // 7 days ago, so grace period elapsed

    const companyId = await seedCompany("Reap Phase2 Co");
    const custId = await seedStripeCustomer(companyId);
    const { id: subId } = await seedSubscription(companyId, custId, {
      status: "grace_period",
      trialEnd,
      currentPeriodEnd: gracePeriodEnd,
    });

    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(1);
    expect(result.enteredGracePeriod).toBe(0);
    expect(result.expired).toBe(1);

    // Verify status changed to expired
    const updated = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.id, subId))
      .then((r) => r[0]);
    expect(updated!.status).toBe("expired");
    expect(updated!.canceledAt?.getTime()).toBe(now.getTime());
    expect(updated!.updatedAt?.getTime()).toBe(now.getTime());
  });

  it("does not touch grace_period subscriptions still within the window", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const trialEnd = new Date("2026-06-10T12:00:00Z"); // 5 days ago
    const gracePeriodEnd = new Date("2026-06-17T12:00:00Z"); // 2 days in future

    const companyId = await seedCompany("Reap GraceActive Co");
    const custId = await seedStripeCustomer(companyId);
    const { id: subId } = await seedSubscription(companyId, custId, {
      status: "grace_period",
      trialEnd,
      currentPeriodEnd: gracePeriodEnd,
    });

    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(0);
    expect(result.expired).toBe(0);

    // Verify status unchanged
    const updated = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.id, subId))
      .then((r) => r[0]);
    expect(updated!.status).toBe("grace_period");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Combined: multiple subscriptions in one sweep
  // ───────────────────────────────────────────────────────────────────────────
  it("processes both phases in a single sweep", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const trialEndPast = new Date("2026-06-10T12:00:00Z"); // 5 days ago
    const trialEndFarPast = new Date("2026-06-01T12:00:00Z"); // 14 days ago
    const graceEndPast = new Date(
      trialEndFarPast.getTime() + 7 * 24 * 60 * 60 * 1000,
    ); // 7 days ago

    // Phase 1 candidate: expired trial
    const c1 = await seedCompany("Reap Combined-A");
    const c1Cust = await seedStripeCustomer(c1);
    await seedSubscription(c1, c1Cust, { trialEnd: trialEndPast });

    // Phase 2 candidate: expired grace period
    const c2 = await seedCompany("Reap Combined-B");
    const c2Cust = await seedStripeCustomer(c2);
    await seedSubscription(c2, c2Cust, {
      status: "grace_period",
      trialEnd: trialEndFarPast,
      currentPeriodEnd: graceEndPast,
    });

    // Untouched: active trial
    const c3 = await seedCompany("Reap Combined-C");
    const c3Cust = await seedStripeCustomer(c3);
    const { id: sub3Id } = await seedSubscription(c3, c3Cust, {
      trialEnd: new Date("2026-06-20T12:00:00Z"),
    });

    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(2);
    expect(result.enteredGracePeriod).toBe(1);
    expect(result.expired).toBe(1);

    // Verify c1 is in grace_period
    const sub1 = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.stripeCustomerId, c1Cust))
      .then((r) => r[0]);
    expect(sub1!.status).toBe("grace_period");

    // Verify c2 is expired
    const sub2 = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.stripeCustomerId, c2Cust))
      .then((r) => r[0]);
    expect(sub2!.status).toBe("expired");

    // Verify c3 remains trialing
    const sub3 = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.id, sub3Id))
      .then((r) => r[0]);
    expect(sub3!.status).toBe("trialing");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Local-only (no Stripe subscription) — the critical case from C1
  // ───────────────────────────────────────────────────────────────────────────
  it("handles local-only trials without Stripe subscription ID", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    // Create a subscription with no stripeSubscriptionId, simulating a
    // local-only trial created without Stripe price IDs.
    const companyId = await seedCompany("Reap LocalOnly Co");
    const custId = await seedStripeCustomer(companyId);

    const trialEnd = new Date("2026-06-10T12:00:00Z");
    await db
      .insert(companySubscriptions)
      .values({
        companyId,
        tierId,
        stripeCustomerId: custId,
        stripeSubscriptionId: null, // No Stripe sub — local-only trial
        status: "trialing",
        billingPeriod: "monthly",
        currentPeriodStart: new Date(now.getTime() - 30 * 86400_000),
        currentPeriodEnd: now,
        trialEnd,
      })
      .returning();

    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(1);
    expect(result.enteredGracePeriod).toBe(1);

    // Verify transition happened
    const updated = await db
      .select()
      .from(companySubscriptions)
      .where(eq(companySubscriptions.companyId, companyId))
      .then((r) => r[0]);
    expect(updated!.status).toBe("grace_period");
  });

  it("returns zero counts when no subscriptions match", async () => {
    const now = new Date("2026-06-15T12:00:00Z");

    const { createTrialReaper } = await import("../services/trial-reaper.js");
    const reaper = createTrialReaper({ db, now: () => now });

    const result = await reaper.sweep();

    expect(result.total).toBe(0);
    expect(result.enteredGracePeriod).toBe(0);
    expect(result.expired).toBe(0);
  });
});