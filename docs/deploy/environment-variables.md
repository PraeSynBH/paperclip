---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Paperclip uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `PAPERCLIP_BIND` | `loopback` | Reachability preset: `loopback`, `lan`, `tailnet`, or `custom` |
| `PAPERCLIP_BIND_HOST` | (unset) | Required when `PAPERCLIP_BIND=custom` |
| `HOST` | `127.0.0.1` | Legacy host override; prefer `PAPERCLIP_BIND` for new setups |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `PAPERCLIP_HOME` | `~/.paperclip` | Base directory for all Paperclip data |
| `PAPERCLIP_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `PAPERCLIP_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |
| `PAPERCLIP_DEPLOYMENT_EXPOSURE` | `private` | Exposure policy when deployment mode is `authenticated` |
| `PAPERCLIP_API_URL` | (auto-derived) | Paperclip API base URL. When set externally (e.g., via Kubernetes ConfigMap, load balancer, or reverse proxy), the server preserves the value instead of deriving it from the listen host and port. Useful for deployments where the public-facing URL differs from the local bind address. |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPERCLIP_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `PAPERCLIP_SECRETS_MASTER_KEY_FILE` | `~/.paperclip/.../secrets/master.key` | Path to key file |
| `PAPERCLIP_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `PAPERCLIP_AGENT_ID` | Agent's unique ID |
| `PAPERCLIP_COMPANY_ID` | Company ID |
| `PAPERCLIP_API_URL` | Paperclip API base URL (inherits the server-level value; see Server Configuration above) |
| `PAPERCLIP_API_KEY` | Short-lived JWT for API auth |
| `PAPERCLIP_RUN_ID` | Current heartbeat run ID |
| `PAPERCLIP_TASK_ID` | Issue that triggered this wake |
| `PAPERCLIP_WAKE_REASON` | Wake trigger reason |
| `PAPERCLIP_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `PAPERCLIP_APPROVAL_ID` | Resolved approval ID |
| `PAPERCLIP_APPROVAL_STATUS` | Approval decision |
| `PAPERCLIP_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |

## Configurable Timeouts, TTLs, and Intervals

These environment variables control timeouts, TTLs, and intervals across the system. Each variable has a sensible default — override only when your deployment has specific performance or reliability requirements.

A full reference with all variables, defaults, and descriptions is available at [server/docs/configurable-timeouts.md](https://github.com/paperclip-ai/paperclip/blob/main/server/docs/configurable-timeouts.md) (internal).

### Network / HTTP Server

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_KEEP_ALIVE_TIMEOUT_MS` | 185000 | HTTP keep-alive timeout |
| `PAPERCLIP_TAILSCALE_DETECT_TIMEOUT_MS` | 3000 | `tailscale ip -4` exec timeout |

*The HTTP headers timeout is always derived as `KEEP_ALIVE_TIMEOUT_MS + 1000ms` (ensures `headersTimeout ≥ keepAliveTimeout` as required by Node.js).*

### Auth / Board

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_BOARD_API_KEY_TTL_MS` | 30 d | Board API key TTL |
| `PAPERCLIP_CLI_AUTH_CHALLENGE_TTL_MS` | 10 min | CLI auth challenge TTL |
| `PAPERCLIP_BOARD_CLAIM_TTL_MS` | 24 h | Board claim challenge TTL |

### Invites

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_COMPANY_INVITE_TTL_MS` | 72 h | Company invite token TTL |
| `PAPERCLIP_INVITE_RESOLUTION_DNS_TIMEOUT_MS` | 3000 | DNS lookup timeout for invite URLs |
| `PAPERCLIP_INVITE_RESOLUTION_PROBE_DEFAULT_TIMEOUT_MS` | 5000 | Default HTTP probe timeout for invite resolution |

### Notifications

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_SMTP_TIMEOUT_MS` | 30000 | SMTP conversation timeout |
| `PAPERCLIP_WEB_PUSH_TTL_SECONDS` | 86400 | Web push TTL (seconds) |
| `PAPERCLIP_SMTP_DEFAULT_PORT` | 587 | Default SMTP port |

### Pipeline Leases

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_PIPELINE_DEFAULT_LEASE_MS` | 15 min | Default pipeline case lease |
| `PAPERCLIP_PIPELINE_MAX_LEASE_MS` | 24 h | Maximum pipeline case lease |

### Agent Runtime

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_BOARD_CHAT_TIMEOUT_MS` | 120000 | Board conversation subprocess timeout |
| `PAPERCLIP_EMBEDDING_TIMEOUT_MS` | 10000 | Embedding API request timeout |
| `PAPERCLIP_EMBEDDING_CACHE_TTL_MS` | 24 h | Embedding result cache TTL |
| `PAPERCLIP_MEMORY_CONTEXT_INJECTION_TIMEOUT_MS` | 3000 | Memory context injection warm-up timeout |
| `PAPERCLIP_SANDBOX_WORKER_READY_TIMEOUT_MS` | 5000 | Environment sandbox worker ready timeout |

### Plugin System

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_PLUGIN_WORKER_RPC_TIMEOUT_MS` | 30000 | JSON-RPC call timeout to plugin workers |
| `PAPERCLIP_PLUGIN_WORKER_INIT_TIMEOUT_MS` | 15000 | Init RPC timeout on worker startup |
| `PAPERCLIP_PLUGIN_FETCH_TIMEOUT_MS` | 30000 | Plugin-originated HTTP fetch timeout |
| `PAPERCLIP_PLUGIN_NPM_INSTALL_TIMEOUT_MS` | 120000 | npm install/uninstall timeout |
| `PAPERCLIP_DNS_LOOKUP_TIMEOUT_MS` | 5000 | DNS resolution timeout for plugin fetches |
| `PAPERCLIP_PLUGIN_JOB_RPC_TIMEOUT_MS` | 5 min | `runJob` RPC timeout |
| `PAPERCLIP_PLUGIN_JOB_SCHEDULER_TICK_INTERVAL_MS` | 30000 | Job scheduler tick interval |
| `PAPERCLIP_PLUGIN_UI_STATIC_FETCH_TIMEOUT_MS` | 10000 | Plugin UI static file fetch timeout |

### Environment / Sandbox

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_PLUGIN_ENV_DRIVER_PROBE_TIMEOUT_MS` | 120000 | Environment driver probe timeout |
| `PAPERCLIP_ENVIRONMENT_PROVISION_TIMEOUT_MS` | 5 min | Environment provision timeout |
| `PAPERCLIP_SETUP_SESSION_TTL_SECONDS` | 1 h | Custom-image setup session TTL |
| `PAPERCLIP_PROCESS_START_TIME_TOLERANCE_MS` | 10000 | PID start-time drift tolerance |

### Heartbeat / Recovery

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_ORPHANED_RUN_STALE_THRESHOLD_MS` | 5 min | Staleness threshold for orphaned run reaping |
| `PAPERCLIP_ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS` | 1 h | Suspicion threshold (no output) |
| `PAPERCLIP_ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS` | 4 h | Critical threshold (no output) |
| `PAPERCLIP_CONTINUATION_RECOVERY_BASE_BACKOFF_MS` | 60000 | Base back-off for continuation recovery |

### Infrastructure / Telemetry

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_AWS_SECRETS_REQUEST_TIMEOUT_MS` | 30000 | AWS Secrets Manager HTTP request timeout |
| `PAPERCLIP_AWS_CREDENTIAL_CACHE_TTL_MS` | 5 min | Credential cache TTL |
| `PAPERCLIP_POSTHOG_FLUSH_INTERVAL_MS` | 10000 | PostHog telemetry flush interval |
| `PAPERCLIP_OTEL_SHUTDOWN_TIMEOUT_MS` | 5000 | OTel SDK shutdown timeout during process exit |
| `PAPERCLIP_MANAGED_WORKSPACE_GIT_CLONE_TIMEOUT_MS` | 10 min | Git clone timeout for managed workspaces |
| `PAPERCLIP_GIT_INFO_CACHE_TTL_MS` | 3000 | Git info cache TTL |
| `PAPERCLIP_GIT_COMMAND_TIMEOUT_MS` | 1500 | Git command exec timeout |
| `PAPERCLIP_RUNTIME_SERVICE_HEALTH_TIMEOUT_MS` | 2000 | Runtime service health-check fetch timeout |
| `PAPERCLIP_WS_PING_INTERVAL_MS` | 30000 | WebSocket ping frame interval |
| `PAPERCLIP_FEEDBACK_EXPORT_FLUSH_INTERVAL_MS` | 5000 | Feedback/telemetry export flush interval |

### Object Caches

| Variable | Default | Description |
|---|---|---|
| `PAPERCLIP_EXTERNAL_OBJECT_REFRESH_TTL_SECONDS` | 300 s | External object snapshot refresh TTL |
| `PAPERCLIP_GITHUB_OBJECT_TTL_SECONDS` | 300 s | GitHub-provided object TTL |
| `PAPERCLIP_OPENAI_MODELS_TIMEOUT_MS` | 5000 | OpenAI/Codex model list fetch timeout |
| `PAPERCLIP_OPENAI_MODELS_CACHE_TTL_MS` | 60000 | Model list cache TTL |
| `PAPERCLIP_CURSOR_MODELS_TIMEOUT_MS` | 5000 | Cursor model list subprocess timeout |
| `PAPERCLIP_CURSOR_MODELS_CACHE_TTL_MS` | 60000 | Cursor model list cache TTL |
| `PAPERCLIP_KNOWLEDGE_SEARCH_CACHE_TTL_MS` | 5 min | Knowledge document search cache TTL |
| `PAPERCLIP_CONFIG_SCHEMA_CACHE_TTL_MS` | 30000 | Adapter config-schema cache TTL |
| `PAPERCLIP_HEARTBEAT_RUN_RUNTIME_STATUS_TTL_MS` | 90000 | Heartbeat run runtime status TTL |
| `PAPERCLIP_AGENT_START_LOCK_STALE_MS` | 30000 | Agent start lock staleness threshold |
