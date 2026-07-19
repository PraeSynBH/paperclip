import type { ContentFilterResult } from "./types.js";
import type {
  OpenAiChatRequest,
  OpenAiChatResponse,
  OpenAiMessage,
} from "./format-adapter.js";
import { FormatAdapter } from "./format-adapter.js";
import type { GeminiClient, GeminiSafetySetting } from "./gemini-client.js";
import { GeminiApiError, GeminiRateLimitError } from "./gemini-client.js";
import { ContentGuardrails } from "./guardrails.js";
import { AnomalyDetector } from "./anomaly-detector.js";
import { CostMonitor } from "./cost-monitor.js";
import { AuditLogger } from "./audit-log.js";
import { RateLimiter } from "./rate-limiter.js";
import { OutputValidator } from "./output-validator.js";
import type { ToolAuthorizationResult, AgentRole } from "./tool-auth.js";
import { ToolAuthorizer } from "./tool-auth.js";
import type { JitAccessManager } from "./jit-access.js";

export interface PipelineResult {
  response: OpenAiChatResponse;
  preFilterResult: ContentFilterResult;
  postFilterResult: ContentFilterResult | null;
  latencyMs: number;
  tokensUsed: { prompt: number; completion: number; total: number };
  providerId: string;
  modelId: string;
  fallbackUsed: boolean;
  fallbackModelId: string | null;
  toolAuthResults?: ToolAuthorizationResult[];
}

export interface PipelineConfig {
  geminiClient: GeminiClient;
  guardrails: ContentGuardrails;
  anomalyDetector?: AnomalyDetector;
  costMonitor?: CostMonitor;
  formatAdapter?: FormatAdapter;
  fallbackModel?: string;
  maxContentLengthChars?: number;
  safetySettings?: GeminiSafetySetting[];
  auditLogger?: AuditLogger;
  rateLimiter?: RateLimiter;
  outputValidator?: OutputValidator;
  toolAuthorizer?: ToolAuthorizer;
  jitAccessManager?: JitAccessManager;
}

export class PipelineBlockedError extends Error {
  constructor(
    message: string,
    public readonly preFilterResult: ContentFilterResult,
  ) {
    super(message);
    this.name = "PipelineBlockedError";
  }
}

const DEFAULT_MAX_CONTENT_LENGTH = 200000;

export class SecureAiPipeline {
  private readonly geminiClient: GeminiClient;
  private readonly guardrails: ContentGuardrails;
  private readonly anomalyDetector?: AnomalyDetector;
  private readonly costMonitor?: CostMonitor;
  private readonly formatAdapter: FormatAdapter;
  private readonly fallbackModel?: string;
  private readonly maxContentLengthChars: number;
  private readonly safetySettings: GeminiSafetySetting[];
  private readonly auditLogger?: AuditLogger;
  private readonly rateLimiter?: RateLimiter;
  private readonly outputValidator?: OutputValidator;
  private readonly toolAuthorizer?: ToolAuthorizer;
  readonly jitAccessManager?: JitAccessManager;

  constructor(config: PipelineConfig) {
    this.geminiClient = config.geminiClient;
    this.guardrails = config.guardrails;
    this.anomalyDetector = config.anomalyDetector;
    this.costMonitor = config.costMonitor;
    this.formatAdapter = config.formatAdapter ?? new FormatAdapter();
    this.fallbackModel = config.fallbackModel;
    this.maxContentLengthChars = config.maxContentLengthChars ?? DEFAULT_MAX_CONTENT_LENGTH;
    this.safetySettings = config.safetySettings ?? [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" },
    ];
    this.auditLogger = config.auditLogger;
    this.rateLimiter = config.rateLimiter;
    this.outputValidator = config.outputValidator;
    this.toolAuthorizer = config.toolAuthorizer;
    this.jitAccessManager = config.jitAccessManager;

    if (this.toolAuthorizer && this.jitAccessManager) {
      this.toolAuthorizer.setJitSessionChecker((toolName: string, agentId: string, requiredScopes?: string[]) => {
        const result = this.jitAccessManager!.checkJitAccess(
          toolName,
          agentId,
          undefined,
          requiredScopes as import("./jit-access.js").JitDataScope[] | undefined,
        );
        return {
          active: result.allowed,
          sessionId: result.sessionId,
          reason: result.reason,
        };
      });
    }
  }

  async process(
    request: OpenAiChatRequest,
    agentId: string,
    projectId: string,
    agentRole?: AgentRole,
  ): Promise<PipelineResult> {
    const startTime = Date.now();

    const promptText = this.extractPromptText(request.messages);
    const contentLength = promptText.length;
    if (contentLength > this.maxContentLengthChars) {
      this.auditLogger?.logGuardrailBlock(agentId, projectId, "cfr-length", "input", promptText.substring(0, 200));
      throw new PipelineBlockedError(
        `Content exceeds max length (${contentLength} > ${this.maxContentLengthChars})`,
        {
          allowed: false,
          blockedRule: "cfr-length",
          sanitizedContent: null,
          riskScore: 1.0,
          categories: [{ name: "Content Length", matched: true, confidence: 1.0 }],
        },
      );
    }

    if (this.rateLimiter) {
      const rateLimitResult = this.rateLimiter.allowRequest(agentId);
      if (!rateLimitResult.allowed) {
        this.auditLogger?.log("rate_limit.hit", "warn", agentId, projectId, rateLimitResult.reason ?? "Rate limit hit");
        throw new PipelineBlockedError(
          rateLimitResult.reason ?? "Rate limit exceeded",
          {
            allowed: false,
            blockedRule: "rate-limit",
            sanitizedContent: null,
            riskScore: 1.0,
            categories: [{ name: "Rate Limit", matched: true, confidence: 1.0 }],
          },
        );
      }
    }

    if (this.costMonitor && this.rateLimiter) {
      const targetModel = request.model || "gemini-2.5-pro";
      const providerKey = `google-gemini:${targetModel}`;
      const monthlySpend = this.costMonitor.getMonthlySpend("google-gemini", targetModel);
      const dailySpend = this.costMonitor.getDailySpend("google-gemini", targetModel);
      const budgetLimit = 5000;
      const dailyLimit = 250;

      if (monthlySpend >= budgetLimit) {
        this.rateLimiter.blockBudget(agentId);
        this.auditLogger?.logBudgetBlock(agentId, projectId, "google-gemini", `Monthly budget exceeded: $${monthlySpend.toFixed(2)} of $${budgetLimit}`);
        throw new PipelineBlockedError(
          `Monthly budget exceeded ($${monthlySpend.toFixed(2)} of $${budgetLimit})`,
          {
            allowed: false,
            blockedRule: "budget-monthly",
            sanitizedContent: null,
            riskScore: 1.0,
            categories: [{ name: "Budget Exceeded", matched: true, confidence: 1.0 }],
          },
        );
      }

      if (dailySpend >= dailyLimit) {
        this.auditLogger?.logBudgetBlock(agentId, projectId, "google-gemini", `Daily budget exceeded: $${dailySpend.toFixed(2)} of $${dailyLimit}`);
        throw new PipelineBlockedError(
          `Daily budget exceeded ($${dailySpend.toFixed(2)} of $${dailyLimit})`,
          {
            allowed: false,
            blockedRule: "budget-daily",
            sanitizedContent: null,
            riskScore: 1.0,
            categories: [{ name: "Daily Budget Exceeded", matched: true, confidence: 1.0 }],
          },
        );
      }
    }

    const preFilter = this.guardrails.filterPrompt(promptText, agentId, projectId);
    if (!preFilter.allowed) {
      this.auditLogger?.logGuardrailBlock(agentId, projectId, preFilter.blockedRule ?? "unknown", "input", promptText.substring(0, 200));
      throw new PipelineBlockedError(
        `Prompt blocked by guardrail: ${preFilter.blockedRule}`,
        preFilter,
      );
    }

    if (this.anomalyDetector && this.anomalyDetector.isTrained()) {
      const mlResult = this.anomalyDetector.detectWithFilter(promptText, agentId, projectId);
      if (!mlResult.allowed) {
        this.auditLogger?.logGuardrailBlock(agentId, projectId, "ml-anomaly-detection", "input", promptText.substring(0, 200));
        throw new PipelineBlockedError(
          `Prompt blocked by ML anomaly detection (score: ${mlResult.riskScore.toFixed(2)})`,
          mlResult,
        );
      }
    }

    const targetModel = request.model || "gemini-2.5-pro";

    const toolAuthResults: ToolAuthorizationResult[] = [];
    if (this.toolAuthorizer && agentRole && request.tools) {
      const toolNames = request.tools.map(t => t.function.name);
      for (const name of toolNames) {
        const authResult = this.toolAuthorizer.authorizeTool(name, agentRole, agentId);
        toolAuthResults.push(authResult);
        if (!authResult.allowed) {
          this.auditLogger?.logToolAuthorization(agentId, projectId, name, "denied", authResult.reason ?? undefined);
        } else if (authResult.requiresApproval) {
          this.auditLogger?.logToolAuthorization(agentId, projectId, name, "requires_approval");
        }
      }
    }

    const { sanitizedMessages } = this.guardrails.sanitizeMessages(request.messages);
    const sanitizedPromptText = this.extractPromptText(sanitizedMessages);

    const { contents, systemInstruction } = this.formatAdapter.openAiToGemini(
      sanitizedMessages,
    );

    const tools = this.formatAdapter.openAiToolsToGemini(request.tools);

    this.auditLogger?.logGeminiRequest(
      agentId,
      projectId,
      targetModel,
      sanitizedPromptText,
      request.tools?.map(t => t.function.name),
    );

    try {
      const geminiResponse = await this.geminiClient.generateContent(targetModel, {
        contents,
        systemInstruction,
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          topP: request.top_p ?? 0.95,
          maxOutputTokens: request.max_tokens ?? 32768,
          stopSequences: request.stop,
        },
        safetySettings: this.safetySettings,
        tools,
      });

      const openAiResponse = this.formatAdapter.geminiToOpenAi(geminiResponse, targetModel);
      const initialResponseText = this.extractResponseText(openAiResponse);
      let finalResponseText = initialResponseText;

      if (this.outputValidator) {
        const outputValidation = this.outputValidator.validate(initialResponseText, agentId, projectId);
        if (!outputValidation.allowed) {
          this.auditLogger?.logOutputValidation(agentId, projectId, "failed", outputValidation.findings.map(f => f.description));
          return {
            response: this.formatAdapter.geminiBlockedToOpenAi(
              outputValidation.findings.map(f => f.description).join("; ") || "output_validation",
              targetModel,
            ),
            preFilterResult: preFilter,
            postFilterResult: {
              allowed: false,
              blockedRule: "output-validator",
              sanitizedContent: null,
              riskScore: 1.0,
              categories: outputValidation.findings.map(f => ({ name: f.type, matched: true, confidence: 1.0 })),
            },
            latencyMs: Date.now() - startTime,
            tokensUsed: { prompt: 0, completion: 0, total: 0 },
            providerId: "google-gemini",
            modelId: targetModel,
            fallbackUsed: false,
            fallbackModelId: null,
            toolAuthResults: toolAuthResults.length > 0 ? toolAuthResults : undefined,
          };
        }

        if (outputValidation.sanitizedContent) {
          finalResponseText = outputValidation.sanitizedContent;
          openAiResponse.choices[0].message.content = finalResponseText;
        }
      }

      this.auditLogger?.logGeminiResponse(
        agentId,
        projectId,
        targetModel,
        finalResponseText,
        geminiResponse.usageMetadata
          ? { prompt: geminiResponse.usageMetadata.promptTokenCount, completion: geminiResponse.usageMetadata.candidatesTokenCount, total: geminiResponse.usageMetadata.totalTokenCount }
          : undefined,
        Date.now() - startTime,
      );

      const postFilter = this.guardrails.filterResponse(finalResponseText, agentId, projectId);

      if (postFilter.sanitizedContent !== null) {
        openAiResponse.choices[0].message.content = postFilter.sanitizedContent;
      }

      if (!postFilter.allowed) {
        return {
          response: this.formatAdapter.geminiBlockedToOpenAi(
            postFilter.blockedRule ?? "content_filter",
            targetModel,
          ),
          preFilterResult: preFilter,
          postFilterResult: postFilter,
          latencyMs: Date.now() - startTime,
          tokensUsed: { prompt: 0, completion: 0, total: 0 },
          providerId: "google-gemini",
          modelId: targetModel,
          fallbackUsed: false,
          fallbackModelId: null,
          toolAuthResults: toolAuthResults.length > 0 ? toolAuthResults : undefined,
        };
      }

      const usage = geminiResponse.usageMetadata;

      if (this.costMonitor) {
        const costEstimate = this.estimateCost(targetModel, usage?.promptTokenCount ?? 0, usage?.candidatesTokenCount ?? 0);
        this.costMonitor.trackUsage({
          providerId: "google-gemini",
          modelId: targetModel,
          agentId,
          projectId,
          tokensIn: usage?.promptTokenCount ?? 0,
          tokensOut: usage?.candidatesTokenCount ?? 0,
          costUsd: costEstimate,
          requestCount: 1,
          errorCount: 0,
          latencyMsAvg: Date.now() - startTime,
          windowStart: new Date(startTime).toISOString(),
          windowEnd: new Date().toISOString(),
        });

        const alert = this.costMonitor.checkAlerts("google-gemini", targetModel);
        if (alert) {
          this.auditLogger?.logBudgetAlert(
            agentId, projectId, alert.providerId, alert.threshold, alert.currentSpend, alert.budgetLimit,
          );
        }
      }

      return {
        response: openAiResponse,
        preFilterResult: preFilter,
        postFilterResult: postFilter,
        latencyMs: Date.now() - startTime,
        tokensUsed: {
          prompt: usage?.promptTokenCount ?? 0,
          completion: usage?.candidatesTokenCount ?? 0,
          total: usage?.totalTokenCount ?? 0,
        },
        providerId: "google-gemini",
        modelId: targetModel,
        fallbackUsed: false,
        fallbackModelId: null,
        toolAuthResults: toolAuthResults.length > 0 ? toolAuthResults : undefined,
      };
    } catch (error) {
      if (error instanceof GeminiApiError) {
        this.auditLogger?.logGeminiError(
          agentId, projectId, targetModel, error.message, error.status,
        );
      }

      if (error instanceof GeminiApiError && error.message.includes("safety filter blocked")) {
        return {
          response: this.formatAdapter.geminiBlockedToOpenAi("gemini_safety_filter", targetModel),
          preFilterResult: preFilter,
          postFilterResult: {
            allowed: false,
            blockedRule: "gemini-safety",
            sanitizedContent: null,
            riskScore: 1.0,
            categories: [{ name: "Gemini Safety Filter", matched: true, confidence: 1.0 }],
          },
          latencyMs: Date.now() - startTime,
          tokensUsed: { prompt: 0, completion: 0, total: 0 },
          providerId: "google-gemini",
          modelId: targetModel,
          fallbackUsed: false,
          fallbackModelId: null,
          toolAuthResults: toolAuthResults.length > 0 ? toolAuthResults : undefined,
        };
      }

      if (error instanceof GeminiApiError || error instanceof GeminiRateLimitError) {
        if (this.costMonitor) {
          this.costMonitor.trackUsage({
            providerId: "google-gemini",
            modelId: targetModel,
            agentId,
            projectId,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            requestCount: 0,
            errorCount: 1,
            latencyMsAvg: Date.now() - startTime,
            windowStart: new Date(startTime).toISOString(),
            windowEnd: new Date().toISOString(),
          });
        }
      }

      throw error;
    }
  }

  private extractPromptText(messages: OpenAiMessage[]): string {
    return messages.map(m => {
      if (m.role === "tool" && m.content) {
        return `[tool:${m.name ?? "unknown"}]: ${m.content}`;
      }
      if (m.tool_calls) {
        const calls = m.tool_calls.map(tc => `[call:${tc.function.name}(${tc.function.arguments})]`).join(" ");
        return `${m.role}: ${m.content ?? calls}`;
      }
      return `${m.role}: ${m.content ?? ""}`;
    }).join("\n");
  }

  private extractResponseText(response: OpenAiChatResponse): string {
    return response.choices
      .map(c => c.message.content ?? JSON.stringify(c.message.tool_calls ?? []))
      .join("\n");
  }

  private estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    const rates: Record<string, { prompt: number; completion: number }> = {
      "gemini-2.5-pro": { prompt: 1.25, completion: 10.00 },
      "gemini-2.5-flash": { prompt: 0.15, completion: 0.60 },
    };

    const rate = rates[model] ?? { prompt: 0, completion: 0 };
    const costPerMillion = (rate.prompt * promptTokens + rate.completion * completionTokens) / 1_000_000;
    return Math.round(costPerMillion * 100) / 100;
  }
}
