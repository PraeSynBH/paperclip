import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HARM_CATEGORIES,
  API_SUPPORTED_HARM_CATEGORIES,
  DEFAULT_SAFETY_THRESHOLD,
  MINIMUM_SAFETY_THRESHOLD,
  DEFAULT_SAFETY_CONFIG,
  DEFAULT_SAFETY_SETTINGS,
  STRICT_SAFETY_SETTINGS,
  isHarmCategory,
  isBlockThreshold,
  isAtLeastAsStrict,
  strictestThreshold,
  resolveSafetySettings,
  resolveSafetySettingsDetailed,
  type AiSafetyConfig,
} from "../safety-settings.js";
import { SecureAiPipeline } from "../pipeline.js";
import { ContentGuardrails } from "../guardrails.js";
import { GeminiClient } from "../gemini-client.js";
import { AiGovernanceEngine, DEFAULT_GOVERNANCE_CONFIG } from "../governance.js";

function thresholdFor(settings: { category: string; threshold: string }[], category: string) {
  return settings.find(s => s.category === category)?.threshold;
}

/** Captures the request body sent to the Gemini API without doing real network I/O. */
function createCapturingGeminiClient() {
  const client = new GeminiClient({ apiKey: "test-key" });
  const originalFetch = globalThis.fetch;
  const captured: Record<string, unknown>[] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    captured.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
      }),
      text: async () => "",
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  return { client, captured, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("GL-F9 safety settings (RBR-135)", () => {
  describe("canonical policy", () => {
    it("declares the four standard categories plus the two previously missing ones", () => {
      assert.deepEqual([...HARM_CATEGORIES], [
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
        "HARM_CATEGORY_CIVIC_INTEGRITY",
        "HARM_CATEGORY_HARASSMENT_SEXUAL",
      ]);
    });

    it("standardizes every declared category on BLOCK_MEDIUM_AND_ABOVE", () => {
      assert.equal(DEFAULT_SAFETY_THRESHOLD, "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(DEFAULT_SAFETY_SETTINGS.length, HARM_CATEGORIES.length);
      for (const setting of DEFAULT_SAFETY_SETTINGS) {
        assert.equal(setting.threshold, "BLOCK_MEDIUM_AND_ABOVE", `category ${setting.category}`);
      }
    });

    it("exposes a stricter preset for regulated projects", () => {
      for (const setting of STRICT_SAFETY_SETTINGS) {
        assert.ok(isAtLeastAsStrict(setting.threshold, MINIMUM_SAFETY_THRESHOLD));
      }
    });

    it("recognises declared categories and valid thresholds", () => {
      assert.ok(isHarmCategory("HARM_CATEGORY_CIVIC_INTEGRITY"));
      assert.ok(isHarmCategory("HARM_CATEGORY_HARASSMENT_SEXUAL"));
      assert.ok(!isHarmCategory("HARM_CATEGORY_NOT_REAL"));
      assert.ok(isBlockThreshold("BLOCK_MEDIUM_AND_ABOVE"));
      assert.ok(!isBlockThreshold("BLOCK_SOMETIMES"));
    });

    it("ranks strictness with BLOCK_NONE as weakest", () => {
      assert.equal(strictestThreshold("BLOCK_LOW_AND_ABOVE", "BLOCK_ONLY_HIGH"), "BLOCK_LOW_AND_ABOVE");
      assert.equal(strictestThreshold("BLOCK_NONE", "BLOCK_MEDIUM_AND_ABOVE"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.ok(isAtLeastAsStrict("BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE"));
      assert.ok(!isAtLeastAsStrict("BLOCK_ONLY_HIGH", "BLOCK_MEDIUM_AND_ABOVE"));
    });
  });

  describe("resolution", () => {
    it("returns every declared category by default", () => {
      const { declared } = resolveSafetySettingsDetailed();
      assert.equal(declared.length, HARM_CATEGORIES.length);
      for (const category of HARM_CATEGORIES) {
        assert.equal(thresholdFor(declared, category), "BLOCK_MEDIUM_AND_ABOVE");
      }
    });

    it("drops declared categories the API enum does not accept, keeping them in the policy", () => {
      const { declared, settings, droppedCategories } = resolveSafetySettingsDetailed();
      assert.ok(declared.some(s => s.category === "HARM_CATEGORY_HARASSMENT_SEXUAL"));
      assert.deepEqual(droppedCategories, ["HARM_CATEGORY_HARASSMENT_SEXUAL"]);
      for (const setting of settings) {
        assert.ok(API_SUPPORTED_HARM_CATEGORIES.has(setting.category));
      }
      assert.ok(settings.some(s => s.category === "HARM_CATEGORY_CIVIC_INTEGRITY"));
    });

    it("fills unspecified categories when only a partial override is supplied", () => {
      const settings = resolveSafetySettings({
        overrides: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_LOW_AND_ABOVE" }],
      });
      assert.equal(thresholdFor(settings, "HARM_CATEGORY_HATE_SPEECH"), "BLOCK_LOW_AND_ABOVE");
      assert.equal(thresholdFor(settings, "HARM_CATEGORY_DANGEROUS_CONTENT"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(thresholdFor(settings, "HARM_CATEGORY_CIVIC_INTEGRITY"), "BLOCK_MEDIUM_AND_ABOVE");
    });

    it("clamps weaker overrides back to the policy floor and reports a violation", () => {
      const result = resolveSafetySettingsDetailed({
        overrides: [
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      });
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_DANGEROUS_CONTENT"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_HARASSMENT"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(result.violations.length, 2);
      assert.deepEqual(
        result.violations.map(v => v.requested).sort(),
        ["BLOCK_NONE", "BLOCK_ONLY_HIGH"],
      );
    });

    it("accepts stricter overrides without a violation", () => {
      const result = resolveSafetySettingsDetailed({
        overrides: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" }],
      });
      assert.equal(result.violations.length, 0);
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_SEXUALLY_EXPLICIT"), "BLOCK_LOW_AND_ABOVE");
    });

    it("ignores unknown thresholds instead of weakening the policy", () => {
      const result = resolveSafetySettingsDetailed({
        overrides: [
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MAYBE" as never },
        ],
      });
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_HATE_SPEECH"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(result.violations.length, 1);
      assert.match(result.violations[0].reason, /unknown threshold/);
    });
  });

  describe("per-project configuration", () => {
    const config: AiSafetyConfig = {
      ...DEFAULT_SAFETY_CONFIG,
      projectOverrides: {
        "regulated-project": {
          categoryThresholds: {
            HARM_CATEGORY_DANGEROUS_CONTENT: "BLOCK_LOW_AND_ABOVE",
            HARM_CATEGORY_CIVIC_INTEGRITY: "BLOCK_LOW_AND_ABOVE",
          },
          justification: "Handles regulated ISO 27001 audit evidence",
          approvedBy: "CISO",
        },
        "loosened-project": {
          categoryThresholds: { HARM_CATEGORY_HARASSMENT: "BLOCK_NONE" },
          justification: "Attempted relaxation",
          approvedBy: "unknown",
        },
        "expired-project": {
          categoryThresholds: { HARM_CATEGORY_SEXUALLY_EXPLICIT: "BLOCK_LOW_AND_ABOVE" },
          justification: "Temporary exception",
          approvedBy: "CISO",
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      },
    };

    it("applies a stricter per-project override", () => {
      const result = resolveSafetySettingsDetailed({ config, projectId: "regulated-project" });
      assert.equal(result.appliedProjectOverride, "regulated-project");
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_DANGEROUS_CONTENT"), "BLOCK_LOW_AND_ABOVE");
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_CIVIC_INTEGRITY"), "BLOCK_LOW_AND_ABOVE");
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_HATE_SPEECH"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(result.violations.length, 0);
    });

    it("refuses a per-project override that would weaken filtering", () => {
      const result = resolveSafetySettingsDetailed({ config, projectId: "loosened-project" });
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_HARASSMENT"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(result.violations.length, 1);
      assert.match(result.violations[0].reason, /clamped/);
    });

    it("ignores expired project overrides", () => {
      const result = resolveSafetySettingsDetailed({ config, projectId: "expired-project" });
      assert.equal(result.appliedProjectOverride, null);
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_SEXUALLY_EXPLICIT"), "BLOCK_MEDIUM_AND_ABOVE");
    });

    it("falls back to defaults for an unknown project", () => {
      const result = resolveSafetySettingsDetailed({ config, projectId: "no-such-project" });
      assert.equal(result.appliedProjectOverride, null);
      assert.equal(thresholdFor(result.settings, "HARM_CATEGORY_DANGEROUS_CONTENT"), "BLOCK_MEDIUM_AND_ABOVE");
    });
  });

  describe("GeminiClient has no duplicate defaults", () => {
    it("sends the canonical policy when the caller supplies no safety settings", async () => {
      const { client, captured, restore } = createCapturingGeminiClient();
      try {
        await client.generateContent("gemini-2.5-pro", {
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
        });
      } finally {
        restore();
      }

      const sent = captured[0].safetySettings as { category: string; threshold: string }[];
      assert.equal(sent.length, API_SUPPORTED_HARM_CATEGORIES.size);
      for (const setting of sent) {
        assert.equal(setting.threshold, "BLOCK_MEDIUM_AND_ABOVE", `category ${setting.category}`);
      }
      assert.ok(sent.some(s => s.category === "HARM_CATEGORY_CIVIC_INTEGRITY"));
    });

    it("never lets a caller drop below the floor", async () => {
      const { client, captured, restore } = createCapturingGeminiClient();
      try {
        await client.generateContent("gemini-2.5-pro", {
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
          safetySettings: [{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }],
        });
      } finally {
        restore();
      }

      const sent = captured[0].safetySettings as { category: string; threshold: string }[];
      assert.equal(thresholdFor(sent, "HARM_CATEGORY_HATE_SPEECH"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(sent.length, API_SUPPORTED_HARM_CATEGORIES.size);
    });
  });

  describe("pipeline integration", () => {
    it("sends governance-resolved settings on the wire", async () => {
      const { client, captured, restore } = createCapturingGeminiClient();
      const pipeline = new SecureAiPipeline({
        geminiClient: client,
        guardrails: new ContentGuardrails(),
        safetyConfig: {
          ...DEFAULT_SAFETY_CONFIG,
          projectOverrides: {
            "proj-strict": {
              categoryThresholds: { HARM_CATEGORY_DANGEROUS_CONTENT: "BLOCK_LOW_AND_ABOVE" },
              justification: "regulated",
              approvedBy: "CISO",
            },
          },
        },
      });

      try {
        await pipeline.process(
          { model: "gemini-2.5-pro", messages: [{ role: "user", content: "Summarize ISO 27001 clause 5." }] },
          "agent-1",
          "proj-strict",
        );
      } finally {
        restore();
      }

      const sent = captured[0].safetySettings as { category: string; threshold: string }[];
      assert.equal(thresholdFor(sent, "HARM_CATEGORY_DANGEROUS_CONTENT"), "BLOCK_LOW_AND_ABOVE");
      assert.equal(thresholdFor(sent, "HARM_CATEGORY_HARASSMENT"), "BLOCK_MEDIUM_AND_ABOVE");
      assert.equal(thresholdFor(sent, "HARM_CATEGORY_CIVIC_INTEGRITY"), "BLOCK_MEDIUM_AND_ABOVE");
    });

    it("exposes effective settings for audit without hardcoded pipeline defaults", () => {
      const pipeline = new SecureAiPipeline({
        geminiClient: new GeminiClient({ apiKey: "test-key" }),
        guardrails: new ContentGuardrails(),
      });
      const settings = pipeline.getEffectiveSafetySettings("any-project");
      assert.equal(settings.length, API_SUPPORTED_HARM_CATEGORIES.size);
      for (const setting of settings) {
        assert.equal(setting.threshold, "BLOCK_MEDIUM_AND_ABOVE");
      }
    });
  });

  describe("governance config wiring", () => {
    it("carries a safety config in DEFAULT_GOVERNANCE_CONFIG", () => {
      assert.ok(DEFAULT_GOVERNANCE_CONFIG.safetyConfig);
      assert.equal(DEFAULT_GOVERNANCE_CONFIG.safetyConfig?.minimumThreshold, "BLOCK_MEDIUM_AND_ABOVE");
    });

    it("resolves safety settings through the governance engine", () => {
      const engine = new AiGovernanceEngine(DEFAULT_GOVERNANCE_CONFIG, new GeminiClient({ apiKey: "test-key" }));
      const resolution = engine.getSafetySettings("some-project");
      assert.equal(resolution.declared.length, HARM_CATEGORIES.length);
      assert.equal(resolution.violations.length, 0);
    });
  });
});
