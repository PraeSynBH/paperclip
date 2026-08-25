import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { type UrgencyLevel, type ArtifactUrgency } from "@/lib/tripUrgency";

// ── Urgency Badge ────────────────────────────────────────────────────────────

interface UrgencyBadgeProps {
  level: UrgencyLevel;
  /** Short label (e.g. "Book now", "Soon", "On track"). */
  label?: string;
  className?: string;
  /** If true, render as a dot only (no label/text). */
  dotOnly?: boolean;
  /** Optional tooltip title. */
  title?: string;
}

const URGENCY_CONFIG: Record<UrgencyLevel, { dot: string; bg: string; text: string; border: string; icon: React.ReactNode }> = {
  red: {
    dot: "bg-red-500",
    bg: "bg-red-500/10 dark:bg-red-500/20",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-500/30 dark:border-red-500/40",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  },
  amber: {
    dot: "bg-amber-500",
    bg: "bg-amber-500/10 dark:bg-amber-500/20",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/30 dark:border-amber-500/40",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  green: {
    dot: "bg-green-500",
    bg: "bg-green-500/10 dark:bg-green-500/20",
    text: "text-green-600 dark:text-green-400",
    border: "border-green-500/30 dark:border-green-500/40",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  grey: {
    dot: "bg-muted-foreground/50",
    bg: "bg-muted/50",
    text: "text-muted-foreground",
    border: "border-border/50",
    icon: <HelpCircle className="h-3.5 w-3.5" />,
  },
};

/**
 * Coloured urgency badge — rendered as either a full label badge or a
 * compact dot-only indicator.
 */
export function UrgencyBadge({ level, label, className, dotOnly, title }: UrgencyBadgeProps) {
  const cfg = URGENCY_CONFIG[level];

  if (dotOnly) {
    return (
      <span
        className={cn("inline-block h-2 w-2 shrink-0 rounded-full", cfg.dot, className)}
        title={title ?? label ?? level}
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        cfg.bg,
        cfg.text,
        cfg.border,
        className,
      )}
      title={title}
    >
      {cfg.icon}
      {label ?? level}
    </span>
  );
}

// ── Sell-out / remaining-count warning ───────────────────────────────────────

interface SellOutWarningProps {
  /** Estimated remaining count. */
  remainingCount: number | null;
  className?: string;
}

/**
 * "Book now — N remaining" inline warning. Shown on activity cards and
 * booking checklist items when a sell-out heuristic fires.
 */
export function SellOutWarning({ remainingCount, className }: SellOutWarningProps) {
  if (remainingCount === null || remainingCount === undefined) return null;

  const isUrgent = remainingCount <= 3;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        isUrgent ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      <Clock className="h-3 w-3" />
      {isUrgent
        ? `Book now — ${remainingCount} remaining`
        : `${remainingCount} left — book soon`}
    </span>
  );
}

// ── Booking deadline countdown ───────────────────────────────────────────────

interface BookingDeadlineBadgeProps {
  /** Days until the booking deadline. */
  daysUntilDeadline: number | null;
  className?: string;
}

/**
 * Prominent badge showing how many days remain to book. Renders as red
 * when ≤ 0 days, amber when ≤ 7 days.
 */
export function BookingDeadlineBadge({ daysUntilDeadline, className }: BookingDeadlineBadgeProps) {
  if (daysUntilDeadline === null || daysUntilDeadline === undefined) return null;

  const isUrgent = daysUntilDeadline <= 0;
  const isSoon = daysUntilDeadline <= 7;

  if (!isSoon) return null; // No badge for deadlines > 7 days

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        isUrgent
          ? "border-red-500/30 bg-red-500/10 text-red-600 dark:border-red-500/40 dark:text-red-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:border-amber-500/40 dark:text-amber-400",
        className,
      )}
    >
      <Clock className="h-3 w-3" />
      {isUrgent ? "Deadline passed" : `${daysUntilDeadline} day${daysUntilDeadline === 1 ? "" : "s"} left`}
    </span>
  );
}

// ── Urgency dot legend (for UrgencySummaryPanel) ─────────────────────────────

interface UrgencyDotLegendProps {
  className?: string;
}

/**
 * Small legend explaining the urgency colour dots. Placed at the bottom
 * of the urgency summary panel.
 */
export function UrgencyDotLegend({ className }: UrgencyDotLegendProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
        Blocking
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
        Soon
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
        On track
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/50" />
        Unknown
      </span>
    </div>
  );
}

// ── Combined urgency card header element ─────────────────────────────────────

interface UrgencyRowProps {
  urgency: ArtifactUrgency;
  /** Optional compact mode — dot only, no label row. */
  compact?: boolean;
  className?: string;
}

/**
 * A horizontal row showing the urgency badge + sell-out warning +
 * deadline badge for a single item. Used inside activity cards and
 * booking checklist items.
 */
export function UrgencyRow({ urgency, compact, className }: UrgencyRowProps) {
  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <UrgencyBadge level={urgency.level} dotOnly title={urgency.reason.description} />
        {urgency.remainingCount !== null && urgency.remainingCount <= 3 && (
          <SellOutWarning remainingCount={urgency.remainingCount} />
        )}
      </span>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <UrgencyBadge level={urgency.level} label={urgency.reason.label} title={urgency.reason.description} />
      {urgency.remainingCount !== null && (
        <SellOutWarning remainingCount={urgency.remainingCount} />
      )}
      {urgency.daysUntilDeadline !== null && (
        <BookingDeadlineBadge daysUntilDeadline={urgency.daysUntilDeadline} />
      )}
    </div>
  );
}
