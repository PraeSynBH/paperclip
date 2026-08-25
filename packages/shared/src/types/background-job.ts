import type { BackgroundJobStatus } from "../constants.js";

/**
 * A background job record as returned by the API.
 */
export interface BackgroundJob {
  id: string;
  companyId: string;
  jobType: string;
  status: BackgroundJobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  durationMs: number | null;
  progress: number;
  progressMessage: string | null;
  createdByActorId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

/**
 * Input to create a new background job.
 */
export interface CreateBackgroundJobRequest {
  jobType: string;
  payload: Record<string, unknown>;
}

/**
 * A background job event published via SSE or WebSocket.
 */
export interface BackgroundJobEvent {
  jobId: string;
  companyId: string;
  status: BackgroundJobStatus;
  progress: number;
  progressMessage: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}