/**
 * Configurable timeout and interval constants.
 *
 * These values control timeouts, TTLs, cache durations, and other
 * numeric scheduling parameters across the server.  Each constant
 * honours an environment-variable override so operators can tune
 * behaviour without a code change.
 *
 * All values are in milliseconds unless the name ends in `_SECONDS`.
 * Names ending in `_MS` are always milliseconds.
 */

// ---------------------------------------------------------------------------
// Helper: parse a positive integer from an env var, falling back to default
//
// NOTE: the parsed value is unit-agnostic — callers use it directly for
// milliseconds (`_MS` constants), seconds (`_SECONDS` constants), or plain
// counts (e.g. `DEFAULT_SMTP_PORT`). The suffix of the exported constant
// name is the source of truth for the unit.
// ---------------------------------------------------------------------------

function parsePositiveIntFromEnv(envName: string, defaultValue: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
}

// ---------------------------------------------------------------------------
// Network / HTTP server
// ---------------------------------------------------------------------------

/**
 * HTTP keep-alive timeout (ms).  Should outlive the default idle timeout
 * of common reverse proxies (AWS ALB, Nginx, Traefik) to avoid
 * intermittent 502/ECONNRESET errors.
 * Env: PAPERCLIP_KEEP_ALIVE_TIMEOUT_MS  (default: 185000)
 */
export const KEEP_ALIVE_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_KEEP_ALIVE_TIMEOUT_MS",
  185_000,
);

/**
 * HTTP headers timeout (ms).  Must be >= keepAliveTimeout.
 * Env: PAPERCLIP_HEADERS_TIMEOUT_MS  (default: 186000)
 */
export const HEADERS_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_HEADERS_TIMEOUT_MS",
  186_000,
);

/**
 * Tailscale `tailscale ip -4` exec timeout (ms).
 * Env: PAPERCLIP_TAILSCALE_DETECT_TIMEOUT_MS  (default: 3000)
 */
export const TAILSCALE_DETECT_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_TAILSCALE_DETECT_TIMEOUT_MS",
  3_000,
);

// ---------------------------------------------------------------------------
// Board / CLI auth
// ---------------------------------------------------------------------------

/**
 * Default TTL for board API keys (ms).
 * Env: PAPERCLIP_BOARD_API_KEY_TTL_MS  (default: 30 days)
 */
export const BOARD_API_KEY_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_BOARD_API_KEY_TTL_MS",
  30 * 24 * 60 * 60 * 1000,
);

/**
 * Default TTL for CLI auth challenges (ms).
 * Env: PAPERCLIP_CLI_AUTH_CHALLENGE_TTL_MS  (default: 10 minutes)
 */
export const CLI_AUTH_CHALLENGE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_CLI_AUTH_CHALLENGE_TTL_MS",
  10 * 60 * 1000,
);

/**
 * Default TTL for board claim challenges (ms).
 * Env: PAPERCLIP_BOARD_CLAIM_TTL_MS  (default: 24 hours)
 */
export const BOARD_CLAIM_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_BOARD_CLAIM_TTL_MS",
    24 * 60 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/**
 * Default TTL for company invite tokens (ms).
 * Env: PAPERCLIP_COMPANY_INVITE_TTL_MS  (default: 72 hours)
 */
export const COMPANY_INVITE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_COMPANY_INVITE_TTL_MS",
  72 * 60 * 60 * 1000,
);

/**
 * DNS lookup timeout for invite URL hostname resolution (ms).
 * Env: PAPERCLIP_INVITE_RESOLUTION_DNS_TIMEOUT_MS  (default: 3000)
 */
export const INVITE_RESOLUTION_DNS_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_INVITE_RESOLUTION_DNS_TIMEOUT_MS",
  3_000,
);

// ---------------------------------------------------------------------------
// Notifications (SMTP, web push)
// ---------------------------------------------------------------------------

/**
 * SMTP conversation timeout (ms).
 * Env: PAPERCLIP_SMTP_TIMEOUT_MS  (default: 30000)
 */
export const SMTP_CONVERSATION_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_SMTP_TIMEOUT_MS",
  30_000,
);

/**
 * Web push TTL (seconds) — how long the push service should retain a
 * message if the recipient is offline.
 * Env: PAPERCLIP_WEB_PUSH_TTL_SECONDS  (default: 86400 = 24 hours)
 */
export const WEB_PUSH_TTL_SECONDS = Math.max(
  0,
  parsePositiveIntFromEnv("PAPERCLIP_WEB_PUSH_TTL_SECONDS", 86_400),
);

// ---------------------------------------------------------------------------
// Heartbeat / recovery
// ---------------------------------------------------------------------------

/**
 * Staleness threshold for orphaned run reaping (ms).
 * Env: PAPERCLIP_ORPHANED_RUN_STALE_THRESHOLD_MS  (default: 5 minutes)
 */
export const ORPHANED_RUN_STALE_THRESHOLD_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_ORPHANED_RUN_STALE_THRESHOLD_MS",
  5 * 60 * 1000,
);

/**
 * Active-run output suspicion threshold (ms) — no output for this long
 * flags the run as potentially stuck.
 * Env: PAPERCLIP_ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS  (default: 1 hour)
 */
export const ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS",
  60 * 60 * 1000,
);

/**
 * Active-run output critical threshold (ms) — no output for this long
 * flags the run as critically stuck.
 * Env: PAPERCLIP_ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS  (default: 4 hours)
 */
export const ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS",
  4 * 60 * 60 * 1000,
);

/**
 * Active-run output continue re-arm interval (ms) — after a suspicion
 * alert, wait this long before alerting again.
 * Env: PAPERCLIP_ACTIVE_RUN_OUTPUT_CONTINUE_REARM_MS  (default: 30 minutes)
 */
export const ACTIVE_RUN_OUTPUT_CONTINUE_REARM_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_ACTIVE_RUN_OUTPUT_CONTINUE_REARM_MS",
  30 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Board chat
// ---------------------------------------------------------------------------

/**
 * Board conversation subprocess timeout (ms).
 * Env: PAPERCLIP_BOARD_CHAT_TIMEOUT_MS  (default: 120000)
 */
export const BOARD_CHAT_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_BOARD_CHAT_TIMEOUT_MS",
  120_000,
);

// ---------------------------------------------------------------------------
// Pipeline leases
// ---------------------------------------------------------------------------

/**
 * Default pipeline case lease duration (ms).
 * Env: PAPERCLIP_PIPELINE_DEFAULT_LEASE_MS  (default: 15 minutes)
 */
export const PIPELINE_DEFAULT_LEASE_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PIPELINE_DEFAULT_LEASE_MS",
  15 * 60 * 1000,
);

/**
 * Maximum pipeline case lease duration (ms).
 * Env: PAPERCLIP_PIPELINE_MAX_LEASE_MS  (default: 24 hours)
 */
export const PIPELINE_MAX_LEASE_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PIPELINE_MAX_LEASE_MS",
  24 * 60 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// External object / provider caches
// ---------------------------------------------------------------------------

/**
 * Default refresh TTL for external object snapshots (seconds).
 * Env: PAPERCLIP_EXTERNAL_OBJECT_REFRESH_TTL_SECONDS  (default: 300)
 */
export const EXTERNAL_OBJECT_REFRESH_TTL_SECONDS = Math.max(
  1,
  parsePositiveIntFromEnv("PAPERCLIP_EXTERNAL_OBJECT_REFRESH_TTL_SECONDS", 300),
);

/**
 * GitHub-provided external object TTL (seconds).
 * Env: PAPERCLIP_GITHUB_OBJECT_TTL_SECONDS  (default: 300)
 */
export const GITHUB_OBJECT_TTL_SECONDS = Math.max(
  1,
  parsePositiveIntFromEnv("PAPERCLIP_GITHUB_OBJECT_TTL_SECONDS", 300),
);

// ---------------------------------------------------------------------------
// Environment custom images
// ---------------------------------------------------------------------------

/**
 * Default TTL for environment custom-image setup sessions (seconds).
 * Env: PAPERCLIP_SETUP_SESSION_TTL_SECONDS  (default: 3600 = 1 hour)
 */
export const SETUP_SESSION_TTL_SECONDS = Math.max(
  60,
  parsePositiveIntFromEnv("PAPERCLIP_SETUP_SESSION_TTL_SECONDS", 60 * 60),
);

// ---------------------------------------------------------------------------
// AWS Secrets Manager
// ---------------------------------------------------------------------------

/**
 * AWS Secrets Manager HTTP request timeout (ms).
 * Env: PAPERCLIP_AWS_SECRETS_REQUEST_TIMEOUT_MS  (default: 30000)
 */
export const AWS_SECRETS_REQUEST_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_AWS_SECRETS_REQUEST_TIMEOUT_MS",
  30_000,
);

/**
 * AWS credential cache TTL (ms).
 * Env: PAPERCLIP_AWS_CREDENTIAL_CACHE_TTL_MS  (default: 5 minutes)
 */
export const AWS_CREDENTIAL_CACHE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_AWS_CREDENTIAL_CACHE_TTL_MS",
  5 * 60_000,
);

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * Embedding API request timeout (ms).
 * Env: PAPERCLIP_EMBEDDING_TIMEOUT_MS  (default: 10000)
 */
export const EMBEDDING_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_EMBEDDING_TIMEOUT_MS",
  10_000,
);

// ---------------------------------------------------------------------------
// Model list caches
// ---------------------------------------------------------------------------

/**
 * OpenAI / Codex model list fetch timeout (ms).
 * Env: PAPERCLIP_OPENAI_MODELS_TIMEOUT_MS  (default: 5000)
 */
export const OPENAI_MODELS_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_OPENAI_MODELS_TIMEOUT_MS",
  5_000,
);

/**
 * OpenAI / Codex model list cache TTL (ms).
 * Env: PAPERCLIP_OPENAI_MODELS_CACHE_TTL_MS  (default: 60000)
 */
export const OPENAI_MODELS_CACHE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_OPENAI_MODELS_CACHE_TTL_MS",
  60_000,
);

/**
 * Cursor model list cache TTL (ms).
 * Env: PAPERCLIP_CURSOR_MODELS_CACHE_TTL_MS  (default: 60000)
 */
export const CURSOR_MODELS_CACHE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_CURSOR_MODELS_CACHE_TTL_MS",
  60_000,
);

/**
 * Cursor model list subprocess timeout (ms).
 * Env: PAPERCLIP_CURSOR_MODELS_TIMEOUT_MS  (default: 5000)
 */
export const CURSOR_MODELS_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_CURSOR_MODELS_TIMEOUT_MS",
  5_000,
);

// ---------------------------------------------------------------------------
// Feedback export
// ---------------------------------------------------------------------------

/**
 * Feedback / telemetry export flush interval (ms).
 * Env: PAPERCLIP_FEEDBACK_EXPORT_FLUSH_INTERVAL_MS  (default: 5000)
 */
export const FEEDBACK_EXPORT_FLUSH_INTERVAL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_FEEDBACK_EXPORT_FLUSH_INTERVAL_MS",
  5_000,
);

// ---------------------------------------------------------------------------
// Server info
// ---------------------------------------------------------------------------

/**
 * Git info cache TTL (ms).
 * Env: PAPERCLIP_GIT_INFO_CACHE_TTL_MS  (default: 3000)
 */
export const GIT_INFO_CACHE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_GIT_INFO_CACHE_TTL_MS",
  3_000,
);

/**
 * Git command exec timeout (ms).
 * Env: PAPERCLIP_GIT_COMMAND_TIMEOUT_MS  (default: 1500)
 */
export const GIT_COMMAND_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_GIT_COMMAND_TIMEOUT_MS",
  1_500,
);

// ---------------------------------------------------------------------------
// Knowledge document cache
// ---------------------------------------------------------------------------

/**
 * Knowledge document search cache TTL (ms).
 * Env: PAPERCLIP_KNOWLEDGE_SEARCH_CACHE_TTL_MS  (default: 5 minutes)
 */
export const KNOWLEDGE_SEARCH_CACHE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_KNOWLEDGE_SEARCH_CACHE_TTL_MS",
  5 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Adapter config schema cache
// ---------------------------------------------------------------------------

/**
 * Adapter config-schema cache TTL (ms).
 * Env: PAPERCLIP_CONFIG_SCHEMA_CACHE_TTL_MS  (default: 30000)
 */
export const CONFIG_SCHEMA_CACHE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_CONFIG_SCHEMA_CACHE_TTL_MS",
  30_000,
);

// ---------------------------------------------------------------------------
// Plugin UI static file fetch
// ---------------------------------------------------------------------------

/**
 * Plugin UI static file fetch timeout (ms).
 * Env: PAPERCLIP_PLUGIN_UI_STATIC_FETCH_TIMEOUT_MS  (default: 10000)
 */
export const PLUGIN_UI_STATIC_FETCH_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_UI_STATIC_FETCH_TIMEOUT_MS",
  10_000,
);

// ---------------------------------------------------------------------------
// Heartbeat run runtime status
// ---------------------------------------------------------------------------

/**
 * Heartbeat run runtime status TTL (ms).
 * Env: PAPERCLIP_HEARTBEAT_RUN_RUNTIME_STATUS_TTL_MS  (default: 90000)
 */
export const HEARTBEAT_RUN_RUNTIME_STATUS_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_HEARTBEAT_RUN_RUNTIME_STATUS_TTL_MS",
  90_000,
);

// ---------------------------------------------------------------------------
// Issue tree control
// ---------------------------------------------------------------------------

/**
 * Wait time for run-cancellation tasks before responding to the client (ms).
 * Env: PAPERCLIP_TREE_RUN_CANCELLATION_RESPONSE_WAIT_MS  (default: 1000)
 */
export const TREE_RUN_CANCELLATION_RESPONSE_WAIT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_TREE_RUN_CANCELLATION_RESPONSE_WAIT_MS",
  1_000,
);

// ---------------------------------------------------------------------------
// Notifications (SMTP default port)
// ---------------------------------------------------------------------------

/**
 * Default SMTP server port for outgoing email.
 * Env: PAPERCLIP_SMTP_DEFAULT_PORT  (default: 587)
 */
export const DEFAULT_SMTP_PORT = Math.max(
  1,
  parsePositiveIntFromEnv("PAPERCLIP_SMTP_DEFAULT_PORT", 587),
);

// ---------------------------------------------------------------------------
// Plugin system — worker lifecycle
// ---------------------------------------------------------------------------

/**
 * Default timeout for JSON-RPC calls to plugin worker processes (ms).
 * Env: PAPERCLIP_PLUGIN_WORKER_RPC_TIMEOUT_MS  (default: 30000)
 */
export const PLUGIN_WORKER_RPC_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_WORKER_RPC_TIMEOUT_MS",
  30_000,
);

/**
 * Timeout for the initialize RPC call on worker startup (ms).
 * Env: PAPERCLIP_PLUGIN_WORKER_INIT_TIMEOUT_MS  (default: 15000)
 */
export const PLUGIN_WORKER_INIT_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_WORKER_INIT_TIMEOUT_MS",
  15_000,
);

/**
 * Drain wait after requesting graceful shutdown before escalating to SIGTERM (ms).
 * Env: PAPERCLIP_PLUGIN_WORKER_SHUTDOWN_DRAIN_MS  (default: 10000)
 */
export const PLUGIN_WORKER_SHUTDOWN_DRAIN_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_WORKER_SHUTDOWN_DRAIN_MS",
  10_000,
);

/**
 * Grace period after SIGTERM before sending SIGKILL (ms).
 * Env: PAPERCLIP_PLUGIN_WORKER_SIGTERM_GRACE_MS  (default: 5000)
 */
export const PLUGIN_WORKER_SIGTERM_GRACE_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_WORKER_SIGTERM_GRACE_MS",
  5_000,
);

// ---------------------------------------------------------------------------
// Plugin system — HTTP fetches and DNS
// ---------------------------------------------------------------------------

/**
 * Timeout for plugin-originated HTTP fetches to external services (ms).
 * Env: PAPERCLIP_PLUGIN_FETCH_TIMEOUT_MS  (default: 30000)
 */
export const PLUGIN_FETCH_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_FETCH_TIMEOUT_MS",
  30_000,
);

/**
 * Timeout for DNS resolution of plugin fetch target hostnames (ms).
 * Env: PAPERCLIP_DNS_LOOKUP_TIMEOUT_MS  (default: 5000)
 */
export const DNS_LOOKUP_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_DNS_LOOKUP_TIMEOUT_MS",
  5_000,
);

/**
 * Interval at which the plugin log buffer is flushed to the database (ms).
 * Env: PAPERCLIP_LOG_BUFFER_FLUSH_INTERVAL_MS  (default: 5000)
 */
export const LOG_BUFFER_FLUSH_INTERVAL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_LOG_BUFFER_FLUSH_INTERVAL_MS",
  5_000,
);

/**
 * Max duration for a session event subscription (ms). After this the
 * subscription is considered expired and the worker is asked to renew.
 * Env: PAPERCLIP_SESSION_EVENT_SUBSCRIPTION_TIMEOUT_MS  (default: 30 min)
 */
export const SESSION_EVENT_SUBSCRIPTION_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_SESSION_EVENT_SUBSCRIPTION_TIMEOUT_MS",
  30 * 60 * 1_000,
);

// ---------------------------------------------------------------------------
// Plugin system — job scheduler
// ---------------------------------------------------------------------------

/**
 * Tick interval for the plugin job scheduler (ms).
 * Env: PAPERCLIP_PLUGIN_JOB_SCHEDULER_TICK_INTERVAL_MS  (default: 30000)
 */
export const PLUGIN_JOB_SCHEDULER_TICK_INTERVAL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_JOB_SCHEDULER_TICK_INTERVAL_MS",
  30_000,
);

/**
 * Default timeout for runJob RPC calls (ms).
 * Env: PAPERCLIP_PLUGIN_JOB_RPC_TIMEOUT_MS  (default: 300000 = 5 min)
 */
export const PLUGIN_JOB_RPC_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_JOB_RPC_TIMEOUT_MS",
  5 * 60 * 1_000,
);

// ---------------------------------------------------------------------------
// Plugin system — npm install / uninstall
// ---------------------------------------------------------------------------

/**
 * Timeout for npm install/uninstall operations on plugin packages (ms).
 * Env: PAPERCLIP_PLUGIN_NPM_INSTALL_TIMEOUT_MS  (default: 120000)
 */
export const PLUGIN_NPM_INSTALL_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_NPM_INSTALL_TIMEOUT_MS",
  120_000,
);

// ---------------------------------------------------------------------------
// Plugin environment driver
// ---------------------------------------------------------------------------

/**
 * Timeout for plugin environment driver probe operations (ms).
 * Env: PAPERCLIP_PLUGIN_ENV_DRIVER_PROBE_TIMEOUT_MS  (default: 120000)
 */
export const PLUGIN_ENV_DRIVER_PROBE_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_ENV_DRIVER_PROBE_TIMEOUT_MS",
  120_000,
);

/**
 * Overhead buffer added on top of the requested environment driver RPC
 * timeout to cover communication latency (ms).
 * Env: PAPERCLIP_PLUGIN_ENV_DRIVER_RPC_OVERHEAD_MS  (default: 30000)
 */
export const PLUGIN_ENV_DRIVER_RPC_OVERHEAD_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PLUGIN_ENV_DRIVER_RPC_OVERHEAD_MS",
  30_000,
);

// ---------------------------------------------------------------------------
// Cloud upstream transfer
// ---------------------------------------------------------------------------

/**
 * Timeout for upstream discovery fetch operations (ms).
 * Env: PAPERCLIP_CLOUD_UPSTREAM_DISCOVERY_TIMEOUT_MS  (default: 30000)
 */
export const CLOUD_UPSTREAM_DISCOVERY_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_CLOUD_UPSTREAM_DISCOVERY_TIMEOUT_MS",
  30_000,
);

/**
 * Timeout for remote upstream entity fetch operations (ms).
 * Env: PAPERCLIP_CLOUD_UPSTREAM_REMOTE_FETCH_TIMEOUT_MS  (default: 120000)
 */
export const CLOUD_UPSTREAM_REMOTE_FETCH_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_CLOUD_UPSTREAM_REMOTE_FETCH_TIMEOUT_MS",
  120_000,
);

// ---------------------------------------------------------------------------
// Agent start lock
// ---------------------------------------------------------------------------

/**
 * Staleness threshold for agent start locks (ms). Locks older than this are
 * considered stale and allow a new queued-run start to proceed.
 * Env: PAPERCLIP_AGENT_START_LOCK_STALE_MS  (default: 30000)
 */
export const AGENT_START_LOCK_STALE_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_AGENT_START_LOCK_STALE_MS",
  30_000,
);

// ---------------------------------------------------------------------------
// Quota provider
// ---------------------------------------------------------------------------

/**
 * Timeout for quota provider polling operations (ms).
 * Env: PAPERCLIP_QUOTA_PROVIDER_TIMEOUT_MS  (default: 20000)
 */
export const QUOTA_PROVIDER_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_QUOTA_PROVIDER_TIMEOUT_MS",
  20_000,
);

// ---------------------------------------------------------------------------
// Process / sandbox
// ---------------------------------------------------------------------------

/**
 * Tolerance for pid start-time drift between recorded spawn time and kernel
 * process start time (ms).  Used by the reap liveness check.
 * Env: PAPERCLIP_PROCESS_START_TIME_TOLERANCE_MS  (default: 10000)
 */
export const PROCESS_START_TIME_TOLERANCE_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PROCESS_START_TIME_TOLERANCE_MS",
  10_000,
);

/**
 * Timeout for environment sandbox worker ready signal (ms).
 * Env: PAPERCLIP_SANDBOX_WORKER_READY_TIMEOUT_MS  (default: 5000)
 */
export const SANDBOX_WORKER_READY_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_SANDBOX_WORKER_READY_TIMEOUT_MS",
  5_000,
);

// ---------------------------------------------------------------------------
// Memory context injection
// ---------------------------------------------------------------------------

/**
 * Default timeout for memory context injection warm-up (ms).
 * Env: PAPERCLIP_MEMORY_CONTEXT_INJECTION_TIMEOUT_MS  (default: 3000)
 */
export const MEMORY_CONTEXT_INJECTION_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_MEMORY_CONTEXT_INJECTION_TIMEOUT_MS",
  3_000,
);

// ---------------------------------------------------------------------------
// Embedding cache
// ---------------------------------------------------------------------------

/**
 * TTL for embedding result cache (ms).
 * Env: PAPERCLIP_EMBEDDING_CACHE_TTL_MS  (default: 86400000 = 24 hours)
 */
export const EMBEDDING_CACHE_TTL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_EMBEDDING_CACHE_TTL_MS",
  24 * 60 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Issue comment log derivation
// ---------------------------------------------------------------------------

/**
 * Slack time added to the estimated log-derivation deadline for issue
 * comments (ms). Prevents premature timeout on slow log reads.
 * Env: PAPERCLIP_ISSUE_COMMENT_LOG_DERIVATION_SLACK_MS  (default: 60000)
 */
export const ISSUE_COMMENT_LOG_DERIVATION_SLACK_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_ISSUE_COMMENT_LOG_DERIVATION_SLACK_MS",
  60_000,
);

// ---------------------------------------------------------------------------
// Company search rate limit
// ---------------------------------------------------------------------------

/**
 * Rate-limit window for company search (ms).
 * Env: PAPERCLIP_COMPANY_SEARCH_RATE_LIMIT_WINDOW_MS  (default: 60000)
 */
export const COMPANY_SEARCH_RATE_LIMIT_WINDOW_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_COMPANY_SEARCH_RATE_LIMIT_WINDOW_MS",
  60_000,
);

// ---------------------------------------------------------------------------
// Productivity review
// ---------------------------------------------------------------------------

/**
 * Default refresh interval for productivity review evaluations (ms).
 * Env: PAPERCLIP_PRODUCTIVITY_REVIEW_REFRESH_INTERVAL_MS  (default: 3600000 = 1 hour)
 */
export const PRODUCTIVITY_REVIEW_REFRESH_INTERVAL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_PRODUCTIVITY_REVIEW_REFRESH_INTERVAL_MS",
  60 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Recovery / continuation
// ---------------------------------------------------------------------------

/**
 * Base back-off delay for transient continuation recovery failures (ms).
 * Env: PAPERCLIP_CONTINUATION_RECOVERY_BASE_BACKOFF_MS  (default: 60000)
 */
export const CONTINUATION_RECOVERY_BASE_BACKOFF_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_CONTINUATION_RECOVERY_BASE_BACKOFF_MS",
  60_000,
);

// ---------------------------------------------------------------------------
// Heartbeat — managed workspace / JWT
// ---------------------------------------------------------------------------

/**
 * Timeout for git clone operations in managed workspaces (ms).
 * Env: PAPERCLIP_MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS  (default: 600000 = 10 min)
 */
export const MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS",
  10 * 60 * 1000,
);

/**
 * Margin added on top of a run's configured max wall-clock timeout when
 * sizing the agent JWT TTL (seconds). Covers clock skew and tail-end API
 * calls right up against the run's timeout.
 * Env: PAPERCLIP_AGENT_JWT_TIMEOUT_MARGIN_SECONDS  (default: 300 = 5 min)
 */
export const AGENT_JWT_TIMEOUT_MARGIN_SECONDS = Math.max(
  0,
  parsePositiveIntFromEnv("PAPERCLIP_AGENT_JWT_TIMEOUT_MARGIN_SECONDS", 5 * 60),
);

// ---------------------------------------------------------------------------
// Environment provision
// ---------------------------------------------------------------------------

/**
 * Timeout for environment provision operations (ms).
 * Env: PAPERCLIP_ENVIRONMENT_PROVISION_TIMEOUT_MS  (default: 300000 = 5 min)
 */
export const ENVIRONMENT_PROVISION_TIMEOUT_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_ENVIRONMENT_PROVISION_TIMEOUT_MS",
  300_000,
);

// ---------------------------------------------------------------------------
// PostHog telemetry flush
// ---------------------------------------------------------------------------

/**
 * Flush interval for PostHog telemetry client (ms).
 * Env: PAPERCLIP_POSTHOG_FLUSH_INTERVAL_MS  (default: 10000)
 */
export const POSTHOG_FLUSH_INTERVAL_MS = parsePositiveIntFromEnv(
  "PAPERCLIP_POSTHOG_FLUSH_INTERVAL_MS",
  10_000,
);