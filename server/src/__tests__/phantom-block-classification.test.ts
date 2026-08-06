import { describe, expect, it } from "vitest";
import {
  analyzeDiscriminatorVariance,
  assertDiscriminatorVariance,
  classifyPhantomBlockedIssues,
  ConstantDiscriminatorError,
  interactionSurvivesUserComment,
  summarizePhantomBlockClassifications,
  type PhantomBlockIssueInput,
} from "../services/recovery/phantom-block-classification.ts";

function issue(overrides: Partial<PhantomBlockIssueInput> = {}): PhantomBlockIssueInput {
  return {
    id: "issue-1",
    identifier: "RBR-705",
    title: "Mint a write-scoped Drata API key",
    status: "blocked",
    assigneeAgentId: "agent-1",
    assigneeUserId: null,
    responsibleUserId: null,
    unresolvedBlockerCount: 0,
    proseBlockerIdentifiers: [],
    ...overrides,
  };
}

describe("classifyPhantomBlockedIssues", () => {
  it("classifies a blocked issue with zero edges and a pending request_confirmation as human_gated and never unblocks it", () => {
    // RBR-824 acceptance criterion 4, and the live RBR-705 counter-example.
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue()],
      pendingInteractions: [{
        id: "90c6ab86",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "pending",
      }],
    });

    expect(row.bucket).toBe("human_gated");
    expect(row.unblocks).toBe(false);
    expect(row.action).toBe("move_to_in_review");
    expect(row.targetStatus).toBe("in_review");
    expect(row.humanGated).toBe(true);
    expect(row.pendingInteractionIds).toEqual(["90c6ab86"]);
  });

  it("treats a blocked issue with no edges, no interaction and no human owner as stranded", () => {
    const [row] = classifyPhantomBlockedIssues({ issues: [issue({ identifier: "RBR-787" })] });

    expect(row.bucket).toBe("stranded");
    expect(row.action).toBe("assign_and_wake");
    expect(row.targetStatus).toBe("todo");
    expect(row.unblocks).toBe(true);
    expect(row.humanGated).toBe(false);
  });

  it("flags a stranded issue with no agent assignee for manual review instead of silently waking it", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue({ assigneeAgentId: null })],
    });

    expect(row.bucket).toBe("stranded");
    expect(row.requiresManualReview).toBe(true);
  });

  it("keeps a prose-described dependency blocked and asks for the missing edge", () => {
    // RBR-804's case: the blocker was described in comments but never edged.
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue({ identifier: "RBR-804", proseBlockerIdentifiers: ["RBR-813"] })],
      issueStatusByIdentifier: { "RBR-813": "blocked" },
    });

    expect(row.bucket).toBe("missing_edge");
    expect(row.action).toBe("create_blocker_edge");
    expect(row.targetStatus).toBe("blocked");
    expect(row.unblocks).toBe(false);
    expect(row.missingBlockerIdentifiers).toEqual(["RBR-813"]);
  });

  it("ignores prose blockers that are already done or unknown", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue({ proseBlockerIdentifiers: ["RBR-767", "RBR-9999", "RBR-705"] })],
      issueStatusByIdentifier: { "RBR-767": "done" },
    });

    expect(row.bucket).toBe("stranded");
    expect(row.missingBlockerIdentifiers).toEqual([]);
  });

  it("leaves issues with real unresolved blocker edges alone", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue({ unresolvedBlockerCount: 2 })],
    });

    expect(row.bucket).toBe("real_blocker");
    expect(row.action).toBe("none");
    expect(row.targetStatus).toBeNull();
    expect(row.unblocks).toBe(false);
  });

  it("prefers the missing edge over the human gate when both are present, and still does not unblock", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue({ proseBlockerIdentifiers: ["RBR-813"] })],
      issueStatusByIdentifier: { "RBR-813": "in_progress" },
      pendingInteractions: [{
        id: "int-1",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "pending",
      }],
    });

    expect(row.bucket).toBe("missing_edge");
    expect(row.unblocks).toBe(false);
    expect(row.humanGated).toBe(true);
  });

  it("treats a human assignee with no interaction as human_gated, not stranded", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue({ assigneeAgentId: null, assigneeUserId: "user-ben" })],
    });

    expect(row.bucket).toBe("human_gated");
    expect(row.unblocks).toBe(false);
    expect(row.wakePathDurable).toBe(true);
  });

  it("ignores non-pending interactions", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue()],
      pendingInteractions: [{
        id: "int-1",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "expired",
      }],
    });

    expect(row.bucket).toBe("stranded");
    expect(row.pendingInteractionIds).toEqual([]);
  });

  it("marks a supersedable-only wake path as fragile until RBR-823 ships", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue()],
      pendingInteractions: [{
        id: "int-1",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "pending",
      }],
    });

    // Still bucket 2 — fragility never converts into an unblock.
    expect(row.bucket).toBe("human_gated");
    expect(row.unblocks).toBe(false);
    expect(row.wakePathDurable).toBe(false);
    expect(row.requiresManualReview).toBe(true);
  });

  it("accepts the interaction wake path as durable once RBR-823 has shipped", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue()],
      pendingInteractions: [{
        id: "int-1",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "pending",
      }],
      interactionWakePathIsDurable: true,
    });

    expect(row.wakePathDurable).toBe(true);
    expect(row.requiresManualReview).toBe(false);
  });

  it("accepts an opted-out interaction as durable even before RBR-823", () => {
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue()],
      pendingInteractions: [{
        id: "int-1",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "pending",
        supersedeOnUserComment: false,
      }],
    });

    expect(row.wakePathDurable).toBe(true);
  });

  it("does not classify an issue as human_gated when responsibleUserId is its only human signal", () => {
    // RBR-849 AC 2 — the inverse of AC4. `responsibleUserId` is populated on 842/842
    // issues with one distinct value. It is a constant, not an owner signal, and it is
    // not a wake path (RBR-809 Finding B). An issue carrying only that field has no
    // gate at all and belongs in bucket 1, where it gets a real wake path — not in
    // `in_review`, which is burial wearing a different word.
    const [row] = classifyPhantomBlockedIssues({
      issues: [issue({
        identifier: "RBR-596",
        assigneeUserId: null,
        responsibleUserId: "i66elh65thHBfp2zjIxgQEja6RqohJQY",
      })],
    });

    expect(row.bucket).toBe("stranded");
    expect(row.humanGated).toBe(false);
    expect(row.action).toBe("assign_and_wake");
    expect(row.targetStatus).toBe("todo");
    expect(row.pendingInteractionIds).toEqual([]);
  });

  it("still classifies as human_gated when responsibleUserId is accompanied by a real signal", () => {
    // The fix removes a constant; it must not remove the signals that actually vary.
    const [byAssignee] = classifyPhantomBlockedIssues({
      issues: [issue({
        assigneeAgentId: null,
        assigneeUserId: "user-ben",
        responsibleUserId: "i66elh65thHBfp2zjIxgQEja6RqohJQY",
      })],
    });
    expect(byAssignee.bucket).toBe("human_gated");

    const [byInteraction] = classifyPhantomBlockedIssues({
      issues: [issue({ responsibleUserId: "i66elh65thHBfp2zjIxgQEja6RqohJQY" })],
      pendingInteractions: [{
        id: "int-1",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "pending",
      }],
    });
    expect(byInteraction.bucket).toBe("human_gated");
  });

  it("keeps the RBR-823 fragility interlock reachable for a responsibleUserId-carrying issue", () => {
    // RBR-849 consequence 2: with responsibleUserId in `hasHumanOwner`, `fragile` was
    // always false and `fragileWakePathCount: 0` was indistinguishable from "all clear".
    // A pending supersedable interaction on an issue that carries the constant must
    // still report FRAGILE while RBR-823 is open.
    const rows = classifyPhantomBlockedIssues({
      issues: [issue({
        identifier: "RBR-381",
        responsibleUserId: "i66elh65thHBfp2zjIxgQEja6RqohJQY",
      })],
      pendingInteractions: [{
        id: "int-1",
        issueId: "issue-1",
        kind: "request_confirmation",
        status: "pending",
      }],
      interactionWakePathIsDurable: false,
    });

    expect(rows[0].bucket).toBe("human_gated");
    expect(rows[0].wakePathDurable).toBe(false);
    expect(rows[0].requiresManualReview).toBe(true);
    expect(summarizePhantomBlockClassifications(rows).fragileWakePathCount).toBe(1);
  });

  it("reproduces the corrected bucket split on a population shaped like the live board", () => {
    // 5 issues with a genuine pending interaction, 29 whose only human signal is the
    // constant. Before RBR-849 this was 34 human_gated / 0 stranded / 0 fragile.
    const RESPONSIBLE = "i66elh65thHBfp2zjIxgQEja6RqohJQY";
    const gated = ["RBR-381", "RBR-40", "RBR-19", "RBR-596", "RBR-775"].map((identifier, index) =>
      issue({ id: `gated-${index}`, identifier, responsibleUserId: RESPONSIBLE }),
    );
    const constantOnly = Array.from({ length: 29 }, (_, index) =>
      issue({ id: `const-${index}`, identifier: `RBR-9${index}`, responsibleUserId: RESPONSIBLE }),
    );

    const summary = summarizePhantomBlockClassifications(classifyPhantomBlockedIssues({
      issues: [...gated, ...constantOnly],
      pendingInteractions: gated.map((row, index) => ({
        id: `int-${index}`,
        issueId: row.id,
        kind: "request_confirmation",
        status: "pending",
      })),
      interactionWakePathIsDurable: false,
    }));

    expect(summary.byBucket.human_gated).toBe(5);
    expect(summary.byBucket.stranded).toBe(29);
    expect(summary.fragileWakePathCount).toBe(5);
  });

  it("never emits an unblock for any human_gated or missing_edge row across a mixed population", () => {
    const rows = classifyPhantomBlockedIssues({
      issues: [
        issue({ id: "a", identifier: "RBR-705" }),
        issue({ id: "b", identifier: "RBR-787" }),
        issue({ id: "c", identifier: "RBR-804", proseBlockerIdentifiers: ["RBR-813"] }),
        issue({ id: "d", identifier: "RBR-813", unresolvedBlockerCount: 1 }),
      ],
      issueStatusByIdentifier: { "RBR-813": "blocked" },
      pendingInteractions: [{ id: "i1", issueId: "a", kind: "request_confirmation", status: "pending" }],
    });

    for (const row of rows) {
      if (row.bucket !== "stranded") expect(row.unblocks).toBe(false);
    }

    const summary = summarizePhantomBlockClassifications(rows);
    expect(summary.total).toBe(4);
    expect(summary.byBucket).toEqual({
      real_blocker: 1,
      missing_edge: 1,
      human_gated: 1,
      stranded: 1,
    });
    expect(summary.unblockCount).toBe(1);
  });
});

describe("interactionSurvivesUserComment", () => {
  it("reports supersedable kinds as destroyed by a board comment by default", () => {
    for (const kind of ["request_confirmation", "request_checkbox_confirmation", "ask_user_questions"]) {
      expect(interactionSurvivesUserComment({ id: "i", issueId: "x", kind, status: "pending" })).toBe(false);
    }
  });

  it("reports non-supersedable kinds as surviving", () => {
    expect(
      interactionSurvivesUserComment({ id: "i", issueId: "x", kind: "suggest_tasks", status: "pending" }),
    ).toBe(true);
  });
});

describe("discriminator variance guard (RBR-849 AC 3)", () => {
  const RESPONSIBLE = "i66elh65thHBfp2zjIxgQEja6RqohJQY";

  it("identifies responsibleUserId as a constant on a live-shaped population", () => {
    const population = Array.from({ length: 34 }, (_, index) =>
      issue({ id: `i-${index}`, identifier: `RBR-${index}`, responsibleUserId: RESPONSIBLE }),
    );

    const [report] = analyzeDiscriminatorVariance(population, ["responsibleUserId"]);

    expect(report.populated).toBe(34);
    expect(report.distinctValues).toBe(1);
    expect(report.isConstant).toBe(true);
    expect(report.hasZeroVariance).toBe(true);
  });

  it("throws rather than letting a constant field be trusted as a discriminator", () => {
    const population = Array.from({ length: 10 }, (_, index) =>
      issue({ id: `i-${index}`, responsibleUserId: RESPONSIBLE }),
    );

    expect(() => assertDiscriminatorVariance(population, ["responsibleUserId"]))
      .toThrow(ConstantDiscriminatorError);
    // The failure names the offending field so the zero is never read as "all clear".
    expect(() => assertDiscriminatorVariance(population, ["responsibleUserId"]))
      .toThrow(/responsibleUserId/);
  });

  it("passes the fields the classifier actually branches on", () => {
    const population = [
      issue({ id: "a", assigneeUserId: "user-ben", assigneeAgentId: null }),
      issue({ id: "b", assigneeUserId: null, assigneeAgentId: "agent-1" }),
      issue({ id: "c", assigneeUserId: null, assigneeAgentId: null, unresolvedBlockerCount: 2 }),
    ];

    expect(() => assertDiscriminatorVariance(population)).not.toThrow();
  });

  it("treats an absent-everywhere field as zero-variance but not fatal", () => {
    const population = [issue({ id: "a" }), issue({ id: "b" })];

    const [report] = analyzeDiscriminatorVariance(population, ["responsibleUserId"]);
    expect(report.populated).toBe(0);
    expect(report.isConstant).toBe(false);
    expect(report.hasZeroVariance).toBe(true);
    expect(() => assertDiscriminatorVariance(population, ["responsibleUserId"])).not.toThrow();
  });

  it("does not fire on a population too small to measure variance", () => {
    expect(() => assertDiscriminatorVariance([issue({ responsibleUserId: RESPONSIBLE })], ["responsibleUserId"]))
      .not.toThrow();
    expect(() => assertDiscriminatorVariance([], ["responsibleUserId"])).not.toThrow();
  });
});
