import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import {
  billingApi,
  type SubscriptionTier,
  type CompanySubscription,
  type ExperimentVariantResponse,
} from "@/api/billing";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { PaperclipLoading } from "@/components/AnimatedPaperclipIcon";
import {
  Check,
  CreditCard,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Zap,
  Shield,
  Users,
  ChevronDown,
  ChevronUp,
  Star,
} from "lucide-react";
import { useToast } from "@/context/ToastContext";

type BillingPeriod = "monthly" | "yearly";

// ── Pure helpers (no component state, safe to use anywhere) ────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function formatAnnualSavings(monthlyCents: number, yearlyCents: number): number {
  const monthlyAnnual = monthlyCents * 12;
  if (monthlyAnnual <= yearlyCents) return 0;
  return Math.round(((monthlyAnnual - yearlyCents) / monthlyAnnual) * 100);
}

function ga4(
  eventName: string,
  companyId: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  try {
    const gtag = (globalThis as Record<string, unknown>)["gtag"];
    if (typeof gtag === "function") {
      gtag("event", eventName, { ...params, company_id: companyId });
    }
  } catch {
    // GA4 tracking is best-effort
  }
}

// ── Variant-aware copy system ──────────────────────────────────────────

type VariantKey = "A" | "B";

interface VariantCopy {
  /** Primary page heading */
  heading: string;
  /** Subheading below the heading */
  subheading: string;
  /** Label for the call-to-action button on an available plan */
  ctaLabel: string;
  /** Label for the recommended/middle-tier CTA */
  recommendedCtaLabel: string;
  /** Label when the user is already on the plan */
  currentPlanLabel: string;
  /** Badge label on the recommended tier */
  recommendedBadgeLabel: string;
  /** Badge description detail */
  recommendedBadgeDetail: string | null;
  /** Label for the "compare plans" toggle */
  compareLabel: string;
  /** Urgency/reassurance line near CTAs */
  urgencyLine: string;
  /** Pricing sub-text */
  priceSuffixNote: string | null;
}

const VARIANT_COPIES: Record<VariantKey, VariantCopy> = {
  A: {
    heading: "Choose Your Plan",
    subheading:
      "All plans include a 14-day free trial. No credit card required to start. Cancel anytime.",
    ctaLabel: "Subscribe",
    recommendedCtaLabel: "Subscribe",
    currentPlanLabel: "Current Plan",
    recommendedBadgeLabel: "Most Popular",
    recommendedBadgeDetail: null,
    compareLabel: "Compare all features",
    urgencyLine: "Cancel anytime — no long-term contracts.",
    priceSuffixNote: null,
  },
  B: {
    heading: "Find the Right Plan for Your Team",
    subheading:
      "Start with a 14-day free trial. No credit card required. Cancel anytime.",
    ctaLabel: "Get Started",
    recommendedCtaLabel: "Start Free Trial",
    currentPlanLabel: "Active Plan",
    recommendedBadgeLabel: "Best Value",
    recommendedBadgeDetail: "Most features per dollar",
    compareLabel: "Full feature comparison",
    urgencyLine: "Free for 14 days. No commitment. Cancel with one click.",
    priceSuffixNote: "plus applicable taxes",
  },
};

interface CtaStyle {
  variant: "default" | "cta" | "secondary" | "outline";
  icon: "arrow" | "card" | "none";
  size: "default" | "lg";
}

const VARIANT_CTA_STYLES: Record<VariantKey, CtaStyle> = {
  A: { variant: "default", icon: "card", size: "default" },
  B: { variant: "cta", icon: "arrow", size: "lg" },
};

// ── Sub-components ─────────────────────────────────────────────────────

function StatusPill({
  subscription,
}: {
  subscription: CompanySubscription | null;
}) {
  if (!subscription) {
    return <Badge variant="outline">No subscription</Badge>;
  }

  const status = subscription.status;
  const cancelScheduled = subscription.cancelAtPeriodEnd;

  if (status === "active" && cancelScheduled) {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        Canceling — ends{" "}
        {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
      </Badge>
    );
  }

  const variantMap: Record<
    string,
    "default" | "success" | "destructive" | "secondary" | "outline" | "warning"
  > = {
    active: "success",
    trialing: "default",
    incomplete: "warning",
    past_due: "destructive",
    canceled: "outline",
    unpaid: "destructive",
  };

  const labelMap: Record<string, string> = {
    active: "Active",
    trialing: "Trial",
    incomplete: "Incomplete",
    past_due: "Past Due",
    canceled: "Canceled",
    unpaid: "Unpaid",
  };

  return (
    <Badge variant={variantMap[status] ?? "outline"}>
      {labelMap[status] ?? status}
    </Badge>
  );
}

function FeatureIcon({ feature }: { feature: string }) {
  const lower = feature.toLowerCase();
  if (lower.includes("agent") || lower.includes("run"))
    return <Zap className="h-4 w-4 shrink-0 text-primary" />;
  if (
    lower.includes("seat") ||
    lower.includes("member") ||
    lower.includes("user") ||
    lower.includes("team")
  )
    return <Users className="h-4 w-4 shrink-0 text-primary" />;
  if (
    lower.includes("security") ||
    lower.includes("sso") ||
    lower.includes("audit") ||
    lower.includes("shield")
  )
    return <Shield className="h-4 w-4 shrink-0 text-primary" />;
  return <Check className="h-4 w-4 shrink-0 text-primary" />;
}

function UsageRow({
  label,
  included,
  usage,
}: {
  label: string;
  included: number;
  usage?: number;
}) {
  const used = usage ?? 0;
  const pct =
    included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {usage !== undefined
            ? `${used.toLocaleString()} / ${included.toLocaleString()}`
            : `${included.toLocaleString()} included`}
        </span>
      </div>
      {usage !== undefined && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/60 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BillingToggle({
  billingPeriod,
  onChange,
}: {
  billingPeriod: BillingPeriod;
  onChange: (period: BillingPeriod) => void;
}) {
  const isYearly = billingPeriod === "yearly";

  return (
    <div className="mb-8 flex items-center justify-center gap-3">
      <span
        className={`text-sm font-medium ${
          isYearly ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        Monthly
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isYearly}
        aria-label="Toggle yearly billing"
        onClick={() => onChange(isYearly ? "monthly" : "yearly")}
        className={`relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          isYearly ? "bg-primary" : "bg-input"
        }`}
      >
        <span
          className={`inline-block h-5 w-7 transform rounded-full bg-white shadow-sm ring-0 transition-transform ${
            isYearly ? "translate-x-6" : "translate-x-0.5"
          }`}
        />
      </button>
      <span
        className={`text-sm font-medium ${
          isYearly ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        Yearly
      </span>
      {isYearly && (
        <Badge variant="success" className="ml-1">
          Save ~20%
        </Badge>
      )}
    </div>
  );
}

// ── Plan comparison table ──────────────────────────────────────────────

function formatFeatureName(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ComparisonRow {
  /** Label shown in the left column */
  label: string;
  /** For each tier, the value to display (string, number, or boolean) */
  getValue: (tier: SubscriptionTier) => string | number | boolean;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    label: "Base price",
    getValue: (t) => formatCents(t.priceMonthlyCents) + "/mo",
  },
  {
    label: "Annual price",
    getValue: (t) =>
      t.priceYearlyCents > 0
        ? formatCents(t.priceYearlyCents) + "/yr"
        : "N/A",
  },
  {
    label: "Seats included",
    getValue: (t) => t.includedSeats,
  },
  {
    label: "Extra seat price",
    getValue: (t) =>
      t.extraSeatPriceCents > 0
        ? formatCents(t.extraSeatPriceCents) + "/mo"
        : "N/A",
  },
  {
    label: "Agent runs / month",
    getValue: (t) => t.includedAgentRuns.toLocaleString(),
  },
  {
    label: "Extra agent run price",
    getValue: (t) =>
      t.extraAgentRunPriceCents > 0
        ? formatCents(t.extraAgentRunPriceCents) + "/run"
        : "N/A",
  },
  {
    label: "Storage included",
    getValue: (t) => `${t.includedStorageGb} GB`,
  },
  {
    label: "Extra storage price",
    getValue: (t) =>
      t.extraStorageGbPriceCents > 0
        ? formatCents(t.extraStorageGbPriceCents) + "/GB"
        : "N/A",
  },
];

function ComparisonTable({
  tiers,
  variant,
  experimentEnabled,
}: {
  tiers: SubscriptionTier[];
  variant: VariantKey;
  experimentEnabled: boolean;
}) {
  const copy = VARIANT_COPIES[variant];
  const [isOpen, setIsOpen] = useState(false);

  if (tiers.length < 2) return null;

  return (
    <div className="mt-12">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="mx-auto flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {isOpen ? "Hide comparison" : copy.compareLabel}
      </button>

      {isOpen && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="sticky left-0 z-10 bg-muted/30 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Feature
                </th>
                {tiers.map((tier) => (
                  <th
                    key={tier.id}
                    className="px-4 py-3 text-center text-sm font-semibold"
                  >
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Custom features from the tier (the JSONB array) */}
              {tiers[0].features.length > 0 && (
                <tr className="border-b border-border/50">
                  <td
                    colSpan={tiers.length + 1}
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 bg-muted/10"
                  >
                    Plan Features
                  </td>
                </tr>
              )}
              {tiers[0].features.map((feature) => (
                <tr key={feature} className="border-b border-border/30">
                  <td className="sticky left-0 z-10 bg-card px-4 py-2.5 text-sm font-medium">
                    {formatFeatureName(feature)}
                  </td>
                  {tiers.map((tier) => {
                    const has = tier.features.includes(feature);
                    return (
                      <td
                        key={tier.id}
                        className={`px-4 py-2.5 text-center ${
                          has ? "text-primary" : "text-muted-foreground/40"
                        }`}
                      >
                        {has ? (
                          <Check className="mx-auto h-4 w-4" />
                        ) : (
                          <span className="text-lg leading-none">&mdash;</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Usage and quota comparison */}
              {COMPARISON_ROWS.length > 0 && (
                <tr className="border-b border-border/50">
                  <td
                    colSpan={tiers.length + 1}
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 bg-muted/10"
                  >
                    Limits &amp; Quotas
                  </td>
                </tr>
              )}
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border/30">
                  <td className="sticky left-0 z-10 bg-card px-4 py-2.5 text-sm font-medium">
                    {row.label}
                  </td>
                  {tiers.map((tier) => (
                    <td
                      key={tier.id}
                      className="px-4 py-2.5 text-center text-sm tabular-nums text-muted-foreground"
                    >
                      {String(row.getValue(tier))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

export function PricingPage() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const companyId = selectedCompanyId;

  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────

  const { data: tiers, isLoading: tiersLoading } = useQuery({
    queryKey: queryKeys.billing.tiers(companyId!),
    queryFn: () => billingApi.tiers(companyId!),
    enabled: !!companyId,
  });

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: queryKeys.billing.subscription(companyId!),
    queryFn: () => billingApi.subscription(companyId!),
    enabled: !!companyId,
  });

  const { data: experimentVariant } = useQuery({
    queryKey: queryKeys.billing.experimentVariant(companyId!),
    queryFn: () => billingApi.experimentVariant(companyId!),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Mutations ────────────────────────────────────────────────────────

  const checkoutMutation = useMutation({
    mutationFn: async ({
      tierId,
      period,
    }: {
      tierId: string;
      period: BillingPeriod;
    }) => {
      const result = await billingApi.createCheckoutSession(companyId!, {
        tierId,
        billingPeriod: period,
        successUrl: `${window.location.origin}/pricing?success=true`,
        cancelUrl: `${window.location.origin}/pricing`,
      });
      ga4("checkout_started", companyId!, {
        tier_id: tierId,
        billing_period: period,
        experiment_variant: rawVariant,
      });
      return result;
    },
    onSuccess: (result) => {
      if (result.url) {
        window.location.href = result.url;
      } else {
        pushToast({
          title: "Checkout session created",
          body: "Redirecting to Stripe...",
        });
      }
    },
    onError: (err: Error) => {
      pushToast({
        title: "Failed to create checkout session",
        body: err.message,
        tone: "error",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => billingApi.cancelSubscription(companyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.billing.subscription(companyId!),
      });
      pushToast({
        title: "Subscription canceled",
        body: "Your subscription will be canceled at the end of the billing period.",
        tone: "success",
      });
    },
    onError: (err: Error) => {
      pushToast({
        title: "Failed to cancel subscription",
        body: err.message,
        tone: "error",
      });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => billingApi.reactivateSubscription(companyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.billing.subscription(companyId!),
      });
      pushToast({
        title: "Subscription reactivated",
        body: "Your subscription has been reactivated.",
        tone: "success",
      });
    },
    onError: (err: Error) => {
      pushToast({
        title: "Failed to reactivate subscription",
        body: err.message,
        tone: "error",
      });
    },
  });

  // ── Derived state ────────────────────────────────────────────────────

  const rawVariant: VariantKey = experimentVariant?.variant ?? "A";
  const experimentEnabled = experimentVariant?.enabled ?? false;
  /**
   * When the experiment is disabled, always serve the control (A) experience
   * regardless of what the API returns — this matches the original gating
   * pattern of `variant === "B" && experimentEnabled` throughout.
   */
  const effectiveVariant: VariantKey = experimentEnabled ? rawVariant : "A";
  const copy = VARIANT_COPIES[effectiveVariant];
  const ctaStyle = VARIANT_CTA_STYLES[effectiveVariant];

  const currentTierId = subscription?.tierId ?? null;
  const isSubscribed = !!subscription && subscription.status !== "canceled";
  const isCancelScheduled = subscription?.cancelAtPeriodEnd === true;

  const sortedTiers = tiers
    ? [...tiers].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  const recommendedIndex =
    sortedTiers.length > 1 ? Math.floor(sortedTiers.length / 2) : 0;
  const recommendedTierId = sortedTiers[recommendedIndex]?.id;

  const getCtaLabel = (tier: SubscriptionTier): string => {
    if (tier.id === currentTierId && isSubscribed) return copy.currentPlanLabel;
    if (checkoutMutation.isPending) return "Loading...";
    if (tier.id === recommendedTierId) return copy.recommendedCtaLabel;
    return copy.ctaLabel;
  };

  const getCtaVariant = (
    tier: SubscriptionTier,
  ): "default" | "outline" | "secondary" | "cta" => {
    if (tier.id === currentTierId && isSubscribed) return "outline";
    if (tier.id === recommendedTierId) return ctaStyle.variant;
    return "secondary";
  };

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleBillingToggle = (next: BillingPeriod) => {
    setBillingPeriod(next);
    ga4("billing_period_toggle", companyId!, { period: next });
  };

  const handleCtaClick = (tier: SubscriptionTier) => {
    checkoutMutation.mutate({ tierId: tier.id, period: billingPeriod });
    ga4("cta_clicked", companyId!, {
      tier_id: tier.id,
      tier_name: tier.name,
      billing_period: billingPeriod,
      experiment_variant: rawVariant,
    });
  };

  // ── Guard: no company selected ───────────────────────────────────────

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          Select a company to view pricing
        </p>
      </div>
    );
  }

  if (tiersLoading || subLoading) {
    return <PaperclipLoading />;
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 text-center sm:text-left">
        <h1 className="text-3xl font-bold tracking-tight">
          {copy.heading}
        </h1>
        <p className="mt-2 text-muted-foreground max-w-xl">
          {copy.subheading}
        </p>
      </div>

      {/* Billing toggle */}
      <BillingToggle
        billingPeriod={billingPeriod}
        onChange={handleBillingToggle}
      />

      {/* Current subscription */}
      {subscription && (
        <Card className="mb-8 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              Current Subscription
              <StatusPill subscription={subscription} />
            </CardTitle>
            <CardDescription>
              {subscription.tier?.name ?? "Unknown tier"} &middot;{" "}
              {subscription.billingPeriod === "yearly" ? "Yearly" : "Monthly"}{" "}
              billing
              {subscription.currentPeriodEnd && (
                <>
                  {" "}
                  &middot; Next billing date:{" "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </>
              )}
            </CardDescription>
          </CardHeader>

          {subscription.usage.length > 0 && (
            <CardContent>
              <div className="space-y-3">
                {subscription.usage.map((row) => (
                  <UsageRow
                    key={row.metric}
                    label={
                      row.metric === "agent_runs"
                        ? "Agent runs"
                        : row.metric === "storage_gb"
                          ? "Storage"
                          : "Seats"
                    }
                    included={row.included}
                    usage={row.usage}
                  />
                ))}
              </div>
            </CardContent>
          )}

          <CardFooter className="border-t border-border/50 px-6 py-3">
            <div className="flex items-center gap-3 w-full">
              {isCancelScheduled ? (
                <Button
                  variant="default"
                  onClick={() => reactivateMutation.mutate()}
                  disabled={reactivateMutation.isPending}
                >
                  Reactivate Subscription
                </Button>
              ) : isSubscribed ? (
                <AlertDialog
                  open={cancelDialogOpen}
                  onOpenChange={setCancelDialogOpen}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={cancelMutation.isPending}
                      className="text-destructive hover:text-destructive"
                    >
                      Cancel Subscription
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Cancel subscription?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to cancel your subscription? It
                        will remain active until the end of the billing period.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={cancelMutation.isPending}
                        onClick={() => {
                          cancelMutation.mutate();
                          ga4(
                            "subscription_cancellation_started",
                            companyId!,
                          );
                        }}
                      >
                        Yes, cancel
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}

              {isSubscribed && !isCancelScheduled && sortedTiers.length > 1 && (
                <p className="ml-auto text-xs text-muted-foreground">
                  Switch plans by selecting a tier below
                </p>
              )}
            </div>
          </CardFooter>
        </Card>
      )}

      {/* Tier cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {sortedTiers.map((tier) => {
          const isCurrentTier = tier.id === currentTierId && isSubscribed;
          const isRecommended = tier.id === recommendedTierId;
          const priceCents =
            billingPeriod === "yearly"
              ? tier.priceYearlyCents
              : tier.priceMonthlyCents;
          const features = Array.isArray(tier.features) ? tier.features : [];
          const savings =
            billingPeriod === "yearly"
              ? formatAnnualSavings(tier.priceMonthlyCents, tier.priceYearlyCents)
              : 0;

          return (
            <Card
              key={tier.id}
              className={`relative flex flex-col ${
                isCurrentTier
                  ? "border-primary ring-1 ring-primary"
                  : isRecommended && !isCurrentTier
                    ? "border-primary/60 ring-1 ring-primary/30 shadow-lg"
                    : "border-border"
              }`}
            >
              {/* "Most Popular" / "Best Value" badge */}
              {isRecommended && !isCurrentTier && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <Badge
                    variant="default"
                    className="gap-1 px-3 py-1 text-xs font-semibold whitespace-nowrap"
                  >
                    <Sparkles className="h-3 w-3" />
                    {copy.recommendedBadgeLabel}
                  </Badge>
                </div>
              )}

              <CardHeader
                className={isRecommended && !isCurrentTier ? "pt-8" : ""}
              >
                <CardTitle className="text-xl flex items-center gap-2">
                  {tier.name}
                  {savings > 0 && (
                    <Badge
                      variant="success"
                      className="text-[10px] px-1.5 py-0"
                    >
                      Save {savings}%
                    </Badge>
                  )}
                </CardTitle>
                {tier.description && (
                  <CardDescription>{tier.description}</CardDescription>
                )}
                {/* Variant B: recommended badge detail line */}
                {isRecommended && !isCurrentTier && copy.recommendedBadgeDetail && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Star className="h-3 w-3 text-primary" />
                    {copy.recommendedBadgeDetail}
                  </p>
                )}
              </CardHeader>

              <CardContent className="flex-1">
                {/* Price display */}
                <div className="mb-4">
                  <span className="text-4xl font-bold">
                    {formatCents(priceCents)}
                  </span>
                  <span className="text-muted-foreground ml-1">
                    /{billingPeriod === "yearly" ? "year" : "month"}
                  </span>
                  {billingPeriod === "monthly" &&
                    tier.priceYearlyCents > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatCents(tier.priceYearlyCents)}/year when billed
                        annually
                      </p>
                    )}
                  {/* Variant B: tax note */}
                  {copy.priceSuffixNote && (
                    <p className="mt-1 text-[10px] text-muted-foreground/60">
                      {copy.priceSuffixNote}
                    </p>
                  )}
                </div>

                {/* Feature list (compact badges variant B) */}
                {features.length > 0 && (
                  <ul className="space-y-2.5 mb-4">
                    {features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-sm"
                      >
                        <FeatureIcon feature={feature} />
                        <span>
                          {formatFeatureName(feature)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Usage quotas */}
                <div className="mt-4 space-y-2 text-xs text-muted-foreground border-t border-border/30 pt-4">
                  <UsageRow label="Seats" included={tier.includedSeats} />
                  <UsageRow
                    label="Agent runs / mo"
                    included={tier.includedAgentRuns}
                  />
                  <UsageRow
                    label="Storage"
                    included={tier.includedStorageGb}
                  />
                </div>
              </CardContent>

              <CardFooter className="flex-col gap-2">
                {isCurrentTier ? (
                  <Button className="w-full" variant="outline" disabled>
                    <Check className="h-4 w-4 mr-2" />
                    {copy.currentPlanLabel}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={getCtaVariant(tier)}
                    size={isRecommended && !isCurrentTier ? ctaStyle.size : "default"}
                    onClick={() => handleCtaClick(tier)}
                    disabled={checkoutMutation.isPending}
                  >
                    {ctaStyle.icon === "arrow" ? (
                      <>
                        {getCtaLabel(tier)}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    ) : ctaStyle.icon === "card" ? (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        {getCtaLabel(tier)}
                      </>
                    ) : (
                      getCtaLabel(tier)
                    )}
                  </Button>
                )}

                {/* Urgency / reassurance line */}
                {!isCurrentTier && (
                  <p className="text-[10px] text-center text-muted-foreground/60 leading-tight">
                    {copy.urgencyLine}
                  </p>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Comparison table */}
      {sortedTiers.length >= 2 && (
        <ComparisonTable
          tiers={sortedTiers}
          variant={effectiveVariant}
          experimentEnabled={experimentEnabled}
        />
      )}

      {/* Empty state */}
      {(!tiers || tiers.length === 0) && !tiersLoading && (
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            No subscription tiers are available at this time.
          </p>
        </div>
      )}

      {/* Experiment variant indicator (subtle) */}
      {experimentEnabled && (
        <div className="mt-8 text-center">
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
            Experiment variant {rawVariant}
            &nbsp;&middot;&nbsp;{sortedTiers.length} tiers loaded
          </span>
        </div>
      )}

      {/* Footer note */}
      <p className="mt-8 text-center text-xs text-muted-foreground">
        All prices are in USD. Your subscription can be canceled at any time.
        By subscribing, you agree to our Terms of Service.
      </p>
    </div>
  );
}