import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

const mockPinoHttp = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockTransport = vi.hoisted(() => vi.fn(() => ({ write: vi.fn() })));
const mockPino = vi.hoisted(() => {
  const fn = vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(),
  }));
  (fn as any).transport = mockTransport;
  return fn;
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdirSync: vi.fn() };
});

vi.mock("pino", () => ({
  default: mockPino,
}));

vi.mock("pino-http", () => ({
  pinoHttp: mockPinoHttp,
}));

vi.mock("../config-file.js", () => ({
  readConfigFile: vi.fn(() => null),
}));

vi.mock("../home-paths.js", () => ({
  resolveHomeAwarePath: vi.fn((p: string) => p),
  resolveDefaultLogsDir: vi.fn(() => "/tmp/paperclip-test-logs"),
}));

describe("logger customProps redacts request URL query strings on errors", () => {
  let customProps: (req: any, res: any) => Record<string, unknown>;
  let customSuccessMessage: (req: any, res: any) => string;
  let customErrorMessage: (req: any, res: any, err?: Error) => string;

  beforeAll(async () => {
    await import("../middleware/logger.js");
    const options = mockPinoHttp.mock.calls[0][0] as Record<string, unknown>;
    customProps = options.customProps as (req: any, res: any) => Record<string, unknown>;
    customSuccessMessage = options.customSuccessMessage as (req: any, res: any) => string;
    customErrorMessage = options.customErrorMessage as (req: any, res: any, err?: Error) => string;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a redacted reqUrl for 4xx responses", () => {
    const result = customProps(
      { url: "/api/tenants/acme/users?email=alice@example.com" },
      { statusCode: 404 },
    );

    expect(result.reqUrl).toBe("/api/tenants/acme/users?email=[REDACTED]");
  });

  it("emits a redacted reqUrl for 5xx responses even when req body/params/query are empty", () => {
    const result = customProps(
      { url: "/api/search?q=secret-token&page=1" },
      { statusCode: 500 },
    );

    expect(result.reqUrl).toBe("/api/search?q=[REDACTED]&page=[REDACTED]");
  });

  it("returns no extra props for 2xx/3xx responses", () => {
    expect(customProps(
      { url: "/api/users?email=alice@example.com" },
      { statusCode: 200 },
    )).toEqual({});
    expect(customProps(
      { url: "/api/redirect?token=secret" },
      { statusCode: 302 },
    )).toEqual({});
  });

  it("passes the error context through while still redacting the URL", () => {
    const result = customProps(
      { url: "/api/action?password=hunter2" },
      {
        statusCode: 422,
        __errorContext: {
          error: { message: "validation failed" },
          reqBody: { password: "hunter2" },
          reqParams: {},
          reqQuery: {},
        },
      },
    );

    expect(result.reqUrl).toBe("/api/action?password=[REDACTED]");
    expect(result.errorContext).toEqual({ message: "validation failed" });
  });

  it("redacts the URL in success messages", () => {
    const result = customSuccessMessage(
      { method: "GET", url: "/api/users?email=alice@example.com" },
      { statusCode: 200 },
    );

    expect(result).toBe("GET /api/users?email=[REDACTED] 200");
  });

  it("redacts the URL in error messages", () => {
    const result = customErrorMessage(
      { method: "POST", url: "/api/login?password=hunter2" },
      { statusCode: 500 },
      new Error("database timeout"),
    );

    expect(result).toBe("POST /api/login?password=[REDACTED] 500 — database timeout");
  });

  it("redacts the URL in error messages even with no error object", () => {
    const result = customErrorMessage(
      { method: "GET", url: "/api/action?token=secret" },
      { statusCode: 400 },
      undefined,
    );

    expect(result).toBe("GET /api/action?token=[REDACTED] 400 — unknown error");
  });
});
