import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { billingApi, type SubscriptionTier, type CompanySubscription } from "@/api/billing";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "../hooks/usePageMeta";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperclipLoading } from "@/components/AnimatedPaperclipIcon";
import { Check, CreditCard, AlertCircle } from "lucide-react";
import { useToast } from "@/context/ToastContext";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

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

export function PricingPage() {
  usePageMeta("Pricing", "Paperclip pricing plans and subscription details.");
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const companyId = selectedCompanyId;

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

  const checkoutMutation = useMutation({
    mutationFn: async (tierId: string) => {
      const result = await billingApi.createCheckoutSession(companyId!, {
        tierId,
        billingPeriod: "monthly",
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
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
                  onClick={() => {
                    if (confirm("Are you sure you want to cancel your subscription? It will remain active until the end of the billing period.")) {
                      cancelMutation.mutate();
                    }
                  }}
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

      {/* Tier cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {(tiers ?? []).map((tier) => {
          const isCurrentTier = tier.id === currentTierId && isSubscribed;
          const features = Array.isArray(tier.features) ? tier.features : [];

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
                  <span className="text-4xl font-bold">{formatCents(tier.priceMonthlyCents)}</span>
                  <span className="text-muted-foreground ml-1">/month</span>
                </div>

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
                    onClick={() => checkoutMutation.mutate(tier.id)}
                    disabled={checkoutMutation.isPending}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {checkoutMutation.isPending ? "Loading..." : "Subscribe"}
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

      {/* Footer note */}
      <p className="mt-8 text-center text-xs text-muted-foreground">
        All prices are in USD. Your subscription can be canceled at any time.
        By subscribing, you agree to our Terms of Service.
      </p>
    </div>
  );
}