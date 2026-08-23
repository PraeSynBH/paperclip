import { Plus, ExternalLink, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface EmptyStateStep {
  /** Short label for the step (e.g. "Create a plan"). */
  label: string;
  /** Optional description of what this step accomplishes. */
  description?: string;
  /** Optional CTA label for the step. */
  action?: string;
  /** Optional CTA handler for the step. */
  onAction?: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  /** Optional bold heading rendered above the message. */
  title?: string;
  /** Primary message explaining the empty state. */
  message: string;
  /** Optional secondary line rendered under the primary message. */
  description?: string;
  /** Primary CTA label. */
  action?: string;
  /** Primary CTA handler. */
  onAction?: () => void;
  /** Hide the leading "+" glyph on the primary action button. */
  hideActionIcon?: boolean;
  /**
   * Visual variant:
   * - `default` — centered column, standard spacing
   * - `compact` — smaller padding, no icon background, for inline sub-views
   * - `onboarding` — larger hero area suitable for first-run pages
   */
  variant?: "default" | "compact" | "onboarding";
  /** Optional secondary action shown as a text-link below the primary CTA. */
  secondaryAction?: { label: string; onClick: () => void };
  /** Optional multi-step guide rendered below the message. */
  steps?: EmptyStateStep[];
  /** Optional documentation link shown below the CTA. */
  docLink?: { href: string; label: string };
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  description,
  action,
  onAction,
  hideActionIcon = false,
  variant = "default",
  secondaryAction,
  steps,
  docLink,
}: EmptyStateProps) {
  const isCompact = variant === "compact";
  const isOnboarding = variant === "onboarding";

  const paddingY = isCompact ? "py-8" : isOnboarding ? "py-24" : "py-16";
  const iconSize = isCompact ? "h-8 w-8" : "h-10 w-10";
  const iconBg = isCompact ? "bg-transparent p-0 mb-3" : "bg-muted/50 p-4 mb-4";
  const titleSize = isCompact
    ? "text-sm font-semibold"
    : "text-base font-semibold";
  const messageSize = isCompact
    ? "text-xs text-muted-foreground"
    : "text-sm text-muted-foreground";

  return (
    <div className={`flex flex-col items-center justify-center ${paddingY} text-center`}>
      <div className={iconBg}>
        <Icon className={`${iconSize} text-muted-foreground/50`} />
      </div>

      {title ? (
        <>
          <p className={`${titleSize} text-foreground mb-1.5`}>{title}</p>
          <p className={`${messageSize} mb-4 max-w-md`}>{message}</p>
        </>
      ) : (
        <>
          <p className={`${isCompact ? "text-xs" : "text-sm"} font-medium text-foreground mb-1`}>
            {message}
          </p>
          {description && (
            <p className={`max-w-md text-sm text-muted-foreground mb-4`}>
              {description}
            </p>
          )}
        </>
      )}

      {/* Multi-step guide */}
      {steps && steps.length > 0 && (
        <div className="mb-6 w-full max-w-md space-y-3 text-left">
          {steps.map((step, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-3"
            >
              <Badge
                variant="outline"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full p-0 text-[10px]"
              >
                {i + 1}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{step.label}</p>
                {step.description && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {step.description}
                  </p>
                )}
              </div>
              {step.action && step.onAction && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={step.onAction}
                  className="shrink-0"
                >
                  {step.action}
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Primary action */}
      {action && onAction && (
        <Button onClick={onAction} size={isCompact ? "sm" : "default"}>
          {!hideActionIcon && <Plus className="h-4 w-4 mr-1.5" />}
          {action}
        </Button>
      )}

      {/* Secondary action */}
      {secondaryAction && (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          className="mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
        >
          {secondaryAction.label}
        </button>
      )}

      {/* Documentation link */}
      {docLink && (
        <a
          href={docLink.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          {docLink.label}
        </a>
      )}
    </div>
  );
}