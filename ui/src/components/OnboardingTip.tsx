import { useState } from "react";
import { Lightbulb, X, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OnboardingTipProps {
  /** Optional icon override. Defaults to Lightbulb. */
  icon?: LucideIcon;
  /** Bold heading text. */
  title: string;
  /** Optional supporting description. */
  description?: string;
  /** Optional CTA label. */
  action?: string;
  /** Optional CTA handler. */
  onAction?: () => void;
  /** Whether the tip can be dismissed. Defaults to true. */
  dismissable?: boolean;
  /** Callback when the tip is dismissed. */
  onDismiss?: () => void;
  /**
   * Visual placement:
   * - `inline` — full-width banner within content flow
   * - `card` — compact card that can sit in a sidebar or corner
   * - `tooltip` — small inline badge-style tip
   */
  variant?: "inline" | "card" | "tooltip";
}

export function OnboardingTip({
  icon: Icon = Lightbulb,
  title,
  description,
  action,
  onAction,
  dismissable = true,
  onDismiss,
  variant = "inline",
}: OnboardingTipProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (variant === "tooltip") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <Icon className="h-3 w-3 shrink-0" />
        <span>{title}</span>
        {action && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="ml-0.5 inline-flex items-center gap-0.5 font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
          >
            {action}
            <ArrowRight className="h-2.5 w-2.5" />
          </button>
        )}
        {dismissable && (
          <button
            type="button"
            onClick={handleDismiss}
            className="ml-1 rounded-full p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            aria-label="Dismiss tip"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className="relative rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-800/30 dark:bg-amber-950/30">
        {dismissable && (
          <button
            type="button"
            onClick={handleDismiss}
            className="absolute right-2 top-2 rounded p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
            aria-label="Dismiss tip"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <div className="flex items-start gap-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
              {title}
            </p>
            {description && (
              <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
                {description}
              </p>
            )}
            {action && onAction && (
              <Button
                size="xs"
                variant="outline"
                onClick={onAction}
                className="mt-2 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                {action}
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Inline banner (default)
  return (
    <div className="relative flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 dark:border-amber-800/30 dark:bg-amber-950/30">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
          {title}
        </p>
        {description && (
          <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
            {description}
          </p>
        )}
        {action && onAction && (
          <Button
            size="sm"
            variant="outline"
            onClick={onAction}
            className="mt-2 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
          >
            {action}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {dismissable && (
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
          aria-label="Dismiss tip"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}