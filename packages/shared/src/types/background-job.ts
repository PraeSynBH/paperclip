import type { BackgroundJobStatus } from "../background-job-types.js";

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
 * The payload carried inside a background_job.status LiveEvent envelope.
 * This is what {@link BackgroundJobEvent.payload} contains.
 */
export interface BackgroundJobEventPayload {
  jobId: string;
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

/**
 * A background job event published via SSE or WebSocket.
 * Matches the LiveEvent envelope wire format: the event is wrapped in
 * `{ id, companyId, type, createdAt, payload }` where `payload` is a
 * {@link BackgroundJobEventPayload}.
 */
export interface BackgroundJobEvent {
  id: string;
  companyId: string;
  type: "background_job.status";
  createdAt: string;
  payload: BackgroundJobEventPayload;
}
