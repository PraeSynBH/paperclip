import { describe, expect, it } from "vitest";
import { buildKnowledgePreamble, buildMemoryPreamble } from "./memory-context-injection.js";
import type { MemorySnippet } from "@paperclipai/shared";

describe("buildKnowledgePreamble", () => {
  it("returns empty string for empty articles", () => {
    expect(buildKnowledgePreamble([])).toBe("");
  });

  it("formats a single article", () => {
    const result = buildKnowledgePreamble([
      {
        id: "doc-1",
        title: "Deployment Guide",
        summary: "How to deploy the application",
        body: "Step 1: Build the Docker image.\nStep 2: Push to registry.\nStep 3: Deploy.",
      },
    ]);

    expect(result).toContain("=== Company Knowledge ===");
    expect(result).toContain("Deployment Guide");
    expect(result).toContain("How to deploy the application");
    expect(result).toContain("Step 1: Build the Docker image");
    expect(result).toContain("=== End Company Knowledge ===");
  });

  it("includes relevance scores when provided", () => {
    const result = buildKnowledgePreamble([
      {
        id: "doc-1",
        title: "API Reference",
        body: "API documentation content",
        score: 0.85,
      },
    ]);

    expect(result).toContain("[relevance: 85%]");
  });

  it("handles multiple articles", () => {
    const result = buildKnowledgePreamble([
      { id: "doc-1", title: "Guide A", body: "Content A" },
      { id: "doc-2", title: "Guide B", body: "Content B" },
    ]);

    expect(result).toContain("Guide A");
    expect(result).toContain("Guide B");
  });

  it("truncates long body text", () => {
    const longBody = "A".repeat(1000);
    const result = buildKnowledgePreamble([
      { id: "doc-1", title: "Long Doc", body: longBody },
    ]);

    expect(result.length).toBeLessThan(longBody.length + 200);
    expect(result).toContain("…");
  });
});

describe("buildMemoryPreamble", () => {
  it("returns empty string for empty snippets", () => {
    expect(buildMemoryPreamble([])).toBe("");
  });

  it("formats a memory snippet with source reference", () => {
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: "Important decision about architecture",
        score: 0.92,
        source: {
          kind: "issue_comment",
          companyId: "co-1",
          issueId: "iss-1",
        },
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("=== Context from Past Work ===");
    expect(result).toContain("Important decision about architecture");
    expect(result).toContain("[relevance: 92%]");
    expect(result).toContain("=== End Context ===");
  });

  it("includes summaries when present", () => {
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: "Detailed content here",
        summary: "Short summary",
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("Short summary");
  });
});