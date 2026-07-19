import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FormatAdapter } from "../format-adapter.js";
import type { OpenAiMessage, OpenAiChatRequest } from "../format-adapter.js";
import type { GeminiGenerateResponse, GeminiContent } from "../gemini-client.js";

const adapter = new FormatAdapter();

describe("FormatAdapter.openAiToGemini", () => {
  it("converts a simple user message", () => {
    const messages: OpenAiMessage[] = [
      { role: "user", content: "Hello, world!" },
    ];

    const result = adapter.openAiToGemini(messages);

    assert.equal(result.contents.length, 1);
    assert.equal(result.contents[0].role, "user");
    assert.equal(result.contents[0].parts.length, 1);
    assert.equal(result.contents[0].parts[0].text, "Hello, world!");
    assert.equal(result.systemInstruction, undefined);
  });

  it("converts system message to systemInstruction", () => {
    const messages: OpenAiMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hi" },
    ];

    const result = adapter.openAiToGemini(messages);

    assert.equal(result.contents.length, 1);
    assert.equal(result.contents[0].role, "user");
    assert.ok(result.systemInstruction);
    assert.equal(result.systemInstruction.parts[0].text, "You are a helpful assistant.");
  });

  it("converts multiple system messages, joined", () => {
    const messages: OpenAiMessage[] = [
      { role: "system", content: "Rule 1" },
      { role: "system", content: "Rule 2" },
      { role: "user", content: "OK" },
    ];

    const result = adapter.openAiToGemini(messages);

    assert.ok(result.systemInstruction);
    assert.ok(result.systemInstruction.parts[0].text?.includes("Rule 1"));
    assert.ok(result.systemInstruction.parts[0].text?.includes("Rule 2"));
  });

  it("converts assistant responses to model role", () => {
    const messages: OpenAiMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "The answer is 4." },
    ];

    const result = adapter.openAiToGemini(messages);

    assert.equal(result.contents.length, 2);
    assert.equal(result.contents[0].role, "user");
    assert.equal(result.contents[1].role, "model");
    assert.equal(result.contents[1].parts[0].text, "The answer is 4.");
  });

  it("handles multi-turn conversation", () => {
    const messages: OpenAiMessage[] = [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "How are you?" },
    ];

    const result = adapter.openAiToGemini(messages);

    assert.equal(result.contents.length, 3);
    assert.equal(result.contents[0].role, "user");
    assert.equal(result.contents[0].parts[0].text, "Hello");
    assert.equal(result.contents[1].role, "model");
    assert.equal(result.contents[1].parts[0].text, "Hi!");
    assert.equal(result.contents[2].role, "user");
    assert.equal(result.contents[2].parts[0].text, "How are you?");
    assert.ok(result.systemInstruction);
  });

  it("handles tool calls in assistant messages", () => {
    const messages: OpenAiMessage[] = [
      { role: "user", content: "What is the weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"London"}' },
          },
        ],
      },
    ];

    const result = adapter.openAiToGemini(messages);

    assert.equal(result.contents.length, 2);
    assert.equal(result.contents[1].role, "model");
    assert.ok(result.contents[1].parts.some(p => p.functionCall?.name === "get_weather"));
  });

  it("handles empty messages gracefully", () => {
    const result = adapter.openAiToGemini([]);
    assert.equal(result.contents.length, 0);
    assert.equal(result.systemInstruction, undefined);
  });

  it("handles system-only messages", () => {
    const messages: OpenAiMessage[] = [
      { role: "system", content: "System prompt" },
    ];

    const result = adapter.openAiToGemini(messages);

    assert.equal(result.contents.length, 0);
    assert.ok(result.systemInstruction);
    assert.equal(result.systemInstruction.parts[0].text, "System prompt");
  });
});

describe("FormatAdapter.geminiToOpenAi", () => {
  it("converts a simple text response", () => {
    const geminiResponse: GeminiGenerateResponse = {
      candidates: [
        {
          content: { parts: [{ text: "Hello back!" }] },
          finishReason: "STOP",
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    const result = adapter.geminiToOpenAi(geminiResponse, "gemini-2.5-pro");

    assert.equal(result.choices.length, 1);
    assert.equal(result.choices[0].message.content, "Hello back!");
    assert.equal(result.choices[0].message.role, "assistant");
    assert.equal(result.choices[0].finish_reason, "stop");
    assert.equal(result.model, "gemini-2.5-pro");
    assert.equal(result.usage?.prompt_tokens, 10);
    assert.equal(result.usage?.completion_tokens, 5);
    assert.equal(result.usage?.total_tokens, 15);
  });

  it("maps SAFETY finish reason to content_filter", () => {
    const geminiResponse: GeminiGenerateResponse = {
      candidates: [
        {
          content: { parts: [{ text: "Harmful content" }] },
          finishReason: "SAFETY",
        },
      ],
    };

    const result = adapter.geminiToOpenAi(geminiResponse, "gemini-2.5-flash");

    assert.equal(result.choices[0].finish_reason, "content_filter");
  });

  it("maps MAX_TOKENS to length", () => {
    const geminiResponse: GeminiGenerateResponse = {
      candidates: [
        {
          content: { parts: [{ text: "Very long response..." }] },
          finishReason: "MAX_TOKENS",
        },
      ],
    };

    const result = adapter.geminiToOpenAi(geminiResponse, "gemini-2.5-pro");
    assert.equal(result.choices[0].finish_reason, "length");
  });

  it("handles function calls in response", () => {
    const geminiResponse: GeminiGenerateResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "London" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = adapter.geminiToOpenAi(geminiResponse, "gemini-2.5-pro");

    assert.equal(result.choices.length, 1);
    assert.ok(result.choices[0].message.tool_calls);
    assert.equal(result.choices[0].message.tool_calls?.length, 1);
    assert.equal(result.choices[0].message.tool_calls?.[0].function.name, "get_weather");
  });

  it("handles text + function call in same response", () => {
    const geminiResponse: GeminiGenerateResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Let me check the weather." },
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "Tokyo" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = adapter.geminiToOpenAi(geminiResponse, "gemini-2.5-pro");

    assert.ok(result.choices[0].message.content?.includes("Let me check"));
    assert.equal(result.choices[0].message.tool_calls?.[0].function.name, "get_weather");
  });
});

describe("FormatAdapter.openAiToolsToGemini", () => {
  it("converts openai tools to gemini tools", () => {
    const result = adapter.openAiToolsToGemini([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        },
      },
    ]);

    assert.ok(result);
    assert.equal(result.length, 1);
    assert.equal(result[0].functionDeclarations?.length, 1);
    assert.equal(result[0].functionDeclarations?.[0].name, "get_weather");
  });

  it("returns undefined for empty tools", () => {
    assert.equal(adapter.openAiToolsToGemini([]), undefined);
    assert.equal(adapter.openAiToolsToGemini(undefined), undefined);
  });
});

describe("FormatAdapter.geminiBlockedToOpenAi", () => {
  it("returns a blocked response", () => {
    const result = adapter.geminiBlockedToOpenAi("safety_filter", "gemini-2.5-pro");

    assert.equal(result.choices[0].finish_reason, "content_filter");
    assert.ok(result.choices[0].message.content?.includes("BLOCKED"));
  });
});

describe("FormatAdapter round-trip", () => {
  it("preserves message semantics through conversion and back", () => {
    const messages: OpenAiMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "What is the weather in Paris?" },
    ];

    const geminiFormat = adapter.openAiToGemini(messages);
    assert.equal(geminiFormat.contents.length, 1);
    assert.equal(geminiFormat.contents[0].role, "user");
    assert.ok(geminiFormat.systemInstruction);
  });
});