import { z } from "zod";
import {
  PLAN_MILESTONE_STATUSES,
  PLAN_DOCUMENT_STATUSES,
  PLAN_REVIEW_GATE_STATUSES,
} from "../constants.js";

// ─── Plan Section ──────────────────────────────────────────────────────────

export const planSectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(524288),
  order: z.number().int().min(0),
});
export type PlanSection = z.infer<typeof planSectionSchema>;

// ─── Plan Milestone ────────────────────────────────────────────────────────

export const planMilestoneSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(PLAN_MILESTONE_STATUSES).default("pending"),
  order: z.number().int().min(0),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
});
export type PlanMilestone = z.infer<typeof planMilestoneSchema>;

// ─── Plan Metadata ─────────────────────────────────────────────────────────

export const planMetadataSchema = z.object({
  sections: z.array(planSectionSchema).max(100).default([]),
  milestones: z.array(planMilestoneSchema).max(50).default([]),
  status: z.enum(PLAN_DOCUMENT_STATUSES).default("draft"),
  version: z.literal(1),
});
export type PlanMetadata = z.infer<typeof planMetadataSchema>;

// ─── Plan Review Gate ──────────────────────────────────────────────────────

export const planReviewGateSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  documentId: z.string().uuid(),
  revisionId: z.string().uuid(),
  milestoneId: z.string().nullable().optional(),
  status: z.enum(PLAN_REVIEW_GATE_STATUSES).default("pending"),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
  assignedAgentId: z.string().uuid().nullable().optional(),
  createdByAgentId: z.string().uuid().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  resolvedByAgentId: z.string().uuid().nullable().optional(),
  resolvedByUserId: z.string().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  resolutionComment: z.string().max(4000).nullable().optional(),
  supersededByGateId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PlanReviewGate = z.infer<typeof planReviewGateSchema>;

// ─── UPSERT Plan Document ──────────────────────────────────────────────────

export const upsertPlanDocumentSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().max(524288),
  changeSummary: z.string().trim().max(500).nullable().optional(),
  baseRevisionId: z.string().uuid().nullable().optional(),
  planMetadata: planMetadataSchema.nullable().optional(),
});
export type UpsertPlanDocument = z.infer<typeof upsertPlanDocumentSchema>;

// ─── Create Review Gate ────────────────────────────────────────────────────

export const createPlanReviewGateSchema = z.object({
  milestoneId: z.string().nullable().optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
  assignedAgentId: z.string().uuid().nullable().optional(),
});
export type CreatePlanReviewGate = z.infer<typeof createPlanReviewGateSchema>;

// ─── Resolve Review Gate ───────────────────────────────────────────────────

export const resolvePlanReviewGateSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  resolutionComment: z.string().max(4000).nullable().optional(),
});
export type ResolvePlanReviewGate = z.infer<typeof resolvePlanReviewGateSchema>;

// ─── Plan Diff ─────────────────────────────────────────────────────────────

export const planDiffQuerySchema = z.object({
  againstRevisionId: z.string().uuid(),
});
export type PlanDiffQuery = z.infer<typeof planDiffQuerySchema>;

// ─── Plan Gates Query ──────────────────────────────────────────────────────

export const planGatesQuerySchema = z.object({
  revisionId: z.string().uuid().optional(),
});
export type PlanGatesQuery = z.infer<typeof planGatesQuerySchema>;
