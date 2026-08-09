export type HeartbeatRunOutcome = "succeeded" | "failed" | "cancelled" | "timed_out";

export type HeartbeatRunStopReason =
  | "completed"
  | "timeout"
  | "cancelled"
  | "budget_paused"
  | "paused"
  | "max_turns_exhausted"
  | "process_lost"
  | "adapter_failed";

export interface HeartbeatRunTimeoutPolicy {
  effectiveTimeoutSec: number | null;
  effectiveTimeoutMs?: number | null;
  timeoutConfigured: boolean;
  timeoutSource: "config" | "default" | "adapter_default" | "unknown";
  /**
   * Stable identifier for who owns/armed this timeout value. Populated once
   * an adapter self-reports its actual armed timeout via
   * `AdapterExecutionResult.adapterTimeoutPolicy` (see AC1/AC2 of RBR-938);
   * `null` for adapters that don't report one, in which case the value
   * below is only ever a guess derived from `adapterConfig`.
   */
  timeoutOwner?: string | null;
}

export interface HeartbeatRunStopMetadata extends HeartbeatRunTimeoutPolicy {
  stopReason: HeartbeatRunStopReason;
  timeoutFired: boolean;
}

/**
 * The subset of `AdapterExecutionResult` this module cares about. Adapters
 * that self-manage a child-process timeout report the timeout they actually
 * armed here; the server must prefer this over guessing from
 * `agent.adapterConfig`, which is empty for every agent unless a user
 * explicitly set `timeoutSec`.
 */
export interface AdapterReportedTimeoutPolicy {
  effectiveTimeoutSec: number;
  timeoutConfigured: boolean;
  timeoutSource: "config" | "adapter_default";
  timeoutOwner: string;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function defaultTimeoutSecForAdapter(adapterType: string) {
  return adapterType === "openclaw_gateway" ? 120 : 0;
}

export function normalizeMaxTurnStopReason(value: unknown): Extract<HeartbeatRunStopReason, "max_turns_exhausted"> | null {
  return value === "max_turns_exhausted" || value === "turn_limit_exhausted"
    ? "max_turns_exhausted"
    : null;
}

export function resolveHeartbeatRunTimeoutPolicy(
  adapterType: string,
  adapterConfig: Record<string, unknown> | null | undefined,
  adapterReportedTimeoutPolicy?: AdapterReportedTimeoutPolicy | null,
): HeartbeatRunTimeoutPolicy {
  // AC1/AC2: if the adapter told us what it actually armed, that is
  // authoritative — it is a fact about the run, not a guess derived from
  // config the adapter may never have consulted (e.g. hermes_local, whose
  // own DEFAULT_TIMEOUT_SEC never round-trips through adapterConfig).
  if (adapterReportedTimeoutPolicy) {
    const timeoutSec = Math.max(0, Math.floor(adapterReportedTimeoutPolicy.effectiveTimeoutSec));
    return {
      effectiveTimeoutSec: timeoutSec,
      timeoutConfigured: adapterReportedTimeoutPolicy.timeoutConfigured,
      timeoutSource: adapterReportedTimeoutPolicy.timeoutSource,
      timeoutOwner: adapterReportedTimeoutPolicy.timeoutOwner,
    };
  }

  const config = adapterConfig ?? {};

  if (adapterType === "http") {
    const hasTimeoutMs = hasOwn(config, "timeoutMs");
    const rawTimeoutMs = hasTimeoutMs ? readFiniteNumber(config.timeoutMs) : 0;
    const timeoutMs = Math.max(0, Math.floor(rawTimeoutMs ?? 0));
    return {
      effectiveTimeoutSec: timeoutMs / 1000,
      effectiveTimeoutMs: timeoutMs,
      timeoutConfigured: timeoutMs > 0,
      timeoutSource: hasTimeoutMs ? "config" : "default",
    };
  }

  const hasTimeoutSec = hasOwn(config, "timeoutSec");
  const defaultTimeoutSec = defaultTimeoutSecForAdapter(adapterType);
  const rawTimeoutSec = hasTimeoutSec ? readFiniteNumber(config.timeoutSec) : defaultTimeoutSec;
  const timeoutSec = Math.max(0, Math.floor(rawTimeoutSec ?? defaultTimeoutSec));

  return {
    effectiveTimeoutSec: timeoutSec,
    timeoutConfigured: timeoutSec > 0,
    timeoutSource: hasTimeoutSec ? "config" : "default",
  };
}

export function inferHeartbeatRunStopReason(input: {
  outcome: HeartbeatRunOutcome;
  errorCode?: string | null;
  errorMessage?: string | null;
}): HeartbeatRunStopReason {
  if (input.outcome === "succeeded") return "completed";
  const maxTurnStopReason = normalizeMaxTurnStopReason(input.errorCode);
  if (maxTurnStopReason) return maxTurnStopReason;
  if (input.outcome === "timed_out") return "timeout";
  if (input.outcome === "failed" && input.errorCode === "process_lost") return "process_lost";
  if (input.outcome === "cancelled") {
    const message = (input.errorMessage ?? "").toLowerCase();
    if (message.includes("budget")) return "budget_paused";
    if (message.includes("pause") || message.includes("paused")) return "paused";
    return "cancelled";
  }
  return "adapter_failed";
}

export function buildHeartbeatRunStopMetadata(input: {
  adapterType: string;
  adapterConfig: Record<string, unknown> | null | undefined;
  outcome: HeartbeatRunOutcome;
  errorCode?: string | null;
  errorMessage?: string | null;
  adapterReportedTimeoutPolicy?: AdapterReportedTimeoutPolicy | null;
}): HeartbeatRunStopMetadata {
  const timeoutPolicy = resolveHeartbeatRunTimeoutPolicy(
    input.adapterType,
    input.adapterConfig,
    input.adapterReportedTimeoutPolicy,
  );
  const stopReason = inferHeartbeatRunStopReason(input);
  return {
    ...timeoutPolicy,
    stopReason,
    timeoutFired: stopReason === "timeout",
  };
}

export function mergeHeartbeatRunStopMetadata(
  resultJson: Record<string, unknown> | null | undefined,
  metadata: HeartbeatRunStopMetadata,
): Record<string, unknown> {
  const existingMaxTurnStopReason = normalizeMaxTurnStopReason(resultJson?.stopReason);
  return {
    ...(resultJson ?? {}),
    stopReason: existingMaxTurnStopReason ?? metadata.stopReason,
    effectiveTimeoutSec: metadata.effectiveTimeoutSec,
    timeoutConfigured: metadata.timeoutConfigured,
    timeoutSource: metadata.timeoutSource,
    timeoutFired: metadata.timeoutFired,
    ...(metadata.effectiveTimeoutMs != null ? { effectiveTimeoutMs: metadata.effectiveTimeoutMs } : {}),
    ...(metadata.timeoutOwner != null ? { timeoutOwner: metadata.timeoutOwner } : {}),
  };
}
