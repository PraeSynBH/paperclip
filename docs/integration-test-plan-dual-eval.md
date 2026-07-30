# Integration Test Plan: Dual-Eval Parity Testing (Gemini vs. OpenRouter)

**Project:** Aira — ISO 27001 and AI Integration
**Reference:** RBR-634, RBR-636, adapter.ts (MigrationAdapter)
**Date:** 2026-07-30
**Author:** CEO
**Status:** PLAN (execution requires GEMINI_API_KEY — board-dependent)

---

## 1. Objective

Verify that the Gemini provider produces output of comparable quality to OpenRouter across all agent roles, before migrating any agent to Gemini as primary provider. This is a **canary validation** — no agent switches until the parity gate passes.

## 2. Test Approach: Dual Evaluation (Dual-Eval)

For each test sample:
1. Send the **same prompt** to both Gemini and OpenRouter
2. Capture the output from both providers
3. Compare outputs using structural, factual, and adherence metrics
4. Score the comparison as PASS or FAIL per sample
5. Aggregate across 100+ samples per agent

This is the same pattern implemented in `MigrationAdapter.recordParityEval()` and evaluated by `MigrationAdapter.evaluateParity()`.

## 3. Test Categories

From `adapter.ts` `DEFAULT_MIGRATION_CONFIG.validationSuite.taskCategories`:

| Category | Description | Sample Count Target | Example Prompts |
|----------|-------------|--------------------|-----------------|
| **Coding** | Code generation, debugging, refactoring | 30+ | "Write a TypeScript function that...", "Fix the bug in...", "Refactor this class to..." |
| **Analysis** | Data analysis, report generation, risk assessment | 25+ | "Analyze these metrics and identify...", "Summarize the security findings..." |
| **Creative** | Marketing copy, content creation, ideation | 25+ | "Write a product announcement for...", "Create a customer email about..." |
| **Compliance** | ISO 27001 control mapping, policy review, audit prep | 20+ | "Map this control to ISO 27001 Annex A...", "Review this policy for gaps..." |

**Total: 100+ samples per agent**

## 4. Parity Scoring Metrics

Each sample comparison produces a `ParityEvalResult` (from `types.ts`):

```typescript
interface ParityEvalResult {
  agentId: string;
  taskId: string;
  taskCategory: string;
  openRouterModel: string;
  geminiModel: string;
  openRouterScore: number;    // 0-10 quality score
  geminiScore: number;        // 0-10 quality score
  latencyDeltaMs: number;     // Gemini latency minus OpenRouter latency
  costDeltaUsd: number;       // Gemini cost minus OpenRouter cost
  passed: boolean;            // true if parity criteria met
  evaluatedAt: string;
}
```

### Scoring rubric (0-10 per output)

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **Structural similarity** | 30% | Output format, sections, bullet structure, code formatting match expected patterns |
| **Factual accuracy** | 40% | No hallucinations, correct technical details, accurate references |
| **Instruction adherence** | 30% | Follows all constraints, addresses all parts of the prompt, appropriate tone |

### Pass criteria per sample

A sample **passes** when ALL of:
1. `geminiScore >= openRouterScore * 0.85` (85% quality parity — the `minParityScore` threshold)
2. `latencyDeltaMs <= 30000` (Gemini not more than 30s slower per request)
3. No safety filter blocks on either provider for non-malicious prompts
4. No hallucinated facts or fabricated data in Gemini output

### Gate: Overall pass rate

An agent **passes the canary gate** when:
- 100+ samples evaluated
- Pass rate >= 90% (the `minPassRate` threshold)
- Average latency degradation <= 50% (the `maxLatencyDegradationPercent`)
- No single-category pass rate below 75% (safety net per category)

If an agent fails the gate, `MigrationAdapter.fallbackToOpenRouter()` is triggered with the reason documented in `fallbackReason`.

## 5. Test Harness

### Approach A: MigrationAdapter.recordParityEval()

The `MigrationAdapter` class already provides the `recordParityEval()` method and `evaluateParity()` evaluation. The test harness can:

1. Initialize a `MigrationAdapter` instance
2. For each sample:
   a. Send the prompt to both Gemini (via `GeminiClient.generateContent()`) and OpenRouter (via existing opencode adapter)
   b. Score both outputs using the rubric above
   c. Call `adapter.recordParityEval(result)` with the `ParityEvalResult`
3. After 100+ samples, call `adapter.evaluateParity(agentId)` to get the aggregate result

### Approach B: Standalone test script

A standalone script (e.g., `src/ai/__tests__/dual-eval.test.ts`) that:
1. Reads test prompts from a fixture file (`src/ai/__tests__/fixtures/dual-eval-prompts.json`)
2. Calls both providers in parallel
3. Scores and records results
4. Outputs a summary report

Both approaches use the same `ParityEvalResult` type and scoring rubric.

### Test fixtures

Create `src/ai/__tests__/fixtures/dual-eval-prompts.json`:
```json
[
  {
    "id": "coding-001",
    "category": "coding",
    "prompt": "Write a TypeScript function that validates an ISO 27001 control ID format (A.x.y)..."
  },
  {
    "id": "analysis-001",
    "category": "analysis",
    "prompt": "Analyze these security scan results and identify the top 3 risks..."
  }
]
```

Target: 100+ prompts across all 4 categories, weighted by agent role relevance.

## 6. Agents Under Test

Per `types.ts` `AGENT_MIGRATION_STATUS`:

| Agent | Role | Current Model | Target Model | Tier |
|-------|------|---------------|--------------|------|
| CEO (53c28b5d) | CEO | openrouter/deepseek/deepseek-v4-pro | gemini-2.5-pro | leadership |
| CTO (b7079c44) | CTO | openrouter/deepseek/deepseek-v4-pro | gemini-2.5-pro | leadership |
| CISO (aad16410) | CISO | openrouter/deepseek/deepseek-v4-pro | gemini-2.5-pro | leadership |

Additional agents from the RBR-128 Phase 2 scope (CRO, CMO, VP Sales) will also need canary validation before migration.

## 7. Execution Plan

### Phase 0: Prerequisites (board-dependent)

- [ ] GEMINI_API_KEY provisioned and stored as Paperclip company secret
- [ ] GeminiClient verified working with real key
- [ ] OpenRouter baseline metrics captured (error rate, latency, cost per agent)

### Phase 1: CISO canary (already in canary per adapter config)

1. Run 100+ dual-eval samples for CISO agent
2. Evaluate parity via `MigrationAdapter.evaluateParity("aad16410")`
3. If pass → mark CISO as `migrated`
4. If fail → `fallbackToOpenRouter("aad16410", reason)` and document

### Phase 2: Leadership cohort (RBR-128)

1. Run 100+ dual-eval samples per agent (CEO, CTO, CRO, CMO, VP Sales)
2. Evaluate parity per agent
3. Pass → `completeMigration(agentId)`
4. Fail → `fallbackToOpenRouter(agentId, reason)`

### Phase 3: IC agents (future)

1. Expand to IC agents with `gemini-2.5-flash` model tier
2. Lower parity threshold acceptable for IC tier (e.g., 80% vs 90%)

## 8. Fallback Protocol

If any agent fails the canary gate:

1. `MigrationAdapter.fallbackToOpenRouter(agentId, reason)` is called
2. The agent's Paperclip `adapterConfig.command` remains `opencode-with-key.sh`
3. The `fallbackReason` is recorded in `MigrationStatus`
4. A new issue is created to investigate and remediate
5. The agent can be re-entered into canary after fixes

## 9. Reporting

Each canary evaluation produces:

1. **Per-agent parity report** — sample-level results, pass rate, latency comparison, cost comparison
2. **Aggregate summary** — overall migration status from `MigrationAdapter.getMigrationSummary()`
3. **Evidence file** — stored in `Aira-ISO27001/evidence/dual-eval-<agent>-<date>.md`

## 10. Board Dependencies

| Dependency | Owner | Status |
|------------|-------|--------|
| GEMINI_API_KEY | Board (Ben) | Not yet provisioned |
| Gemini API quota confirmation | Board (Ben) | Unknown |
| Approval to begin CISO canary | CEO | Pending key provisioning |
| Approval to begin leadership cohort | CEO | Pending Phase 1 pass |

---

## Appendix: ParityEvalResult Schema

From `src/ai/types.ts`:

```typescript
export interface ParityEvalResult {
  agentId: string;
  taskId: string;
  taskCategory: string;
  openRouterModel: string;
  geminiModel: string;
  openRouterScore: number;
  geminiScore: number;
  latencyDeltaMs: number;
  costDeltaUsd: number;
  passed: boolean;
  evaluatedAt: string;
}
```

## Appendix: FallbackThresholds Schema

```typescript
export interface FallbackThresholds {
  maxErrorRateIncrease: number;      // default: 0.05
  maxLatencyDegradationPercent: number;  // default: 50
  minParityScore: number;           // default: 0.85
  maxCostIncreasePercent: number;   // default: 30
}
```
