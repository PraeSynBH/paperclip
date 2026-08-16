import { describe, expect, it, vi } from "vitest";
import { buildMemoryPreamble } from "./memory-context-injection.js";
import type { MemorySnippet } from "@paperclipai/shared";

describe("buildMemoryPreamble", () => {
  it("returns empty string for empty snippets", () => {
    expect(buildMemoryPreamble([])).toBe("");
  });

  it("returns empty string for null/undefined", () => {
    expect(buildMemoryPreamble(null as unknown as MemorySnippet[])).toBe("");
    expect(buildMemoryPreamble(undefined as unknown as MemorySnippet[])).toBe("");
  });

  it("formats a single snippet as markdown preamble", () => {
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: "The database connection string uses SSL by default.",
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("=== Context from Past Work ===");
    expect(result).toContain("=== End Context ===");
    expect(result).toContain("The database connection string uses SSL by default.");
    expect(result).toContain("Memory 1");
  });

  it("includes score when present", () => {
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: "Important decision about authentication.",
        score: 0.85,
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("85%");
  });

  it("includes source reference when present", () => {
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: "Decision about API versioning.",
        source: {
          kind: "issue_comment",
          companyId: "comp-1",
          issueId: "00000000-0000-0000-0000-000000000001",
        },
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("issue_comment");
    expect(result).toContain("00000000");
  });

  it("includes summary when present", () => {
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: "Full text of the memory record.",
        summary: "Short summary of the decision.",
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("Short summary of the decision.");
    expect(result).toContain("Full text of the memory record.");
  });

  it("truncates text longer than 500 chars", () => {
    const longText = "x".repeat(600);
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: longText,
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("…");
    expect(result!.length).toBeLessThan(600 + 200); // preamble overhead
  });

  it("formats multiple snippets in order", () => {
    const snippets: MemorySnippet[] = [
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-1" },
        text: "First memory.",
      },
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-2" },
        text: "Second memory.",
      },
      {
        handle: { providerKey: "builtin_pgvector", providerRecordId: "rec-3" },
        text: "Third memory.",
      },
    ];

    const result = buildMemoryPreamble(snippets);
    expect(result).toContain("Memory 1");
    expect(result).toContain("Memory 2");
    expect(result).toContain("Memory 3");
    // Order check: Memory 1 should appear before Memory 2
    expect(result!.indexOf("Memory 1")).toBeLessThan(result!.indexOf("Memory 2"));
  });
});
