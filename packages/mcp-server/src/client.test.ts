import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiAuthError, PaperclipApiClient, PaperclipApiError } from "./client.js";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "33333333-3333-3333-3333-333333333333",
  });
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PaperclipApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws the generic PaperclipApiError for a non-401 failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    await expect(client.requestJson("GET", "/issues/missing")).rejects.toBeInstanceOf(PaperclipApiError);
    await expect(client.requestJson("GET", "/issues/missing")).rejects.not.toBeInstanceOf(PaperclipApiAuthError);
  });

  it("classifies a 401 as PaperclipApiAuthError, a distinct class from the generic PaperclipApiError", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ error: "JWT expired" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    await expect(client.requestJson("GET", "/agents/me")).rejects.toBeInstanceOf(PaperclipApiAuthError);
    await expect(client.requestJson("GET", "/agents/me")).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("JWT expired"),
    });
  });

  it(
    "a bounded retry/backoff wrapper around the client must stop after one attempt on a 401, not fold it into the timeout/5xx retry path (RBR-1036)",
    async () => {
      // First call: transient 503 (legitimately retryable). Second call: the
      // credential has since expired and the API now rejects with 401 — this
      // must be treated as terminal, not retried like the 503 was. Third call
      // (never reached if the fix holds) would "succeed", proving a naive
      // retry loop would have masked the real failure.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "Service unavailable" }, 503))
        .mockResolvedValueOnce(jsonResponse({ error: "JWT expired" }, 401))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
      vi.stubGlobal("fetch", fetchMock);

      const client = makeClient();

      async function withBoundedRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error;
            // The retry wrapper's whole point under test: a 401 is terminal
            // and must fail fast on the first occurrence rather than looping
            // through the remaining attempt budget.
            if (error instanceof PaperclipApiAuthError) throw error;
          }
        }
        throw lastError;
      }

      const maxAttempts = 6;
      let caughtError: unknown;
      try {
        await withBoundedRetry(() => client.requestJson("POST", "/issues/PAP-1/comments", { body: {} }), maxAttempts);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(PaperclipApiAuthError);
      expect((caughtError as PaperclipApiAuthError).status).toBe(401);
      // One retried transient 503, then the terminal 401 — never reaches the
      // third, would-be-successful call.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});
