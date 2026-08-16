import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const knowledgeDocumentStatusSchema = z.enum([
  "draft",
  "in_review",
  "published",
  "archived",
]);
export type KnowledgeDocumentStatus = z.infer<
  typeof knowledgeDocumentStatusSchema
>;

export const knowledgeReviewStatusSchema = z.enum([
  "pending",
  "approved",
  "changes_requested",
]);
export type KnowledgeReviewStatus = z.infer<typeof knowledgeReviewStatusSchema>;

export const knowledgeBacklinkSourceTypeSchema = z.enum([
  "originating_issue",
  "referenced_in_body",
]);
export type KnowledgeBacklinkSourceType = z.infer<
  typeof knowledgeBacklinkSourceTypeSchema
>;

// ─── Create Request ─────────────────────────────────────────────────────────

export const knowledgeDocumentCreateSchema = z.object({
  title: z.string().min(1).max(500),
  summary: z.string().max(2000).optional(),
  body: z.string().optional().default(""),
  sourceIssueId: z.string().uuid().optional(),
});
export type KnowledgeDocumentCreate = z.infer<
  typeof knowledgeDocumentCreateSchema
>;

// ─── Update Request ─────────────────────────────────────────────────────────

export const knowledgeDocumentUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  summary: z.string().max(2000).optional(),
  body: z.string().optional(),
});
export type KnowledgeDocumentUpdate = z.infer<
  typeof knowledgeDocumentUpdateSchema
>;

// ─── Publish Request ────────────────────────────────────────────────────────

export const knowledgeDocumentPublishSchema = z.object({
  changeDescription: z.string().max(2000).optional(),
});
export type KnowledgeDocumentPublish = z.infer<
  typeof knowledgeDocumentPublishSchema
>;

// ─── Submit Review Request ──────────────────────────────────────────────────

export const knowledgeDocumentSubmitReviewSchema = z.object({
  reviewerAgentId: z.string().uuid().optional(),
});
export type KnowledgeDocumentSubmitReview = z.infer<
  typeof knowledgeDocumentSubmitReviewSchema
>;

// ─── Review Decision ────────────────────────────────────────────────────────

export const knowledgeDocumentReviewDecisionSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  comment: z.string().max(5000).optional(),
});
export type KnowledgeDocumentReviewDecision = z.infer<
  typeof knowledgeDocumentReviewDecisionSchema
>;

// ─── List Query ─────────────────────────────────────────────────────────────

export const knowledgeDocumentListQuerySchema = z.object({
  status: knowledgeDocumentStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().max(500).optional(),
});
export type KnowledgeDocumentListQuery = z.infer<
  typeof knowledgeDocumentListQuerySchema
>;

// ─── Backlink Request ───────────────────────────────────────────────────────

export const knowledgeCreateBacklinkSchema = z.object({
  sourceIssueId: z.string().uuid(),
  sourceType: knowledgeBacklinkSourceTypeSchema.optional().default("referenced_in_body"),
});
export type KnowledgeCreateBacklink = z.infer<
  typeof knowledgeCreateBacklinkSchema
>;

// ─── Response / List Item Schema ───────────────────────────────────────────

export const knowledgeDocumentListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  summary: z.string().optional(),
  status: knowledgeDocumentStatusSchema,
  version: z.number(),
  authorAgentId: z.string().uuid().optional(),
  sourceIssueId: z.string().uuid().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().optional(),
  revisionCount: z.number(),
  latestReviewStatus: knowledgeReviewStatusSchema.optional(),
});
export type KnowledgeDocumentListItem = z.infer<
  typeof knowledgeDocumentListItemSchema
>;

export const knowledgeDocumentListPageSchema = z.object({
  items: z.array(knowledgeDocumentListItemSchema),
  nextCursor: z.string().optional(),
  total: z.number().optional(),
});
export type KnowledgeDocumentListPage = z.infer<
  typeof knowledgeDocumentListPageSchema
>;

// ─── Diff Response ─────────────────────────────────────────────────────────

export const knowledgeDocumentDiffSchema = z.object({
  oldVersion: z.number(),
  newVersion: z.number(),
  titleChanged: z.boolean(),
  oldTitle: z.string().optional(),
  newTitle: z.string(),
  summaryChanged: z.boolean(),
  oldSummary: z.string().optional(),
  newSummary: z.string().optional(),
  bodyDiff: z.string(),
  changeDescription: z.string().optional(),
});
export type KnowledgeDocumentDiff = z.infer<
  typeof knowledgeDocumentDiffSchema
>;