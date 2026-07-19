import type { GeminiContent, GeminiPart, GeminiGenerateResponse, GeminiTool, GeminiFunctionDeclaration } from "./gemini-client.js";

export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: OpenAiTool[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAiChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAiChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAiChoice {
  index: number;
  message: OpenAiMessage;
  finish_reason: string | null;
}

export class FormatAdapter {
  openAiToGemini(messages: OpenAiMessage[], systemInstruction?: string): {
    contents: GeminiContent[];
    systemInstruction?: GeminiContent;
  } {
    const systemMessages: string[] = [];
    const geminiContents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        if (msg.content) systemMessages.push(msg.content);
        continue;
      }

      const parts = this.openAiMessageToGeminiParts(msg);
      if (parts.length === 0) continue;

      const role = msg.role === "assistant" ? "model" as const : "user" as const;
      geminiContents.push({ role, parts });
    }

    const sysText = systemInstruction ?? systemMessages.join("\n\n");

    return {
      contents: geminiContents,
      systemInstruction: sysText ? { parts: [{ text: sysText }] } : undefined,
    };
  }

  geminiToOpenAi(
    geminiResponse: GeminiGenerateResponse,
    model: string,
  ): OpenAiChatResponse {
    const candidate = geminiResponse.candidates[0];
    const message: OpenAiMessage = {
      role: "assistant",
      content: null,
      tool_calls: [],
    };

    const textParts: string[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ("text" in part && part.text) {
          textParts.push(part.text);
        }
        if (part.functionCall) {
          message.tool_calls = message.tool_calls ?? [];
          message.tool_calls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          });
        }
      }
    }

    if (textParts.length > 0) {
      message.content = textParts.join("\n");
    }

    if (message.tool_calls && message.tool_calls.length === 0) {
      delete message.tool_calls;
    }

    return {
      id: `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: candidate?.index ?? 0,
          message,
          finish_reason: this.mapFinishReason(candidate?.finishReason),
        },
      ],
      usage: geminiResponse.usageMetadata
        ? {
            prompt_tokens: geminiResponse.usageMetadata.promptTokenCount,
            completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount,
            total_tokens: geminiResponse.usageMetadata.totalTokenCount,
          }
        : undefined,
    };
  }

  geminiBlockedToOpenAi(
    blockReason: string,
    model: string,
  ): OpenAiChatResponse {
    return {
      id: `chatcmpl-blocked-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          finish_reason: "content_filter",
          message: {
            role: "assistant",
            content: `[BLOCKED by content filter: ${blockReason}]`,
          },
        },
      ],
    };
  }

  openAiToolsToGemini(tools?: OpenAiTool[]): GeminiTool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    const functionDeclarations: GeminiFunctionDeclaration[] = [];
    for (const tool of tools) {
      if (tool.type === "function") {
        functionDeclarations.push({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        });
      }
    }

    if (functionDeclarations.length === 0) return undefined;

    return [{
      functionDeclarations,
    }];
  }

  private openAiMessageToGeminiParts(msg: OpenAiMessage): GeminiPart[] {
    const parts: GeminiPart[] = [];

    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.type === "function") {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { _raw: tc.function.arguments };
          }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
      }
    }

    if (msg.role === "tool" && msg.tool_call_id) {
      let response: Record<string, unknown> = {};
      if (msg.content) {
        try {
          response = JSON.parse(msg.content);
        } catch {
          response = { content: msg.content };
        }
      }
      parts.push({
        functionResponse: { name: msg.name ?? "unknown", response },
      });
    }

    return parts;
  }

  private mapFinishReason(googleReason?: string): string | null {
    if (!googleReason) return null;

    const reasonMap: Record<string, string> = {
      "STOP": "stop",
      "MAX_TOKENS": "length",
      "SAFETY": "content_filter",
      "RECITATION": "content_filter",
      "MALFORMED_FUNCTION_CALL": "tool_calls",
      "OTHER": "stop",
    };

    return reasonMap[googleReason] ?? null;
  }
}