import { describe, expect, it } from "vitest";
import { shouldWakeOnRestoredBlockedDependency } from "../services/issue-dependency-wakeups.js";

const base = {
  previousStatus: "in_progress",
  nextStatus: "blocked",
  previousAssigneeAgentId: "agent-1",
  nextAssigneeAgentId: "agent-1",
  blockerSetEdited: false,
  hasUnblockDescriptor: false,
  actorType: "user",
  actorAgentId: null,
};

describe("shouldWakeOnRestoredBlockedDependency", () => {
  it("wakes the assignee when the board blocks an issue whose blockers are already resolved", () => {
    expect(shouldWakeOnRestoredBlockedDependency(base)).toBe(true);
  });

  it("does not wake the assignee agent that blocked its own issue (re-block loop regression)", () => {
    expect(shouldWakeOnRestoredBlockedDependency({ ...base, actorType: "agent", actorAgentId: "agent-1" })).toBe(false);
    expect(
      shouldWakeOnRestoredBlockedDependency({ ...base, actorType: "agent", actorAgentId: "agent-1", blockerSetEdited: true }),
    ).toBe(false);
  });

  it("still wakes when another agent blocks the issue or the assignee changes", () => {
    expect(shouldWakeOnRestoredBlockedDependency({ ...base, actorType: "agent", actorAgentId: "agent-2" })).toBe(true);
    expect(
      shouldWakeOnRestoredBlockedDependency({
        ...base,
        actorType: "agent",
        actorAgentId: "agent-2",
        previousAssigneeAgentId: "agent-1",
        nextAssigneeAgentId: "agent-2",
      }),
    ).toBe(true);
  });

  it("does not wake a row parked on an unblock descriptor, on either road into the wake", () => {
    const parked = { ...base, hasUnblockDescriptor: true };
    // board or another actor blocks it while its blockers are already ready
    expect(shouldWakeOnRestoredBlockedDependency(parked)).toBe(false);
    expect(
      shouldWakeOnRestoredBlockedDependency({ ...parked, actorType: "agent", actorAgentId: "agent-2" }),
    ).toBe(false);
    // a new assignee takes the parked row
    expect(
      shouldWakeOnRestoredBlockedDependency({
        ...parked,
        previousAssigneeAgentId: "agent-1",
        nextAssigneeAgentId: "agent-2",
      }),
    ).toBe(false);
    // the same edit on a relation-blocked row (no descriptor) still wakes, so
    // the gate is the descriptor, not the assignee change
    expect(
      shouldWakeOnRestoredBlockedDependency({
        ...base,
        previousAssigneeAgentId: "agent-1",
        nextAssigneeAgentId: "agent-2",
      }),
    ).toBe(true);
  });

  it("keeps the existing gates: already blocked with no edit, not blocked, or unassigned", () => {
    expect(shouldWakeOnRestoredBlockedDependency({ ...base, previousStatus: "blocked" })).toBe(false);
    expect(shouldWakeOnRestoredBlockedDependency({ ...base, previousStatus: "blocked", blockerSetEdited: true })).toBe(true);
    expect(shouldWakeOnRestoredBlockedDependency({ ...base, nextStatus: "todo" })).toBe(false);
    expect(shouldWakeOnRestoredBlockedDependency({ ...base, nextAssigneeAgentId: null })).toBe(false);
  });
});
