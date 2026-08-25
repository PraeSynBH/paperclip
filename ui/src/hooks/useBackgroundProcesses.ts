import { useCallback, useEffect, useRef, useState } from "react";
import { backgroundJobsApi } from "@/api/background-jobs";
import type { BackgroundJob, BackgroundJobStatus } from "@paperclipai/shared";

export interface UseBackgroundProcessesOptions {
  /** Max items to track (default 20). */
  maxItems?: number;
  /** Optional job-type prefix filter (e.g. "research" matches "research.*"). */
  jobTypePrefix?: string;
  /** Optional exact jobType filter. */
  jobType?: string;
  /**
   * Delay in ms before isWorking transitions to true.
   * Progress is hidden for fast jobs so the itinerary appears to build itself.
   * Default 5000ms.
   */
  showAfterMs?: number;
}

export interface UseBackgroundProcessesResult {
  /** All tracked jobs, sorted running-first then newest-first. */
  jobs: BackgroundJob[];
  /** Currently running/queued jobs. */
  runningJobs: BackgroundJob[];
  /** Recently completed jobs (succeeded/failed). */
  completedJobs: BackgroundJob[];
  /** Number of running jobs. */
  runningCount: number;
  /** The most recently completed job, or null. */
  latestCompleted: BackgroundJob | null;
  /**
   * True when work has been running for longer than showAfterMs.
   * Components should use this to gate inline progress visibility.
   */
  isWorking: boolean;
  /** Manually re-fetch the job list. */
  refresh: () => void;
}

const TERMINAL_STATUSES = new Set<BackgroundJobStatus>(["succeeded", "failed"]);

function isRunningStatus(status: BackgroundJobStatus): boolean {
  return status === "queued" || status === "running";
}

function sortJobs(list: BackgroundJob[]): BackgroundJob[] {
  return [...list].sort((a, b) => {
    const aRunning = isRunningStatus(a.status);
    const bRunning = isRunningStatus(b.status);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Shared hook for subscribing to background process state for a company.
 *
 * Manages an SSE connection to /background-jobs/events with polling fallback.
 * Any component can call this hook and get the same live-updating view of
 * running and recent jobs.
 */
export function useBackgroundProcesses(
  companyId: string | undefined,
  options: UseBackgroundProcessesOptions = {},
): UseBackgroundProcessesResult {
  const {
    maxItems = 20,
    jobTypePrefix,
    jobType,
    showAfterMs = 5000,
  } = options;

  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const listOpts = useCallback((): Parameters<typeof backgroundJobsApi.list>[1] => {
    const params: Parameters<typeof backgroundJobsApi.list>[1] = {
      limit: maxItems,
    };
    if (jobType) params.jobType = jobType;
    return params;
  }, [maxItems, jobType]);

  const refresh = useCallback(() => {
    if (!companyId) return;
    backgroundJobsApi.list(companyId, listOpts()).then((list) => {
      if (unmountedRef.current) return;

      // Apply client-side filter for prefix matching
      const filtered = jobTypePrefix
        ? list.filter((j) => j.jobType.startsWith(jobTypePrefix))
        : list;

      setJobs(filtered);

      // Track whether meaningful work is happening
      const hasRunning = filtered.some((j) => isRunningStatus(j.status));
      if (hasRunning) {
        if (!workingTimerRef.current) {
          workingTimerRef.current = setTimeout(() => {
            if (!unmountedRef.current) setIsWorking(true);
          }, showAfterMs);
        }
      } else {
        if (workingTimerRef.current) {
          clearTimeout(workingTimerRef.current);
          workingTimerRef.current = null;
        }
        setIsWorking(false);
      }
    }).catch(() => {
      // transient — poller/SSE retries
    });
  }, [companyId, maxItems, jobTypePrefix, showAfterMs]);

  // Initial fetch + reset working state on companyId change
  useEffect(() => {
    unmountedRef.current = false;
    setIsWorking(false);
    if (workingTimerRef.current) {
      clearTimeout(workingTimerRef.current);
      workingTimerRef.current = null;
    }
    refresh();
    return () => {
      unmountedRef.current = true;
    };
  }, [refresh]);

  // SSE subscription for live updates, with polling fallback grace period
  useEffect(() => {
    if (!companyId) return;

    // Start a grace period timer: if SSE hasn't connected within 5s, start polling
    const graceTimer = setTimeout(() => {
      if (!eventSourceRef.current && !pollTimerRef.current) {
        pollTimerRef.current = setInterval(refresh, 5000);
      }
    }, 5000);

    try {
      const es = new EventSource(backgroundJobsApi.eventsUrl(companyId));
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data.type === "background_job.status") refresh();
        } catch {
          // ignore malformed SSE
        }
      };

      // SSE connected — cancel grace timer and clear polling fallback
      clearTimeout(graceTimer);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      es.onerror = () => {
        // SSE dropped — restart polling fallback
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(refresh, 5000);
        }
      };
    } catch {
      // SSE not available — grace timer will start polling fallback
    }

    return () => {
      clearTimeout(graceTimer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [companyId, refresh]);

  // Cleanup working timer on unmount
  useEffect(() => {
    return () => {
      if (workingTimerRef.current) {
        clearTimeout(workingTimerRef.current);
        workingTimerRef.current = null;
      }
    };
  }, []);

  // Derived state — sorted so the contract is fulfilled
  const sorted = sortJobs(jobs);
  const runningJobs = sorted.filter((j) => isRunningStatus(j.status));
  const completedJobs = sorted.filter((j) => TERMINAL_STATUSES.has(j.status));
  const runningCount = runningJobs.length;
  const latestCompleted = completedJobs.length > 0 ? completedJobs[0] : null;

  return {
    jobs: sorted,
    runningJobs,
    completedJobs,
    runningCount,
    latestCompleted,
    isWorking,
    refresh,
  };
}
