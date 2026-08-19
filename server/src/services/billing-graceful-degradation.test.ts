import { afterEach, describe, expect, it, vi } from "vitest";

describe("Stripe graceful degradation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getStripeClient throws descriptive error when STRIPE_SECRET_KEY is unset", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");

    const { getStripeClient } = await import("./billing.js");
    expect(() => getStripeClient()).toThrow(
      "STRIPE_SECRET_KEY environment variable is not set",
    );
  });

  it("getStripeClient succeeds when STRIPE_SECRET_KEY is set", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake_key_for_testing");

    // We can't fully instantiate Stripe without a valid key,
    // but we can verify the env check passes by expecting a
    // Stripe construction error rather than the missing-key error.
    const { getStripeClient } = await import("./billing.js");
    // NOTE: Stripe constructor validates the key format, so with
    // a fake key it will throw a different error. This test confirms
    // the env-var guard does NOT fire.
    expect(() => getStripeClient()).not.toThrow(
      "STRIPE_SECRET_KEY environment variable is not set",
    );
  });

  it("service functions that depend on Stripe throw graceful error when key is missing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");

    // Dynamically import billing module with env vars unset
    // We test createOrUpdateSubscription and cancelSubscription as
    // representative functions that call getStripeClient before any DB ops.
    const mod = await import("./billing.js");

    // These functions throw the env-var error before any DB access,
    // so we don't need a real DB for this test.
    // We wrap in a function to test that the error is thrown
    // (we pass undefined for db which will error, but the stripe
    // check fires first).

    // createOrUpdateSubscription
    {
      const svc = mod.billingService(undefined as any);
      await expect(
        svc.createOrUpdateSubscription("company-1", {
          tierId: "tier-1",
          billingPeriod: "monthly",
        }),
      ).rejects.toThrow("STRIPE_SECRET_KEY environment variable is not set");
    }

    // cancelSubscription
    {
      const svc = mod.billingService(undefined as any);
      await expect(
        svc.cancelSubscription("company-1"),
      ).rejects.toThrow("STRIPE_SECRET_KEY environment variable is not set");
    }

    // reactivateSubscription
    {
      const svc = mod.billingService(undefined as any);
      await expect(
        svc.reactivateSubscription("company-1"),
      ).rejects.toThrow("STRIPE_SECRET_KEY environment variable is not set");
    }
  });
});
