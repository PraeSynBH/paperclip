// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionTier, CompanySubscription } from "@/api/billing";
import { PricingPage } from "./Pricing";

function act(callback: () => void) {
  flushSync(callback);
}

const companyState = vi.hoisted(() => ({ selectedCompanyId: "company-1" }));
const mockBillingApi = vi.hoisted(() => ({
  tiers: vi.fn(),
  subscription: vi.fn(),
  createCheckoutSession: vi.fn(),
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  experimentVariant: vi.fn(),
}));
const mockPushToast = vi.hoisted(() => vi.fn());
const mockGtag = vi.hoisted(() => vi.fn());
const originalLocation = globalThis.location;

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => companyState }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ pushToast: mockPushToast }) }));
vi.mock("@/api/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/billing")>()),
  billingApi: mockBillingApi,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync(() => {});
}

async function waitForAssertion(assertion: () => void, attempts = 20) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      assertion();
      return;
    } catch (e) {
      lastError = e;
      await flush();
    }
  }
  throw lastError;
}

function createTier(overrides: Partial<SubscriptionTier> = {}): SubscriptionTier {
  return {
    id: "tier-1",
    name: "Adventurer",
    description: "For explorers",
    priceMonthlyCents: 2900,
    priceYearlyCents: 29000,
    stripePriceMonthlyId: "price_1",
    stripePriceYearlyId: null,
    stripeProductId: "prod_1",
    includedSeats: 1,
    extraSeatPriceCents: 1000,
    includedAgentRuns: 100,
    extraAgentRunPriceCents: 50,
    includedStorageGb: 10,
    extraStorageGbPriceCents: 200,
    features: ["advanced_agents"],
    isActive: true,
    sortOrder: 1,
    createdAt: "2026-08-21T00:00:00Z",
    updatedAt: "2026-08-21T00:00:00Z",
    ...overrides,
  };
}

function createSubscription(overrides: Partial<CompanySubscription> = {}): CompanySubscription {
  return {
    id: "sub-1",
    companyId: "company-1",
    tierId: "tier-1",
    stripeCustomerId: "cus-1",
    status: "active",
    billingPeriod: "monthly",
    currentPeriodStart: "2026-08-01T00:00:00Z",
    currentPeriodEnd: "2026-09-01T00:00:00Z",
    stripeSubscriptionId: "sub_stripe_1",
    stripeSubscriptionItemId: "si_1",
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEnd: null,
    metadataJson: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    tier: createTier(),
    usage: [],
    ...overrides,
  };
}

function renderPricing() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <PricingPage />
      </QueryClientProvider>,
    );
  });
  return { container, root };
}

describe("PricingPage", () => {
  beforeEach(() => {
    mockBillingApi.tiers.mockReset();
    mockBillingApi.subscription.mockReset();
    mockBillingApi.createCheckoutSession.mockReset();
    mockBillingApi.cancelSubscription.mockReset();
    mockBillingApi.reactivateSubscription.mockReset();
    mockBillingApi.experimentVariant.mockReset();
    mockPushToast.mockReset();
    mockGtag.mockReset();
    mockBillingApi.experimentVariant.mockResolvedValue({
      variant: "A",
      enabled: false,
    });
    (globalThis as unknown as Record<string, unknown>).gtag = mockGtag;
    Object.defineProperty(globalThis, "location", {
      value: {
        ...originalLocation,
        origin: "https://voyonder.example",
        href: "https://voyonder.example/pricing",
      },
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders all 3 subscription tiers from the API", async () => {
    mockBillingApi.tiers.mockResolvedValue([
      createTier({ id: "tier-1", name: "Adventurer", priceMonthlyCents: 2900, sortOrder: 1 }),
      createTier({ id: "tier-2", name: "Explorer", priceMonthlyCents: 7900, sortOrder: 2 }),
      createTier({ id: "tier-3", name: "Elite", priceMonthlyCents: 49900, sortOrder: 3 }),
    ]);
    mockBillingApi.subscription.mockResolvedValue(null);

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Adventurer");
      expect(container.textContent).toContain("Explorer");
      expect(container.textContent).toContain("Elite");
      expect(container.textContent).toContain("$29");
      expect(container.textContent).toContain("$79");
      expect(container.textContent).toContain("$499");
    });

    act(() => root.unmount());
  });

  it("renders feature list from tier.features JSONB", async () => {
    mockBillingApi.tiers.mockResolvedValue([
      createTier({ id: "tier-1", features: ["advanced_agents", "audit_logs"], sortOrder: 1 }),
    ]);
    mockBillingApi.subscription.mockResolvedValue(null);

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Advanced Agents");
      expect(container.textContent).toContain("Audit Logs");
    });

    act(() => root.unmount());
  });

  it("subscribe button creates a checkout session with monthly billing and redirects", async () => {
    mockBillingApi.tiers.mockResolvedValue([createTier({ id: "tier-1", sortOrder: 1 })]);
    mockBillingApi.subscription.mockResolvedValue(null);
    mockBillingApi.experimentVariant.mockResolvedValue({ variant: "A", enabled: false });
    mockBillingApi.createCheckoutSession.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      sessionId: "cs_test_123",
    });

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Subscribe");
    });

    // Find the Subscribe button (not the billing toggle role="switch")
    const subscribeButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Subscribe"),
    );
    expect(subscribeButton).toBeTruthy();
    act(() => subscribeButton!.click());

    await waitForAssertion(() => {
      expect(mockBillingApi.createCheckoutSession).toHaveBeenCalledWith("company-1", {
        tierId: "tier-1",
        billingPeriod: "monthly",
        successUrl: "https://voyonder.example/pricing?success=true",
        cancelUrl: "https://voyonder.example/pricing",
      });
      expect(globalThis.location.href).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    });

    act(() => root.unmount());
  });

  it("shows active subscription status pill with tier name", async () => {
    mockBillingApi.tiers.mockResolvedValue([createTier({ id: "tier-1", sortOrder: 1 })]);
    mockBillingApi.subscription.mockResolvedValue(
      createSubscription({ tier: createTier({ id: "tier-1", name: "Adventurer" }) }),
    );

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Current Subscription");
      expect(container.textContent).toContain("Active");
      expect(container.textContent).toContain("Adventurer");
      expect(container.textContent).toContain("Cancel Subscription");
    });

    act(() => root.unmount());
  });

  it("cancel button opens confirmation dialog and calls the cancel endpoint on confirm", async () => {
    mockBillingApi.tiers.mockResolvedValue([createTier({ id: "tier-1", sortOrder: 1 })]);
    mockBillingApi.subscription.mockResolvedValue(createSubscription());
    mockBillingApi.cancelSubscription.mockResolvedValue(
      createSubscription({ cancelAtPeriodEnd: true }),
    );

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Cancel Subscription");
    });

    // Click "Cancel Subscription" — opens the alert dialog
    const cancelButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancel Subscription"),
    );
    act(() => cancelButton!.click());

    // Dialog should now be visible; click "Yes, cancel"
    await waitForAssertion(() => {
      expect(document.body.textContent).toContain("Yes, cancel");
    });
    const confirmButton = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Yes, cancel"),
    );
    act(() => confirmButton!.click());

    await waitForAssertion(() => {
      expect(mockBillingApi.cancelSubscription).toHaveBeenCalledWith("company-1");
    });

    // GA4 cancellation event should fire
    expect(mockGtag).toHaveBeenCalledWith(
      "event",
      "subscription_cancellation_started",
      expect.objectContaining({ company_id: "company-1" }),
    );

    act(() => root.unmount());
  });

  it("dismisses cancel dialog without calling the API", async () => {
    mockBillingApi.tiers.mockResolvedValue([createTier({ id: "tier-1", sortOrder: 1 })]);
    mockBillingApi.subscription.mockResolvedValue(createSubscription());
    mockBillingApi.cancelSubscription.mockResolvedValue(
      createSubscription({ cancelAtPeriodEnd: true }),
    );

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Cancel Subscription");
    });

    // Open the dialog
    const cancelButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancel Subscription"),
    );
    act(() => cancelButton!.click());

    // Dialog is open — click "Keep subscription" to dismiss
    await waitForAssertion(() => {
      expect(document.body.textContent).toContain("Keep subscription");
    });
    const keepButton = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Keep subscription"),
    );
    act(() => keepButton!.click());

    // Verify the cancel API was NOT called and GA4 cancellation event did NOT fire
    expect(mockBillingApi.cancelSubscription).not.toHaveBeenCalled();
    expect(mockGtag).not.toHaveBeenCalledWith(
      "event",
      "subscription_cancellation_started",
      expect.anything(),
    );

    act(() => root.unmount());
  });

  it("shows reactivate button when cancellation is scheduled", async () => {
    mockBillingApi.tiers.mockResolvedValue([createTier({ id: "tier-1", sortOrder: 1 })]);
    mockBillingApi.subscription.mockResolvedValue(
      createSubscription({ status: "active", cancelAtPeriodEnd: true }),
    );

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Reactivate Subscription");
      expect(container.textContent).toContain("Canceling");
    });

    act(() => root.unmount());
  });

  it("renders yearly billing toggle and shows savings badge", async () => {
    mockBillingApi.tiers.mockResolvedValue([createTier({ id: "tier-1", sortOrder: 1 })]);
    mockBillingApi.subscription.mockResolvedValue(null);

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Monthly");
      expect(container.textContent).toContain("Yearly");
    });

    // Click the billing toggle switch
    const toggle = container.querySelector('button[role="switch"]');
    expect(toggle).toBeTruthy();
    act(() => toggle!.click());

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Save");
      expect(container.textContent).toContain("/year");
    });

    act(() => root.unmount());
  });

  it("fetches experiment variant on render", async () => {
    mockBillingApi.tiers.mockResolvedValue([createTier({ id: "tier-1", sortOrder: 1 })]);
    mockBillingApi.subscription.mockResolvedValue(null);

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      expect(mockBillingApi.experimentVariant).toHaveBeenCalledWith("company-1");
    });

    act(() => root.unmount());
  });

  it("shows variant B specific messaging when experiment returns variant B enabled", async () => {
    mockBillingApi.tiers.mockResolvedValue([
      createTier({ id: "tier-1", name: "Adventurer", priceMonthlyCents: 2900, sortOrder: 1 }),
      createTier({ id: "tier-2", name: "Explorer", priceMonthlyCents: 7900, sortOrder: 2 }),
      createTier({ id: "tier-3", name: "Elite", priceMonthlyCents: 49900, sortOrder: 3 }),
    ]);
    mockBillingApi.subscription.mockResolvedValue(null);
    mockBillingApi.experimentVariant.mockResolvedValue({ variant: "B", enabled: true });

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      // Variant B should show "Find the Right Plan" header
      expect(container.textContent).toContain("Find the Right Plan for Your Team");
      // Variant B should show "Best Value" badge on middle tier
      expect(container.textContent).toContain("Best Value");
      // Variant B CTA should be "Get Started" or "Start Free Trial"
      expect(container.textContent).toContain("Get Started");
      expect(container.textContent).toContain("Start Free Trial");
    });

    act(() => root.unmount());
  });

  it("shows annual savings percentage on price card when yearly is selected", async () => {
    const tier = createTier({
      id: "tier-1",
      name: "Adventurer",
      priceMonthlyCents: 2900,
      priceYearlyCents: 29000, // ~17% savings
      sortOrder: 1,
    });
    mockBillingApi.tiers.mockResolvedValue([tier]);
    mockBillingApi.subscription.mockResolvedValue(null);

    const { container, root } = renderPricing();

    // Toggle to yearly
    await waitForAssertion(() => {
      expect(container.textContent).toContain("Yearly");
    });
    const toggle = container.querySelector('button[role="switch"]');
    act(() => toggle!.click());

    await waitForAssertion(() => {
      // $290 annual = $290/year displayed
      expect(container.textContent).toContain("$290");
      expect(container.textContent).toContain("/year");
    });

    act(() => root.unmount());
  });

  it("shows Most Popular badge for middle tier by default (variant A)", async () => {
    mockBillingApi.tiers.mockResolvedValue([
      createTier({ id: "tier-1", name: "Starter", sortOrder: 1 }),
      createTier({ id: "tier-2", name: "Pro", sortOrder: 2 }),
      createTier({ id: "tier-3", name: "Enterprise", sortOrder: 3 }),
    ]);
    mockBillingApi.subscription.mockResolvedValue(null);
    mockBillingApi.experimentVariant.mockResolvedValue({ variant: "A", enabled: false });

    const { container, root } = renderPricing();

    await waitForAssertion(() => {
      // Middle tier (Pro) should have "Most Popular" badge
      const badges = Array.from(container.querySelectorAll("[data-variant='default']"));
      const badgeTexts = badges.map((b) => b.textContent).join("");
      expect(badgeTexts).toContain("Most Popular");
    });

    act(() => root.unmount());
  });
});