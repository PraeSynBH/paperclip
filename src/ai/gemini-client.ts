import { config, loadConfig } from "../config.js";
import { resolveSafetySettings } from "./safety-settings.js";
import type { GeminiSafetySetting } from "./safety-settings.js";

export type {
  GeminiSafetySetting,
  GeminiHarmCategory,
  GeminiHarmBlockThreshold,
} from "./safety-settings.js";

export interface GeminiGenerateRequest {
  model: string;
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    candidateCount?: number;
  };
  safetySettings?: GeminiSafetySetting[];
  tools?: GeminiTool[];
}

export interface GeminiContent {
  role?: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}


export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiGenerateResponse {
  candidates: GeminiCandidate[];
  promptFeedback?: GeminiPromptFeedback;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  safetyRatings?: GeminiSafetyRating[];
  index?: number;
}

export interface GeminiPromptFeedback {
  blockReason?: string;
  safetyRatings?: GeminiSafetyRating[];
}

export interface GeminiSafetyRating {
  category: string;
  probability: string;
  blocked: boolean;
}

export class GeminiApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

export class GeminiRateLimitError extends GeminiApiError {
  constructor(
    message: string,
    public readonly retryAfterMs: number = 60000,
  ) {
    super(message, 429, null, true);
    this.name = "GeminiRateLimitError";
  }
}

export interface GeminiClientConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const API_VERSION = "v1beta";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 30000;
const DEFAULT_TIMEOUT_MS = 120000;
const JITTER_FACTOR = 0.3;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class GeminiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly timeoutMs: number;

  constructor(clientConfig: GeminiClientConfig) {
    this.apiKey = clientConfig.apiKey;
    this.baseUrl = clientConfig.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = clientConfig.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = clientConfig.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = clientConfig.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.timeoutMs = clientConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!this.apiKey) {
      throw new GeminiApiError("GEMINI_API_KEY is required. Set it via environment variable or AWS Secrets Manager.", 401, null, false);
    }

    this.baseUrl = this.baseUrl.replace(/\/$/, "");
  }

  async generateContent(
    model: string,
    request: Partial<GeminiGenerateRequest> & { contents: GeminiContent[] },
  ): Promise<GeminiGenerateResponse> {
    const url = `${this.baseUrl}/models/${model}:generateContent`;

    const body: GeminiGenerateRequest = {
      model,
      contents: request.contents,
      systemInstruction: request.systemInstruction,
      generationConfig: request.generationConfig ?? {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 32768,
      },
      // GL-F9: no duplicate safety defaults here. Callers (normally SecureAiPipeline)
      // own the policy; this only fills any category the caller left unset and
      // enforces the strictness floor, so a partial list can never disable a filter.
      safetySettings: resolveSafetySettings({ overrides: request.safetySettings }),
      tools: request.tools,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => null);
          const retryable = RETRYABLE_STATUSES.has(response.status);

          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
            throw new GeminiRateLimitError(`Gemini API rate limited`, retryAfterMs);
          }

          if (response.status === 400) {
            const isSafetyBlock = errorBody?.includes("SAFETY") || errorBody?.includes("safety");
            throw new GeminiApiError(
              isSafetyBlock ? "Gemini safety filter blocked the request" : `Gemini API error: ${response.status}`,
              response.status,
              errorBody,
              false,
            );
          }

          throw new GeminiApiError(`Gemini API error: ${response.status}`, response.status, errorBody, retryable);
        }

        const data = (await response.json()) as GeminiGenerateResponse;

        if (data.promptFeedback?.blockReason) {
          throw new GeminiApiError(
            `Gemini prompt blocked: ${data.promptFeedback.blockReason}`,
            400,
            data,
            false,
          );
        }

        if (!data.candidates || data.candidates.length === 0) {
          throw new GeminiApiError("Gemini returned no candidates", 200, data, true);
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof GeminiApiError && !error.retryable) {
          throw error;
        }

        if (error instanceof GeminiRateLimitError) {
          if (attempt < this.maxRetries) {
            const delay = Math.min(error.retryAfterMs, this.retryMaxDelayMs);
            await this.sleep(delay);
            continue;
          }
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          if (attempt < this.maxRetries) {
            const delay = Math.min(this.retryBaseDelayMs * Math.pow(2, attempt), this.retryMaxDelayMs);
            const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1);
            await this.sleep(delay + jitter);
            continue;
          }
          throw new GeminiApiError(`Gemini API timeout after ${this.maxRetries + 1} attempts`, 408, null, false);
        }

        if (attempt < this.maxRetries) {
          const delay = Math.min(this.retryBaseDelayMs * Math.pow(2, attempt), this.retryMaxDelayMs);
          const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1);
          await this.sleep(delay + jitter);
          continue;
        }
      }
    }

    throw new GeminiApiError(
      `Gemini API failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
      500,
      null,
      false,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let cachedClient: GeminiClient | null = null;

export async function createGeminiClient(): Promise<GeminiClient> {
  if (cachedClient) return cachedClient;

  const cfg = await loadConfig();
  cachedClient = new GeminiClient({
    apiKey: cfg.googleAi.apiKey,
    baseUrl: cfg.googleAi.baseUrl,
  });

  return cachedClient;
}

export function getCachedGeminiClient(): GeminiClient | null {
  return cachedClient;
}