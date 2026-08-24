import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { billingApi, type SubscriptionTier, type CompanySubscription } from "@/api/billing";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "../hooks/usePageMeta";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperclipLoading } from "@/components/AnimatedPaperclipIcon";
import { Check, CreditCard, AlertCircle, Beaker } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useState } from "react";
import type { BillingPeriod } from "@paperclipai/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

/** Calculate the yearly savings percentage vs monthly billing. */
function yearlySavingsPercent(monthlyCents: number, yearlyCents: number): number {
  if (monthlyCents <= 0 || yearlyCents <= 0) return 0;
  const monthlyYearlyTotal = monthlyCents * 12;
  if (monthlyYearlyTotal <= 0) return 0;
  return Math.round(((monthlyYearlyTotal - yearlyCents) / monthlyYearlyTotal) * 100);
}

// ── Status Pill ──────────────────────────────────────────────────────────────

function StatusPill({ subscription }: { subscription: CompanySubscription | null }) {
  if (!subscription) {
    return <Badge variant="outline">No subscription</Badge>;
  }

  const status = subscription.status;
  const cancelScheduled = subscription.cancelAtPeriodEnd;

  if (status === "active" && cancelScheduled) {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        Canceling — ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
      </Badge>
    );
  }

  const variantMap: Record<string, "default" | "success" | "destructive" | "secondary" | "outline" | "warning"> = {
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

// ── Checkout Confirmation Dialog ────────────────────────────────────────────

function CheckoutConfirmationDialog({
  tier,
  billingPeriod,
  onConfirm,
  onCancel,
  isPending,
}: {
  tier: SubscriptionTier;
  billingPeriod: BillingPeriod;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const price = billingPeriod === "yearly" ? tier.priceYearlyCents : tier.priceMonthlyCents;
  const periodLabel = billingPeriod === "yearly" ? "year" : "month";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="mx-4 w-full max-w-md">
        <CardHeader>
          <CardTitle>Confirm Your Plan</CardTitle>
          <CardDescription>
            You're about to start the <strong>{tier.name}</strong> plan at{" "}
            <strong>{formatCents(price)}/{periodLabel}</strong>. Your 14-day free
            trial begins now — you won't be charged until it ends.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "Processing..." : "Proceed to Checkout"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ── Hero CTA Bar ─────────────────────────────────────────────────────────────

function HeroCtaBar({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="mb-10 rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 p-6 text-center">
      <h2 className="mb-2 text-2xl font-bold">Get Started Today</h2>
      <p className="mb-4 text-muted-foreground">
        Join thousands of teams using Paperclip to supercharge their workflows.
        Start your free 14-day trial — no credit card required.
      </p>
      <Button size="lg" onClick={onGetStarted}>
        Start Free Trial
      </Button>
    </div>
  );
}

// ── Main Pricing Page ────────────────────────────────────────────────────────

export function PricingPage() {
  usePageMeta("Pricing", "Paperclip pricing plans and subscription details.");
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const companyId = selectedCompanyId;

  // Billing period toggle (visible for variant B)
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");

  // Confirmation dialog state (variant B only)
  const [pendingTier, setPendingTier] = useState<SubscriptionTier | null>(null);

  // Cancel confirmation dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────

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

  const { data: experiment } = useQuery({
    queryKey: queryKeys.billing.experimentVariant(companyId!),
    queryFn: () => billingApi.experimentVariant(companyId!),
    enabled: !!companyId,
    // Experiment is non-critical — fail silently if the endpoint errors
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 min — experiment assignment is stable per session
  });

  const isVariantB = experiment?.enabled === true && experiment?.variant === "B";

  // Internal user detection (instance admins & company admins/owners)
  const { data: boardAccess } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const isInternalUser =
    boardAccess?.isInstanceAdmin === true ||
    boardAccess?.memberships?.some(
      (m) => m.membershipRole === "owner" || m.membershipRole === "admin",
    ) === true;

  // ── Mutations ────────────────────────────────────────────────────────────

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
        successUrl: `${window.location.origin}/pricing`,
        cancelUrl: `${window.location.origin}/pricing`,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.subscription(companyId!) });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.subscription(companyId!) });
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

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSubscribe = (tier: SubscriptionTier) => {
    if (isVariantB) {
      // Variant B shows a confirmation dialog first
      setPendingTier(tier);
    } else {
      // Variant A (control) goes directly to Stripe
      checkoutMutation.mutate({ tierId: tier.id, period: billingPeriod });
    }
  };

  const handleConfirmCheckout = () => {
    if (!pendingTier) return;
    checkoutMutation.mutate(
      { tierId: pendingTier.id, period: billingPeriod },
      {
        onSettled: () => setPendingTier(null),
      },
    );
  };

  const handleCancelCheckout = () => {
    setPendingTier(null);
  };

  // ── Cancel Handlers ────────────────────────────────────────────────────────

  const handleConfirmCancel = () => {
    // Fire GA4 event if gtag is available (must not block cancellation)
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", "subscription_cancellation_started", {
          company_id: companyId,
        });
      }
    } catch {
      // Telemetry failure must not prevent subscription cancellation
    }
    cancelMutation.mutate();
    setCancelDialogOpen(false);
  };

  const handleDismissCancel = () => {
    setCancelDialogOpen(false);
  };

  // ── Loading / Empty State ─────────────────────────────────────────────────

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Select a company to view pricing</p>
      </div>
    );
  }

  if (tiersLoading || subLoading) {
    return <PaperclipLoading />;
  }

  const currentTierId = subscription?.tierId ?? null;
  const isSubscribed = !!subscription && subscription.status !== "canceled";
  const isCancelScheduled = subscription?.cancelAtPeriodEnd === true;


  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Confirmation dialog overlay */}
      {pendingTier && (
        <CheckoutConfirmationDialog
          tier={pendingTier}
          billingPeriod={billingPeriod}
          onConfirm={handleConfirmCheckout}
          onCancel={handleCancelCheckout}
          isPending={checkoutMutation.isPending}
        />
      )}

      {/* Hero CTA bar for variant B when not subscribed */}
      {isVariantB && !isSubscribed && (
        <HeroCtaBar
          onGetStarted={() => {
            // Pick the first available tier as the default target
            const firstTier = tiers?.[0];
            if (firstTier) setPendingTier(firstTier);
          }}
        />
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
          {experiment?.enabled && isInternalUser && experiment?.variant ? (
            <Badge variant="secondary" className="gap-1">
              <Beaker className="h-3 w-3" />
              Experiment: Variant {experiment.variant}
            </Badge>
          ) : isVariantB ? (
            <Badge variant="secondary" className="gap-1">
              <Beaker className="h-3 w-3" />
              Variant B
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 text-muted-foreground">
          Choose the plan that fits your needs. All plans include a 14-day free trial.
        </p>
      </div>

      {/* Current subscription status */}
      {subscription && (
        <Card className="mb-8 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              Current Subscription
              <StatusPill subscription={subscription} />
            </CardTitle>
            <CardDescription>
              {subscription.tier?.name ?? "Unknown tier"} &middot;{" "}
              {subscription.billingPeriod === "yearly" ? "Yearly" : "Monthly"} billing
              {subscription.currentPeriodEnd && (
                <> &middot; Next billing date: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</>
              )}
            </CardDescription>
          </CardHeader>
          <CardFooter className="border-t border-border/50 px-6 py-3">
            <div className="flex gap-3">
              {isCancelScheduled ? (
                <Button
                  variant="default"
                  onClick={() => reactivateMutation.mutate()}
                  disabled={reactivateMutation.isPending}
                >
                  Reactivate Subscription
                </Button>
              ) : isSubscribed ? (
                <Button
                  variant="outline"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={cancelMutation.isPending}
                  className="text-destructive hover:text-destructive"
                >
                  Cancel Subscription
                </Button>
              ) : null}
            </div>
          </CardFooter>
        </Card>
      )}

      {/* Billing period toggle — shown for variant B */}
      {isVariantB && (
        <div className="mb-6 flex items-center justify-center gap-2">
          <button
            type="button"
            className={`rounded-l-md px-4 py-2 text-sm font-medium transition-colors ${
              billingPeriod === "monthly"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            onClick={() => setBillingPeriod("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`rounded-r-md px-4 py-2 text-sm font-medium transition-colors ${
              billingPeriod === "yearly"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            onClick={() => setBillingPeriod("yearly")}
          >
            Yearly
          </button>
        </div>
      )}

      {/* Tier cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {(tiers ?? []).map((tier) => {
          const isCurrentTier = tier.id === currentTierId && isSubscribed;
          const features = Array.isArray(tier.features) ? tier.features : [];

          const displayPrice = billingPeriod === "yearly" ? tier.priceYearlyCents : tier.priceMonthlyCents;
          const savingsPct = yearlySavingsPercent(tier.priceMonthlyCents, tier.priceYearlyCents);

          return (
            <Card
              key={tier.id}
              className={`flex flex-col ${
                isCurrentTier
                  ? "border-primary ring-1 ring-primary"
                  : ""
              }`}
            >
              <CardHeader>
                <CardTitle className="text-xl">{tier.name}</CardTitle>
                {tier.description && (
                  <CardDescription>{tier.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex-1">
                <div className="mb-6">
                  <span className="text-4xl font-bold">{formatCents(displayPrice)}</span>
                  <span className="text-muted-foreground ml-1">
                    /{billingPeriod === "yearly" ? "year" : "month"}
                  </span>

                  {/* Yearly savings badge for variant B */}
                  {isVariantB && billingPeriod === "yearly" && savingsPct > 0 && (
                    <Badge variant="success" className="ml-2 align-middle">
                      save {savingsPct}%
                    </Badge>
                  )}
                </div>

                {/* Yearly savings hint in monthly view (variant B) */}
                {isVariantB && billingPeriod === "monthly" && savingsPct > 0 && (
                  <p className="mb-4 text-sm text-muted-foreground">
                    save {savingsPct}% with yearly billing
                  </p>
                )}

                {/* Yearly vs monthly comparison for variant B */}
                {isVariantB && billingPeriod === "yearly" && (
                  <p className="mb-4 text-sm text-muted-foreground">
                    {formatCents(tier.priceMonthlyCents)}/month normally &middot;{" "}
                    {formatCents(tier.priceYearlyCents)}/year
                  </p>
                )}

                {features.length > 0 && (
                  <ul className="space-y-2">
                    {features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                        <span className="capitalize">{feature.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  <p>{tier.includedSeats} included seats</p>
                  <p>{tier.includedAgentRuns.toLocaleString()} included agent runs/mo</p>
                  <p>{tier.includedStorageGb} GB storage included</p>
                </div>
              </CardContent>
              <CardFooter>
                {isCurrentTier ? (
                  <Button className="w-full" variant="outline" disabled>
                    <Check className="h-4 w-4 mr-2" />
                    Current Plan
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => handleSubscribe(tier)}
                    disabled={checkoutMutation.isPending}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {checkoutMutation.isPending
                      ? "Loading..."
                      : isVariantB
                        ? "Start Free Trial"
                        : "Subscribe"}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* No tiers loaded */}
      {(!tiers || tiers.length === 0) && !tiersLoading && (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No subscription tiers are available at this time.</p>
        </div>
      )}

      {/* Cancel confirmation dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={(open) => {
        if (!open && !cancelMutation.isPending) setCancelDialogOpen(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel your subscription? It will remain active until the end of the billing period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDismissCancel} disabled={cancelMutation.isPending}>
              Keep Subscription
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              disabled={cancelMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? "Canceling..." : "Yes, Cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Footer note */}
      <p className="mt-8 text-center text-xs text-muted-foreground">
        All prices are in USD. Your subscription can be canceled at any time.
        By subscribing, you agree to our Terms of Service.
      </p>
    </div>
  );
}