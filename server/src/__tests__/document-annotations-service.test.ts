import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  documentAnnotationAnchorSnapshots,
  documentAnnotationComments,
  documentAnnotationThreads,
  documentRevisions,
  documents,
  issueComments,
  issueDocuments,
  issuePlanDecompositions,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { documentAnnotationService } from "../services/document-annotations.js";
import { documentService } from "../services/documents.js";
import { buildPaperclipWakePayload } from "../services/heartbeat.js";
import { buildPlanReviewContext, PLAN_REVIEW_CONTEXT_LIMITS } from "../services/plan-review-context.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres document annotation service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describeEmbeddedPostgres("documentAnnotationService", () => {
  let db!: ReturnType<typeof createDb>;
  let annotations!: ReturnType<typeof documentAnnotationService>;
  let docs!: ReturnType<typeof documentService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-document-annotations-");
    db = createDb(tempDb.connectionString);
    annotations = documentAnnotationService(db);
    docs = documentService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(documentAnnotationAnchorSnapshots);
    await db.delete(documentAnnotationComments);
    await db.delete(documentAnnotationThreads);
    await db.delete(issueThreadInteractions);
    await db.delete(issuePlanDecompositions);
    await db.delete(documentRevisions);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createIssueWithDocument(workMode: "planning" | "standard" = "planning") {
    const companyId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier: `PAP-${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      title: "Annotation race",
      description: "Validate annotation revision guards",
      status: "in_progress",
      workMode,
      priority: "high",
    });

    const created = await docs.upsertIssueDocument({
      issueId,
      key: "plan",
      title: "Plan",
      format: "markdown",
      body: "Alpha selected text omega",
    });

    return { companyId, issueId, document: created.document };
  }

  it("fails closed when a concurrent document update wins before annotation thread creation commits", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const concurrentUpdateCanCommit = deferred<void>();
    const concurrentUpdateHasWritten = deferred<void>();

    const concurrentUpdate = db.transaction(async (tx) => {
      const now = new Date();
      const [revision] = await tx
        .insert(documentRevisions)
        .values({
          companyId,
          documentId: document.id,
          revisionNumber: document.latestRevisionNumber + 1,
          title: "Plan",
          format: "markdown",
          body: "Alpha changed text omega",
          changeSummary: "Concurrent edit",
          createdAt: now,
        })
        .returning();

      await tx
        .update(documents)
        .set({
          latestBody: "Alpha changed text omega",
          latestRevisionId: revision.id,
          latestRevisionNumber: document.latestRevisionNumber + 1,
          updatedAt: now,
        })
        .where(eq(documents.id, document.id));

      concurrentUpdateHasWritten.resolve();
      await concurrentUpdateCanCommit.promise;
    });

    await concurrentUpdateHasWritten.promise;

    let annotationSettled = false;
    const annotationResult = annotations
      .createThread(
        issueId,
        "plan",
        {
          baseRevisionId: document.latestRevisionId!,
          baseRevisionNumber: document.latestRevisionNumber,
          selector: {
            quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
            position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
          },
          body: "Please review this text",
        },
        { actorType: "user", actorId: "board-user", userId: "board-user" },
      )
      .then(
        () => ({ status: "fulfilled" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
      .finally(() => {
        annotationSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(annotationSettled).toBe(false);

    concurrentUpdateCanCommit.resolve();
    await concurrentUpdate;

    const result = await annotationResult;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toMatchObject({
        status: 409,
        message: "Annotation anchor requires the current document revision",
        details: {
          currentRevisionNumber: 2,
        },
      });
    }

    const threads = await db.select().from(documentAnnotationThreads);
    expect(threads).toHaveLength(0);
  });

  it("removes linked annotation comments and resolves empty threads when an issue comment is deleted", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const [issueComment] = await db
      .insert(issueComments)
      .values({
        companyId,
        issueId,
        authorType: "user",
        authorUserId: "board-user",
        body: "Delete this linked comment",
      })
      .returning();

    const thread = await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "Linked annotation body",
        issueCommentId: issueComment.id,
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );

    const cleanup = await annotations.cleanupForIssueCommentDeletion(
      issueId,
      issueComment.id,
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );

    expect(cleanup.deletedCommentIds).toEqual([thread.comments[0]!.id]);
    expect(cleanup.resolvedThreadIds).toEqual([thread.id]);
    await expect(
      db.select().from(documentAnnotationComments).where(eq(documentAnnotationComments.id, thread.comments[0]!.id)),
    ).resolves.toHaveLength(0);
    const [updatedThread] = await db
      .select()
      .from(documentAnnotationThreads)
      .where(eq(documentAnnotationThreads.id, thread.id));
    expect(updatedThread?.status).toBe("resolved");
    expect(updatedThread?.resolvedByUserId).toBe("board-user");
  });

  it("rejects annotation comments linked to already-deleted issue comments", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const [issueComment] = await db
      .insert(issueComments)
      .values({
        companyId,
        issueId,
        authorType: "user",
        authorUserId: "board-user",
        body: "",
        deletedAt: new Date("2026-06-05T03:00:00.000Z"),
        deletedByType: "user",
        deletedByUserId: "board-user",
      })
      .returning();

    await expect(
      annotations.createThread(
        issueId,
        "plan",
        {
          baseRevisionId: document.latestRevisionId!,
          baseRevisionNumber: document.latestRevisionNumber,
          selector: {
            quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
            position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
          },
          body: "Do not link this annotation to a deleted comment",
          issueCommentId: issueComment.id,
        },
        { actorType: "user", actorId: "board-user", userId: "board-user" },
      ),
    ).rejects.toMatchObject({
      status: 422,
      message: "Linked issue comment must belong to this issue",
    });

    await expect(db.select().from(documentAnnotationComments)).resolves.toHaveLength(0);
  });

  it("does not report already-resolved empty threads as newly resolved during linked comment cleanup", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const [issueComment] = await db
      .insert(issueComments)
      .values({
        companyId,
        issueId,
        authorType: "user",
        authorUserId: "board-user",
        body: "Delete this linked comment from a resolved thread",
      })
      .returning();

    const thread = await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "Linked annotation body",
        issueCommentId: issueComment.id,
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );

    await db
      .update(documentAnnotationThreads)
      .set({ status: "resolved", resolvedByUserId: "board-user", resolvedAt: new Date("2026-06-05T03:05:00.000Z") })
      .where(eq(documentAnnotationThreads.id, thread.id));

    const cleanup = await annotations.cleanupForIssueCommentDeletion(
      issueId,
      issueComment.id,
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );

    expect(cleanup.deletedCommentIds).toEqual([thread.comments[0]!.id]);
    expect(cleanup.resolvedThreadIds).toEqual([]);
  });

  it("builds compact open plan review context and excludes resolved threads", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const longBody = "x".repeat(PLAN_REVIEW_CONTEXT_LIMITS.maxBodyChars + 25);
    const openThread = await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: longBody,
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );
    const resolvedThread = await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "Already resolved",
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );
    await db
      .update(documentAnnotationThreads)
      .set({
        status: "resolved",
        anchorState: "stale",
        anchorConfidence: "fuzzy",
        resolvedByUserId: "board-user",
        resolvedAt: new Date("2026-06-05T03:05:00.000Z"),
      })
      .where(eq(documentAnnotationThreads.id, resolvedThread.id));

    const context = await buildPlanReviewContext({
      db,
      companyId,
      issueId,
      issueWorkMode: "planning",
    });

    expect(context).toMatchObject({
      documentKey: "plan",
      issueId,
      latestRevisionId: document.latestRevisionId,
      latestRevisionNumber: document.latestRevisionNumber,
      totals: {
        openThreadCount: 1,
        includedThreadCount: 1,
        omittedThreadCount: 0,
        commentCount: 1,
        includedCommentCount: 1,
        omittedCommentCount: 0,
      },
      truncated: true,
    });
    expect(context?.threads.map((thread) => thread.id)).toEqual([openThread.id]);
    expect(context?.threads[0]).toMatchObject({
      status: "open",
      anchorState: "active",
      anchorConfidence: "exact",
      selectedText: "selected text",
      prefixText: "Alpha ",
      suffixText: " omega",
      comments: [
        expect.objectContaining({
          body: "x".repeat(PLAN_REVIEW_CONTEXT_LIMITS.maxBodyChars),
          bodyTruncated: true,
          author: { type: "user", id: "board-user" },
        }),
      ],
    });
  });

  it("includes same-issue plan confirmation target/result and rejects cross-issue interaction context", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const otherIssueId = randomUUID();
    await db.insert(issues).values({
      id: otherIssueId,
      companyId,
      identifier: "PAP-9443",
      title: "Other planning task",
      description: null,
      status: "in_progress",
      workMode: "planning",
      priority: "medium",
    });
    const [interaction] = await db
      .insert(issueThreadInteractions)
      .values({
        companyId,
        issueId,
        kind: "request_confirmation",
        status: "accepted",
        continuationPolicy: "wake_assignee_on_accept",
        payload: {
          version: 1,
          prompt: "Approve this plan?",
          target: {
            type: "issue_document",
            issueId,
            documentId: document.id,
            key: "plan",
            revisionId: document.latestRevisionId,
            revisionNumber: document.latestRevisionNumber,
          },
        },
        result: {
          version: 1,
          outcome: "accepted",
          reason: null,
        },
        resolvedAt: new Date("2026-06-05T03:10:00.000Z"),
      })
      .returning();

    const context = await buildPlanReviewContext({
      db,
      companyId,
      issueId,
      issueWorkMode: "standard",
      interactionId: interaction.id,
    });
    expect(context?.interaction).toMatchObject({
      id: interaction.id,
      status: "accepted",
      target: {
        issueId,
        documentId: document.id,
        key: "plan",
        revisionId: document.latestRevisionId,
        revisionNumber: document.latestRevisionNumber,
      },
      acceptedTargetRevision: {
        revisionId: document.latestRevisionId,
        revisionNumber: document.latestRevisionNumber,
      },
      result: {
        outcome: "accepted",
        reason: null,
      },
    });

    await expect(buildPlanReviewContext({
      db,
      companyId,
      issueId: otherIssueId,
      issueWorkMode: "standard",
      interactionId: interaction.id,
    })).resolves.toBeNull();
  });

  it("includes open plan annotations for standard-mode issue comment wakes", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument("standard");
    const thread = await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "Please incorporate this plan annotation in standard mode.",
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );
    const [comment] = await db
      .insert(issueComments)
      .values({
        companyId,
        issueId,
        authorUserId: "board-user",
        body: "Please continue with the plan feedback above.",
      })
      .returning();

    const payload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        wakeCommentIds: [comment.id],
        wakeReason: "issue_commented",
      },
    });

    expect(payload?.comments).toMatchObject([
      expect.objectContaining({
        id: comment.id,
        body: "Please continue with the plan feedback above.",
      }),
    ]);
    expect(payload?.planReviewContext).toMatchObject({
      issueId,
      totals: {
        openThreadCount: 1,
        includedCommentCount: 1,
      },
      threads: [
        expect.objectContaining({
          id: thread.id,
          comments: [
            expect.objectContaining({
              id: thread.comments[0]!.id,
              body: "Please incorporate this plan annotation in standard mode.",
            }),
          ],
        }),
      ],
    });
  });

  it("includes accepted plan annotations in the structured wake payload", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const thread = await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "Please split this plan step before creating child issues.",
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );
    const [interaction] = await db
      .insert(issueThreadInteractions)
      .values({
        companyId,
        issueId,
        kind: "request_confirmation",
        status: "accepted",
        continuationPolicy: "wake_assignee_on_accept",
        payload: {
          version: 1,
          prompt: "Approve this plan?",
          target: {
            type: "issue_document",
            issueId,
            documentId: document.id,
            key: "plan",
            revisionId: document.latestRevisionId,
            revisionNumber: document.latestRevisionNumber,
          },
        },
        result: {
          version: 1,
          outcome: "accepted",
        },
        resolvedAt: new Date("2026-06-05T03:10:00.000Z"),
      })
      .returning();

    const payload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        interactionId: interaction.id,
        interactionKind: "request_confirmation",
        interactionStatus: "accepted",
        wakeReason: "issue_commented",
      },
    });

    expect(payload?.planReviewContext).toMatchObject({
      interaction: {
        id: interaction.id,
        status: "accepted",
        acceptedTargetRevision: {
          issueId,
          documentId: document.id,
          key: "plan",
          revisionId: document.latestRevisionId,
          revisionNumber: document.latestRevisionNumber,
        },
        result: {
          outcome: "accepted",
        },
      },
      totals: {
        openThreadCount: 1,
        includedCommentCount: 1,
      },
      threads: [
        expect.objectContaining({
          id: thread.id,
          selectedText: "selected text",
          comments: [
            expect.objectContaining({
              body: "Please split this plan step before creating child issues.",
            }),
          ],
        }),
      ],
    });
  });

  it("fails closed when an annotation delta comment id points at a different issue", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument("standard");
    const { issueId: otherIssueId, document: otherDocument } = await createIssueWithDocument("standard");
    const otherThread = await annotations.createThread(
      otherIssueId,
      "plan",
      {
        baseRevisionId: otherDocument.latestRevisionId!,
        baseRevisionNumber: otherDocument.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "Different issue annotation comment.",
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );

    const payload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        annotationCommentId: otherThread.comments[0]!.id,
        wakeReason: "issue_commented",
      },
    });

    expect(payload?.annotationDeltas).toEqual([]);
    expect(payload?.planReviewContext).toBeNull();
  });

  it("includes plan review context for same-issue annotation deltas on standard issues", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument("standard");
    const thread = await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "Direct same-issue annotation comment.",
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );

    const payload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        annotationCommentId: thread.comments[0]!.id,
        wakeReason: "issue_commented",
      },
    });

    expect(payload?.annotationDeltas).toMatchObject([
      expect.objectContaining({
        id: thread.comments[0]!.id,
        issueId,
        threadId: thread.id,
        body: "Direct same-issue annotation comment.",
      }),
    ]);
    expect(payload?.planReviewContext).toMatchObject({
      issueId,
      totals: {
        openThreadCount: 1,
        includedCommentCount: 1,
      },
      threads: [
        expect.objectContaining({
          id: thread.id,
          comments: [
            expect.objectContaining({
              id: thread.comments[0]!.id,
              body: "Direct same-issue annotation comment.",
            }),
          ],
        }),
      ],
    });
  });

  it("includes rejection result and open plan annotations even when the reason is empty", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    await annotations.createThread(
      issueId,
      "plan",
      {
        baseRevisionId: document.latestRevisionId!,
        baseRevisionNumber: document.latestRevisionNumber,
        selector: {
          quote: { exact: "selected text", prefix: "Alpha ", suffix: " omega" },
          position: { normalizedStart: 6, normalizedEnd: 19, markdownStart: 6, markdownEnd: 19 },
        },
        body: "The plan needs a concrete QA owner.",
      },
      { actorType: "user", actorId: "board-user", userId: "board-user" },
    );
    const [interaction] = await db
      .insert(issueThreadInteractions)
      .values({
        companyId,
        issueId,
        kind: "request_confirmation",
        status: "rejected",
        continuationPolicy: "wake_assignee",
        payload: {
          version: 1,
          prompt: "Approve this plan?",
          target: {
            type: "issue_document",
            issueId,
            documentId: document.id,
            key: "plan",
            revisionId: document.latestRevisionId,
            revisionNumber: document.latestRevisionNumber,
          },
        },
        result: {
          version: 1,
          outcome: "rejected",
          reason: "",
        },
        resolvedAt: new Date("2026-06-05T03:10:00.000Z"),
      })
      .returning();

    const payload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        interactionId: interaction.id,
        interactionKind: "request_confirmation",
        interactionStatus: "rejected",
        wakeReason: "issue_commented",
      },
    });

    expect(payload?.planReviewContext).toMatchObject({
      interaction: {
        id: interaction.id,
        status: "rejected",
        result: {
          outcome: "rejected",
          reason: null,
        },
      },
      totals: {
        openThreadCount: 1,
        includedCommentCount: 1,
      },
      threads: [
        expect.objectContaining({
          selectedText: "selected text",
          comments: [
            expect.objectContaining({
              body: "The plan needs a concrete QA owner.",
            }),
          ],
        }),
      ],
    });
  });

  it("includes accepted revision body when interaction targets an accepted revision", async () => {
    const { companyId, issueId, document } = await createIssueWithDocument();
    const planBody = JSON.stringify({
      milestones: [
        { id: "m1", title: "Phase 1", tasks: ["task1", "task2"] },
        { id: "m2", title: "Phase 2", tasks: ["task3"] },
      ],
    });

    // Create a specific revision with structured plan content
    const [revision] = await db
      .insert(documentRevisions)
      .values({
        companyId,
        documentId: document.id,
        revisionNumber: document.latestRevisionNumber + 1,
        title: "Plan v2",
        format: "markdown",
        body: planBody,
        createdAt: new Date(),
      })
      .returning();

    const [interaction] = await db
      .insert(issueThreadInteractions)
      .values({
        companyId,
        issueId,
        kind: "request_confirmation",
        status: "accepted",
        continuationPolicy: "wake_assignee_on_accept",
        payload: {
          version: 1,
          prompt: "Approve this plan?",
          target: {
            type: "issue_document",
            issueId,
            documentId: document.id,
            key: "plan",
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
          },
        },
        result: {
          version: 1,
          outcome: "accepted",
        },
        resolvedAt: new Date("2026-06-05T03:10:00.000Z"),
      })
      .returning();

    const context = await buildPlanReviewContext({
      db,
      companyId,
      issueId,
      issueWorkMode: "standard",
      interactionId: interaction.id,
    });

    expect(context?.acceptedRevisionBody).toBe(planBody);
    expect(context?.acceptedRevisionBodyTruncated).toBe(false);
    expect(context?.interaction?.acceptedTargetRevision?.revisionId).toBe(revision.id);
  });

  it("includes parent plan context for child issues with no plan document", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    // Create parent issue with a plan document
    const parentIssueId = randomUUID();
    await db.insert(issues).values({
      id: parentIssueId,
      companyId,
      identifier: `PAR-${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      title: "Parent planning issue",
      status: "in_progress",
      workMode: "planning",
      priority: "high",
    });

    const docs = documentService(db);
    const { document: parentDocument } = await docs.upsertIssueDocument({
      issueId: parentIssueId,
      key: "plan",
      title: "Plan",
      format: "markdown",
      body: "Parent plan body with milestones",
    });

    const planBody = JSON.stringify({
      milestones: [
        { id: "m1", title: "Child task A", assignee: "agent-1" },
        { id: "m2", title: "Child task B", assignee: "agent-2" },
      ],
    });

    // Create an accepted revision on the parent's plan
    const [revision] = await db
      .insert(documentRevisions)
      .values({
        companyId,
        documentId: parentDocument.id,
        revisionNumber: parentDocument.latestRevisionNumber + 1,
        title: "Accepted Plan",
        format: "markdown",
        body: planBody,
        createdAt: new Date(),
      })
      .returning();

    // Create a child issue
    const childIssueId = randomUUID();
    await db.insert(issues).values({
      id: childIssueId,
      companyId,
      parentId: parentIssueId,
      identifier: `CHI-${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      title: "Child implementation task",
      description: "Implement the child task from the plan",
      status: "todo",
      workMode: "standard",
      priority: "medium",
    });

    // Create an accepted plan decomposition
    await db.insert(issuePlanDecompositions).values({
      companyId,
      sourceIssueId: parentIssueId,
      acceptedPlanRevisionId: revision.id,
      status: "completed",
      requestFingerprint: `fp:${parentIssueId}:${revision.id}`,
      requestedChildCount: 2,
      requestedChildren: [{ title: "Child task A" }, { title: "Child task B" }],
      childIssueIds: [childIssueId],
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    // Build context for the child issue
    const context = await buildPlanReviewContext({
      db,
      companyId,
      issueId: childIssueId,
      issueWorkMode: "standard",
    });

    expect(context).not.toBeNull();
    expect(context?.parentPlanContext).toMatchObject({
      sourceIssueId: parentIssueId,
      acceptedRevisionId: revision.id,
      acceptedRevisionBody: planBody,
      acceptedRevisionBodyTruncated: false,
    });
    expect(context?.parentPlanContext?.sourceIssueTitle).toBe("Parent planning issue");
    // Child issue has no plan document of its own
    expect(context?.latestRevisionId).toBeNull();
    expect(context?.latestRevisionNumber).toBeNull();
  });

  it("locks accepted plan revision for decomposed child issues (subsequent revisions do not affect context)", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    // Create parent issue
    const parentIssueId = randomUUID();
    await db.insert(issues).values({
      id: parentIssueId,
      companyId,
      identifier: `PAR-${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      title: "Parent planning issue",
      status: "in_progress",
      workMode: "planning",
      priority: "high",
    });

    const docs = documentService(db);
    const { document: parentDocument } = await docs.upsertIssueDocument({
      issueId: parentIssueId,
      key: "plan",
      title: "Plan",
      format: "markdown",
      body: "Original plan body",
    });

    // Create the accepted revision (v1)
    const [acceptedRevision] = await db
      .insert(documentRevisions)
      .values({
        companyId,
        documentId: parentDocument.id,
        revisionNumber: parentDocument.latestRevisionNumber + 1,
        title: "Accepted Plan v1",
        format: "markdown",
        body: "Accepted plan v1 body",
        createdAt: new Date(),
      })
      .returning();

    // Create a child issue
    const childIssueId = randomUUID();
    await db.insert(issues).values({
      id: childIssueId,
      companyId,
      parentId: parentIssueId,
      identifier: `CHI-${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      title: "Child implementation task",
      status: "todo",
      workMode: "standard",
      priority: "medium",
    });

    // Create the decomposition pointing to the accepted revision
    await db.insert(issuePlanDecompositions).values({
      companyId,
      sourceIssueId: parentIssueId,
      acceptedPlanRevisionId: acceptedRevision.id,
      status: "completed",
      requestFingerprint: `fp:${parentIssueId}:${acceptedRevision.id}`,
      requestedChildCount: 1,
      requestedChildren: [{ title: "Child task" }],
      childIssueIds: [childIssueId],
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    // Now create a NEW revision (v2) on the parent's plan - this should NOT affect the child's context
    await db
      .insert(documentRevisions)
      .values({
        companyId,
        documentId: parentDocument.id,
        revisionNumber: acceptedRevision.revisionNumber + 1,
        title: "Revised Plan v2",
        format: "markdown",
        body: "Revised plan v2 body - should not be seen by child",
        createdAt: new Date(),
      })
      .returning();

    // Update the document's latest to point to the new revision
    const [latestRevision] = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, parentDocument.id))
      .orderBy(documentRevisions.revisionNumber)
      .then((rows) => rows[rows.length - 1]!);

    await db
      .update(documents)
      .set({
        latestBody: "Revised plan v2 body - should not be seen by child",
        latestRevisionId: latestRevision.id,
        latestRevisionNumber: latestRevision.revisionNumber,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, parentDocument.id));

    // Build context for the child issue - should still reference the original accepted revision
    const context = await buildPlanReviewContext({
      db,
      companyId,
      issueId: childIssueId,
      issueWorkMode: "standard",
    });

    expect(context).not.toBeNull();
    expect(context?.parentPlanContext).toMatchObject({
      acceptedRevisionId: acceptedRevision.id,
      acceptedRevisionBody: "Accepted plan v1 body",
      acceptedRevisionBodyTruncated: false,
    });
    // Confirm the new revision is NOT in the context
    expect(context?.parentPlanContext?.acceptedRevisionId).not.toBe(latestRevision.id);
    expect(context?.parentPlanContext?.acceptedRevisionBody).not.toContain("Revised plan v2");
  });
});
