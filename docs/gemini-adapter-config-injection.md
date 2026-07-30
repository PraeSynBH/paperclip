# Gemini Adapter Config Injection Pattern

**Project:** Aira — ISO 27001 and AI Integration
**Reference:** RBR-634, RBR-636
**Date:** 2026-07-30
**Author:** CEO

---

## Overview

This document describes the configuration injection pattern used by the Gemini adapter toolchain. The pattern enables Paperclip-managed AI agents to use Google Gemini as their primary LLM provider, with automatic fallback to OpenRouter when Gemini fails.

The pattern has three layers:
1. **Shell wrapper** (`gemini-with-key.sh`) — config injection and process management
2. **TypeScript adapter** (`adapter.ts`) — model mapping and canary migration logic
3. **TypeScript client** (`gemini-client.ts`) — direct API calls with retry and safety

---

## 1. Shell Wrapper: gemini-with-key.sh

**File:** `/Users/benh/.paperclip/bin/gemini-with-key.sh`

### How it injects API key auth into temp settings.json

The Gemini CLI reads its authentication configuration from `settings.json` in the directory pointed to by `GEMINI_CLI_HOME`. By default this is `~/.gemini/`, which contains the user's OAuth credentials.

The wrapper avoids modifying the user's real `~/.gemini/` directory:

1. **Create isolated temp home:** `mktemp -d -t paperclip-gemini-key.XXXXXX`
2. **Copy existing config:** `cp -R "$REAL_GEMINI_HOME/." "$TMP_GEMINI_HOME/"` — preserves any existing settings, extensions, or config
3. **Overlay API-key auth:** A Python3 snippet writes `settings.json` with:
   ```json
   {
     "selectedAuthType": "gemini-api-key",
     "security": { "auth": { "selectedType": "gemini-api-key" } }
   }
   ```
   Both the legacy field (`selectedAuthType`) and the current nested field (`security.auth.selectedType`) are set for compatibility across Gemini CLI versions.
4. **Set environment variables:**
   - `GEMINI_CLI_HOME` → points to temp directory
   - `GEMINI_API_KEY` → the resolved API key
   - `GEMINI_DEFAULT_AUTH_TYPE` → `"gemini-api-key"` (belt-and-suspenders)
5. **Execute Gemini CLI** with the temp home. The CLI reads `settings.json`, sees `api-key` auth type, and uses the `GEMINI_API_KEY` env var instead of attempting browser OAuth.

### The GEMINI_CLI_HOME isolation pattern

This is analogous to how `opencode-with-key.sh` uses `XDG_CONFIG_HOME` to isolate the opencode config:

| Aspect | opencode-with-key.sh | gemini-with-key.sh |
|--------|---------------------|-------------------|
| Isolation variable | `XDG_CONFIG_HOME` | `GEMINI_CLI_HOME` |
| Real config | `~/.config/opencode/` | `~/.gemini/` |
| Temp config | mktemp dir | mktemp dir |
| Key injection | writes config.json | writes settings.json |
| Cleanup | temp dir deleted on exit | watchdog process cleans up |

### Key resolution order

The wrapper resolves the Gemini API key with this precedence:
1. `GEMINI_API_KEY` (preferred — Paperclip company secret via `secret_ref`)
2. `GOOGLE_API_KEY` (fallback — Google's generic env var)
3. If neither is set → immediate fallback to OpenRouter (no Gemini invocation)

The resolved key is stored in `API_KEY` and exported as `GEMINI_API_KEY` for the subprocess.

### Cleanup watchdog

A background child process monitors the parent PID and removes the temp directory when the parent exits:

```bash
(
    exec >/dev/null 2>/dev/null </dev/null
    while kill -0 $$ 2>/dev/null; do sleep 90; done
    rm -rf "$TMP_GEMINI_HOME" 2>/dev/null || true
) &
```

Additionally, on startup, orphaned temp dirs older than 1 hour are reaped:
```bash
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'paperclip-gemini-key.*' -type d -mmin +60 -print0 2>/dev/null | xargs -0 rm -rf 2>/dev/null || true
```

---

## 2. Migration Adapter: adapter.ts

**File:** `/Users/benh/paperclip-rambur/Aira/src/ai/adapter.ts`

### How the migration adapter maps OpenRouter models to Gemini models

The `MigrationAdapter` class uses a static model mapping defined in `types.ts`:

```typescript
export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "openrouter/deepseek/deepseek-v4-pro": "gemini-2.5-pro",
  "openrouter/minimax/minimax-m3": "gemini-2.5-flash",
  "openrouter/moonshotai/kimi-k2.7-code": "gemini-2.5-pro",
  "openrouter/openai/gpt-5.5": "gemini-2.5-pro",
};
```

The `mapModel()` method looks up the OpenRouter model name and returns the corresponding Gemini model. If no mapping exists, it defaults to `gemini-2.5-flash`.

### Model tier mapping

```typescript
export const MODEL_TIER_MAP: Record<string, string> = {
  "gemini-2.5-pro": "leadership",
  "gemini-2.5-flash": "ic",
};
```

Leadership agents (CEO, CTO, CISO, etc.) use `gemini-2.5-pro`. Individual contributor agents use `gemini-2.5-flash`.

### Fallback thresholds

The adapter monitors these thresholds during canary migration:

| Threshold | Default | Description |
|-----------|---------|-------------|
| `maxErrorRateIncrease` | 0.05 (5%) | Max increase in error rate vs. OpenRouter baseline |
| `maxLatencyDegradationPercent` | 50% | Max acceptable latency increase |
| `minParityScore` | 0.85 | Minimum output quality parity (85% of OpenRouter score) |
| `maxCostIncreasePercent` | 30% | Max acceptable cost increase |

If any threshold is breached, the adapter triggers `fallbackToOpenRouter()` for the affected agent.

### Validation suite config

```typescript
validationSuite: {
  requiredSampleCount: 100,    // 100+ samples per agent
  taskCategories: ["coding", "analysis", "creative", "compliance"],
  minPassRate: 0.90,           // 90% pass rate gate
}
```

---

## 3. Gemini Client: gemini-client.ts

**File:** `/Users/benh/paperclip-rambur/Aira/src/ai/gemini-client.ts`

### How GeminiClient reads config from AWS Secrets Manager via loadConfig()

The `createGeminiClient()` factory function uses `loadConfig()` from `../config.js`:

```typescript
export async function createGeminiClient(): Promise<GeminiClient> {
  if (cachedClient) return cachedClient;
  const cfg = await loadConfig();
  cachedClient = new GeminiClient({
    apiKey: cfg.googleAi.apiKey,
    baseUrl: cfg.googleAi.baseUrl,
  });
  return cachedClient;
}
```

`loadConfig()` resolves configuration from:
1. **AWS Secrets Manager** — the `googleAi` section is populated from a secret stored in AWS
2. **Environment variables** — fallback if AWS is unavailable
3. **Local config files** — development override

The client is lazily initialized and cached for the process lifetime.

### Client features

- **Direct HTTP calls** to `generativelanguage.googleapis.com/v1beta` (no SDK dependency)
- **Retry with exponential backoff + jitter** — 3 retries max, base 1s, max 30s, 30% jitter
- **Rate limit handling** — 429 responses trigger `Retry-After` header respect
- **Safety settings** — default `BLOCK_LOW_AND_ABOVE` for all 4 harm categories
- **Timeout** — 120s per request with `AbortController`

---

## 4. Fallback Chain: Gemini → OpenRouter

The complete fallback chain:

```
Paperclip agent execution
  │
  ├─ gemini-with-key.sh invoked (adapterConfig.command)
  │   │
  │   ├─ GEMINI_API_KEY set?
  │   │   ├─ YES → Create temp home → Inject settings.json → Run Gemini CLI
  │   │   │         │
  │   │   │         ├─ Gemini succeeds → exit 0 (normal completion)
  │   │   │         │
  │   │   │         └─ Gemini fails (non-zero exit)
  │   │   │             │
  │   │   │             ├─ OPENROUTER_API_KEY set?
  │   │   │             │   ├─ YES → exec opencode-with-key.sh (seamless fallback)
  │   │   │             │   └─ NO  → FATAL, exit with Gemini's exit code
  │   │   │
  │   │   └─ NO → Immediate fallback to opencode-with-key.sh
  │   │
  │   └─ (within Aira app: GeminiClient → retry → throw on exhausted retries)
  │       └─ MigrationAdapter evaluates parity → fallbackToOpenRouter() if below threshold
  │
  └─ opencode-with-key.sh → OpenRouter API (existing, proven path)
```

Key properties:
- **No data loss:** A failed Gemini request always falls back to a working OpenRouter path
- **No offline:** The fallback is transparent — the agent continues with OpenRouter
- **No duplicate instances:** Each invocation creates its own isolated temp directory

---

## 5. How to Add a New Alternate Provider

To extend this pattern for a new provider (e.g., Anthropic Claude, Mistral):

### Step 1: Create the shell wrapper

Create `/Users/benh/.paperclip/bin/<provider>-with-key.sh` following the same pattern:

```bash
#!/bin/bash
# <provider>-with-key.sh
set -euo pipefail

# 1. Resolve API key from env
if [ -z "${<PROVIDER>_API_KEY:-}" ]; then
    exec /Users/benh/.paperclip/bin/opencode-with-key.sh "$@"
fi

# 2. Create isolated temp config directory
TMP_HOME=$(mktemp -d -t paperclip-<provider>-key.XXXXXX)
# ... copy existing config, inject API key into provider-specific config format ...

# 3. Set isolation env vars
export <PROVIDER>_CONFIG_HOME="$TMP_HOME"
export <PROVIDER>_API_KEY="${<PROVIDER>_API_KEY}"

# 4. Execute provider CLI
<PROVIDER>_EXIT_CODE=0
<path-to-provider-cli> "$@" || <PROVIDER>_EXIT_CODE=$?

# 5. Fallback to OpenRouter on failure
if [ "$<PROVIDER>_EXIT_CODE" -ne 0 ]; then
    if [ -n "${OPENROUTER_API_KEY:-}" ]; then
        exec /Users/benh/.paperclip/bin/opencode-with-key.sh "$@"
    fi
    exit "$<PROVIDER>_EXIT_CODE"
fi
exit "$<PROVIDER>_EXIT_CODE"
```

### Step 2: Add model mapping in types.ts

```typescript
export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  ...existing mappings...,
  "openrouter/deepseek/deepseek-v4-pro": "<provider>-4-sonnet",  // or whatever
};
```

### Step 3: Create the TypeScript client

Create `src/ai/<provider>-client.ts` following the `GeminiClient` pattern:
- Constructor takes config (apiKey, baseUrl, retry params)
- HTTP calls to the provider's API endpoint
- Retry with exponential backoff + jitter
- Rate limit handling (429 → retry-after)
- Safety/content filtering appropriate to the provider
- Factory function using `loadConfig()`

### Step 4: Update adapter.ts

Add the new provider to the `MigrationAdapter`:
- New model mappings in `OPENROUTER_MODEL_MAP`
- New fallback thresholds if the provider has different characteristics
- New validation suite categories if the provider has unique capabilities

### Step 5: Update Paperclip agent adapterConfig

In the Paperclip agent configuration:
```json
{
  "adapterConfig": {
    "command": "/Users/benh/.paperclip/bin/<provider>-with-key.sh",
    "env": {
      "<PROVIDER>_API_KEY": { "secret_ref": "<company-secret-id>" }
    }
  }
}
```

### Step 6: Create adapter-settings template

Create `src/ai/adapter-settings.template.json` entry for the new provider (see that file for the template structure).

---

## References

- `gemini-with-key.sh` — `/Users/benh/.paperclip/bin/gemini-with-key.sh`
- `adapter.ts` — `/Users/benh/paperclip-rambur/Aira/src/ai/adapter.ts`
- `gemini-client.ts` — `/Users/benh/paperclip-rambur/Aira/src/ai/gemini-client.ts`
- `types.ts` — `/Users/benh/paperclip-rambur/Aira/src/ai/types.ts`
- `opencode-with-key.sh` — `/Users/benh/.paperclip/bin/opencode-with-key.sh`
- Security assessment — `docs/security-assessment-agent-toolchain-gemini.md`
- Smoke test evidence — `Aira-ISO27001/evidence/gemini-adapter-smoke-test.md`
