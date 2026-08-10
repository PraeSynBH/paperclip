import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

// RBR-1108 regression test: hermes_local must never let this long-lived,
// multi-tenant Paperclip server process's own `process.env` leak into a
// spawned Hermes child process. If it does, a stale PAPERCLIP_TASK_ID /
// PAPERCLIP_WAKE_REASON / PAPERCLIP_WAKE_PAYLOAD_JSON left in the server
// process's env (e.g. from a prior run, or from how the server itself was
// launched) gets handed to *this* run's agent whenever the current wake
// context doesn't happen to override every one of those keys — exactly the
// cross-tenant leak reported in RBR-1108, where a Voyonder issue's wake
// payload was injected into the Rambur CEO's heartbeat twice in a row.

const runChildProcessMock = vi.hoisted(() =>
  vi.fn(
    async (
      _runId: string,
      _command: string,
      _args: string[],
      _opts: { env: Record<string, string> },
    ) => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "done\n",
      stderr: "",
    }),
  ),
);

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    runChildProcess: runChildProcessMock,
  };
});

import { execute } from "./execute.js";

const LEAKED_ENV_KEYS = [
  "PAPERCLIP_TASK_ID",
  "PAPERCLIP_WAKE_REASON",
  "PAPERCLIP_WAKE_PAYLOAD_JSON",
  "PAPERCLIP_WAKE_COMMENT_ID",
] as const;

const CROSS_TENANT_VALUES: Record<string, string> = {
  PAPERCLIP_TASK_ID: "92d89071-fd5f-4769-9aa7-e08f946930dc",
  PAPERCLIP_WAKE_REASON: "issue_continuation_needed",
  PAPERCLIP_WAKE_PAYLOAD_JSON: JSON.stringify({
    issue: { identifier: "VOY-421", title: "Voyonder-only wake payload" },
  }),
  PAPERCLIP_WAKE_COMMENT_ID: "voyonder-comment-should-not-leak",
};

function makeCtx(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "rambur-run-1",
    agent: {
      id: "rambur-cto-agent",
      companyId: "rambur-company",
      name: "CTO",
      adapterType: "hermes_local",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config: { timeoutSec: 5 },
    // Simulate a heartbeat_timer wake with no explicit issue/task context —
    // the exact scenario that hit RBR-1108, where nothing in the wake's own
    // context overrides the stale process.env PAPERCLIP_* keys.
    context: {},
    onLog: vi.fn(async () => undefined),
    ...overrides,
  } as AdapterExecutionContext;
}

describe("hermes_local execute — tenant-isolation env handling (RBR-1108)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    runChildProcessMock.mockClear();
    for (const key of LEAKED_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      // Simulate the long-lived Paperclip server process's own env still
      // carrying another company's (Voyonder's) wake context.
      process.env[key] = CROSS_TENANT_VALUES[key];
    }
  });

  afterEach(() => {
    for (const key of LEAKED_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("never forwards the host server process's own PAPERCLIP_* env into the spawned child", async () => {
    await execute(makeCtx());

    expect(runChildProcessMock).toHaveBeenCalledTimes(1);
    const spawnedEnv = runChildProcessMock.mock.calls[0][3].env as Record<string, string>;

    for (const key of LEAKED_ENV_KEYS) {
      expect(spawnedEnv[key]).not.toBe(CROSS_TENANT_VALUES[key]);
    }
    // With no wake context of its own, this run should carry no task id,
    // wake reason, or wake payload at all — not a stale foreign-company one.
    expect(spawnedEnv.PAPERCLIP_TASK_ID).toBeUndefined();
    expect(spawnedEnv.PAPERCLIP_WAKE_REASON).toBeUndefined();
    expect(spawnedEnv.PAPERCLIP_WAKE_PAYLOAD_JSON).toBeUndefined();
    expect(spawnedEnv.PAPERCLIP_WAKE_COMMENT_ID).toBeUndefined();
  });

  it("still uses this run's own wake context values when the run does provide one", async () => {
    await execute(
      makeCtx({
        context: {
          issueId: "rbr-1108",
          wakeReason: "issue_continuation_needed",
          paperclipWake: { issue: { identifier: "RBR-1108", title: "Rambur-owned issue" } },
        },
      }),
    );

    const spawnedEnv = runChildProcessMock.mock.calls[0][3].env as Record<string, string>;
    expect(spawnedEnv.PAPERCLIP_TASK_ID).toBe("rbr-1108");
    expect(spawnedEnv.PAPERCLIP_WAKE_REASON).toBe("issue_continuation_needed");
    expect(spawnedEnv.PAPERCLIP_WAKE_PAYLOAD_JSON).toContain("RBR-1108");
    // And must still not contain the cross-tenant Voyonder payload leaked
    // via process.env.
    expect(spawnedEnv.PAPERCLIP_WAKE_PAYLOAD_JSON).not.toContain("VOY-421");
  });
});
