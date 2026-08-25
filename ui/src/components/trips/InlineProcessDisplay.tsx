import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, X } from "lucide-react";
import type { BackgroundJob } from "@paperclipai/shared";
import { useBackgroundProcesses, type UseBackgroundProcessesOptions } from "@/hooks/useBackgroundProcesses";
import { backgroundJobLabel, formatDuration } from "@/lib/background-jobs";
import { cn } from "@/lib/utils";

interface InlineProcessDisplayProps {
  companyId: string;
  /** Display mode: "plan" for inline, "prepare" for dismissable, "go" for hidden. */
  mode: "plan" | "prepare" | "go";
  /**
   * Additional options for useBackgroundProcesses.
   * Defaults to filtering research job types with a 5-second show delay.
   */
  options?: Partial<UseBackgroundProcessesOptions>;
  className?: string;
}

/**
 * Inline progress display for background processes.
 *
 * Mode-aware rendering:
 * - **plan**: Shows inline "Sage is researching..." with progress in the itinerary panel.
 *             Progress appears only after the configured delay (> 5s by default).
 * - **prepare**: Collapsed by default, expands when a job completes.
 * - **go**: Hidden entirely (background processes should be done before travel).
 */
export function InlineProcessDisplay({
  companyId,
  mode,
  options,
  className,
}: InlineProcessDisplayProps) {
  const {
    jobs,
    runningJobs,
    completedJobs,
    runningCount,
    isWorking,
  } = useBackgroundProcesses(companyId, {
    maxItems: 10,
    jobTypePrefix: "research", // default: only research jobs
    showAfterMs: 5000,
    ...options,
  });

  // Prepare mode: collapsed by default, auto-expand on new completion
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const prevCompletedCountRef = useRef(completedJobs.length);

  // Auto-expand when a new job completes (prepare mode)
  useEffect(() => {
    if (
      mode === "prepare" &&
      completedJobs.length > prevCompletedCountRef.current &&
      collapsed &&
      !dismissed
    ) {
      setCollapsed(false);
    }
    prevCompletedCountRef.current = completedJobs.length;
  }, [completedJobs.length, mode, collapsed, dismissed]);

  // Hide in go mode
  if (mode === "go") return null;

  // --- Plan mode: simple inline progress ---
  if (mode === "plan") {
    if (!isWorking || runningCount === 0) return null;

    return (
      <PlanProgress
        runningJobs={runningJobs}
        runningCount={runningCount}
        className={className}
      />
    );
  }

  // --- Prepare mode: dismissable tray ---
  if (mode === "prepare") {
    if (dismissed) return null;

    // Only show if there are running or recently completed jobs
    if (jobs.length === 0) return null;

    return (
      <PrepareProgress
        jobs={jobs}
        runningJobs={runningJobs}
        completedJobs={completedJobs}
        runningCount={runningCount}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onDismiss={() => setDismissed(true)}
        className={className}
      />
    );
  }

  return null;
}

// ── Plan mode progress ────────────────────────────────────────────────────────

function PlanProgress({
  runningJobs,
  runningCount,
  className,
}: {
  runningJobs: BackgroundJob[];
  runningCount: number;
  className?: string;
}) {
  const primaryJob = runningJobs[0];

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border/50 bg-blue-500/5 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
      <span className="flex-1 min-w-0">
        {primaryJob ? (
          <>
            <span className="font-medium text-foreground">
              {backgroundJobLabel(primaryJob.jobType)}
            </span>
            {primaryJob.progressMessage && (
              <span className="ml-1 text-muted-foreground">
                {primaryJob.progressMessage}
              </span>
            )}
            {primaryJob.progress > 0 && (
              <span className="ml-1 text-blue-500 tabular-nums">
                {primaryJob.progress}%
              </span>
            )}
          </>
        ) : (
          <span>Sage is working on something&hellip;</span>
        )}
        {runningCount > 1 && (
          <span className="ml-1 text-muted-foreground">
            (+{runningCount - 1} more)
          </span>
        )}
      </span>

      {/* Mini progress bar */}
      {primaryJob && primaryJob.progress > 0 && (
        <div className="h-1 w-16 rounded-full bg-muted overflow-hidden shrink-0">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${Math.min(primaryJob.progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Prepare mode progress ─────────────────────────────────────────────────────

function PrepareProgress({
  jobs,
  runningJobs,
  completedJobs,
  runningCount,
  collapsed,
  onToggle,
  onDismiss,
  className,
}: {
  jobs: BackgroundJob[];
  runningJobs: BackgroundJob[];
  completedJobs: BackgroundJob[];
  runningCount: number;
  collapsed: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        className,
      )}
    >
      {/* Header — always visible */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              collapsed ? "-rotate-90" : "",
            )}
          />
          <span className="flex items-center gap-1.5">
            {runningCount > 0 ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                <span>
                  {runningCount} job{runningCount === 1 ? "" : "s"} running
                </span>
              </>
            ) : completedJobs.length > 0 ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                <span>
                  {completedJobs.length} job{completedJobs.length === 1 ? "" : "s"} complete
                </span>
              </>
            ) : (
              <span>Background processes</span>
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded list */}
      {!collapsed && (
        <div className="divide-y divide-border/50 max-h-[240px] overflow-y-auto">
          {jobs.slice(0, 10).map((job) => (
            <PrepareJobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function PrepareJobRow({ job }: { job: BackgroundJob }) {
  const isRunning = job.status === "queued" || job.status === "running";
  const isTerminal = job.status === "succeeded" || job.status === "failed";

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
      <span
        className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
          isRunning
            ? "bg-blue-500 animate-pulse"
            : job.status === "succeeded"
              ? "bg-green-500"
              : job.status === "failed"
                ? "bg-red-500"
                : "bg-muted-foreground"
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground truncate">
          {backgroundJobLabel(job.jobType)}
        </span>
        {isRunning && job.progressMessage && (
          <span className="ml-1 text-muted-foreground">
            {job.progressMessage}
          </span>
        )}
        {job.error && (
          <span className="ml-1 text-red-500" title={job.error}>
            Failed
          </span>
        )}
        {isTerminal && job.durationMs !== null && (
          <span className="ml-1 text-muted-foreground">
            {formatDuration(job.durationMs)}
          </span>
        )}
      </div>
      {isRunning && job.progress > 0 && (
        <span className="tabular-nums text-muted-foreground shrink-0">
          {job.progress}%
        </span>
      )}
    </div>
  );
}
