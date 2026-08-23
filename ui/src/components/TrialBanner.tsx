import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { billingApi } from "@/api/billing";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock, Sparkles } from "lucide-react";
import { Link } from "@/lib/router";

/**
 * TrialBanner — shows trial status and days remaining.
 * Renders nothing if the company is not on a trial.
 */
export function TrialBanner() {
  const { selectedCompany: company } = useCompany();

  const { data: trialInfo, isLoading } = useQuery({
    queryKey: queryKeys.billing.trialInfo(company?.id ?? ""),
    queryFn: () => billingApi.trialInfo(company?.id ?? ""),
    enabled: !!company?.id,
    refetchInterval: 60_000, // Refresh every minute
  });

  if (isLoading || !trialInfo || !trialInfo.trialing) {
    return null;
  }

  if (trialInfo.expired) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-3">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
        <p className="text-xs text-destructive flex-1">
          Your trial has ended.{" "}
          <Link to="/pricing" className="font-medium underline underline-offset-2">
            Upgrade now
          </Link>{" "}
          to continue using Paperclip.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 flex items-center gap-3">
      <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <p className="text-xs text-amber-800 dark:text-amber-200 flex-1">
        You're on a free trial.{" "}
        <span className="font-semibold">
          {trialInfo.daysRemaining > 0
            ? `${trialInfo.daysRemaining} day${trialInfo.daysRemaining === 1 ? "" : "s"} remaining`
            : "Last day"}
        </span>
        {" — "}
        <Link to="/pricing" className="font-medium underline underline-offset-2">
          Choose a plan
        </Link>{" "}
        when you're ready.
      </p>
    </div>
  );
}

/**
 * TrialBadge — a small inline badge showing "Trial" with days.
 * Useful in headers and navigation contexts.
 */
export function TrialBadge() {
  const { selectedCompany } = useCompany();

  const { data: trialInfo } = useQuery({
    queryKey: queryKeys.billing.trialInfo(selectedCompany?.id ?? ""),
    queryFn: () => billingApi.trialInfo(selectedCompany?.id ?? ""),
    enabled: !!selectedCompany?.id,
  });

  if (!trialInfo?.trialing || trialInfo.expired) {
    return null;
  }

  return (
    <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300">
      <Sparkles className="h-3 w-3" />
      Trial · {trialInfo.daysRemaining}d
    </Badge>
  );
}
