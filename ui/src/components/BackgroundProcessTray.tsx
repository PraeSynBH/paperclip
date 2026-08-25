import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { BackgroundJob, BackgroundJobStatus } from "@paperclipai/shared";
import { useBackgroundProcesses } from "@/hooks/useBackgroundProcesses";
import { backgroundJobLabel, formatDuration } from "@/lib/background-jobs";

interface BackgroundProcessTrayProps {
  companyId: string;
  /** Max items to show (default 20). */
  maxItems?: number;
  /** Optional single job-type filter (e.g. "export.pdf"). */
  jobTypeFilter?: string;
  className?: string;
}

const TERMINAL_STATUSES = new Set<BackgroundJobStatus>(["succeeded", "failed"]);

function isRunningStatus(status: BackgroundJobStatus): boolean {
  return status === "queued" || status === "running";
}

/**
 * Consolidated tray of background processes for a company.
 *
 * Uses the shared `useBackgroundProcesses` hook for SSE + polling.
 * Shows running jobs at the top, then recently completed ones.
 * Each row has the label, a progress indicator, duration,
 * and the final result/error.
 */
export function BackgroundProcessTray({
  companyId,
  maxItems = 20,
  jobTypeFilter,
  className = "",
}: BackgroundProcessTrayProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { jobs, runningCount } = useBackgroundProcesses(companyId, {
    maxItems,
    ...(jobTypeFilter ? { jobType: jobTypeFilter } : {}),
  });

  if (jobs.length === 0) return null;

  return (
    <div className={`rounded-lg border border-border bg-card ${className}`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Background Processes
          </span>
          {runningCount > 0 && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-blue-500/10 px-2 text-xs font-medium text-blue-600 dark:text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {runningCount} running
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{collapsed ? "+" : "−"}</span>
      </button>

      {!collapsed && (
        <div className="divide-y divide-border/50 max-h-[320px] overflow-y-auto">
          {jobs.slice(0, maxItems).map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: BackgroundJob }) {
  const isRunning = isRunningStatus(job.status);
  const isTerminal = TERMINAL_STATUSES.has(job.status);

  return (
    <div className="flex items-start gap-2 px-3 py-2 text-sm">
      {/* Status indicator */}
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

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-foreground truncate">{backgroundJobLabel(job.jobType)}</span>
          <span
            className={`text-xs ${
              job.status === "running"
                ? "text-blue-500"
                : job.status === "queued"
                  ? "text-blue-400"
                  : job.status === "succeeded"
                    ? "text-green-600 dark:text-green-400"
                    : job.status === "failed"
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
            }`}
          >
            {job.status}
          </span>
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 w-full max-w-[120px] rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${Math.min(job.progress, 100)}%` }}
              />
            </div>
            {job.progress > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground">{job.progress}%</span>
            )}
          </div>
        )}

        {/* Progress message */}
        {job.progressMessage && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{job.progressMessage}</p>
        )}

        {/* Error */}
        {job.error && (
          <p className="mt-0.5 truncate text-[11px] text-red-500" title={job.error}>
            {job.error}
          </p>
        )}

        {/* Timing */}
        {isTerminal && job.durationMs !== null && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {formatDuration(job.durationMs)}
            {job.finishedAt && ` — ${new Date(job.finishedAt).toLocaleTimeString()}`}
          </p>
        )}
      </div>
    </div>
  );
}
