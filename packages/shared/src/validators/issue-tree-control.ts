import { z } from "zod";
import {
  ISSUE_TREE_CONTROL_MODES,
  ISSUE_TREE_HOLD_RELEASE_POLICY_STRATEGIES,
} from "../constants.js";

export const issueTreeControlModeSchema = z.enum(ISSUE_TREE_CONTROL_MODES);

export const issueTreeHoldReleasePolicySchema = z
  .object({
    strategy: z.enum(ISSUE_TREE_HOLD_RELEASE_POLICY_STRATEGIES).default("manual"),
    note: z.string().trim().min(1).max(500).optional().nullable(),
  })
  .strict();

export const previewIssueTreeControlSchema = z
  .object({
    mode: issueTreeControlModeSchema,
    releasePolicy: issueTreeHoldReleasePolicySchema.optional().nullable(),
  })
  .strict();

export type PreviewIssueTreeControl = z.infer<typeof previewIssueTreeControlSchema>;

export const createIssueTreeHoldSchema = z
  .object({
    mode: issueTreeControlModeSchema,
    reason: z.string().trim().min(1).max(1000).optional().nullable(),
    releasePolicy: issueTreeHoldReleasePolicySchema.optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .strict();

export type CreateIssueTreeHold = z.infer<typeof createIssueTreeHoldSchema>;

export const releaseIssueTreeHoldSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional().nullable(),
    releasePolicy: issueTreeHoldReleasePolicySchema.optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .strict();

export type ReleaseIssueTreeHold = z.infer<typeof releaseIssueTreeHoldSchema>;

export const overrideReleaseIssueTreeHoldSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .strict();

export type OverrideReleaseIssueTreeHold = z.infer<typeof overrideReleaseIssueTreeHoldSchema>;

export const reassignAgentIssuesSchema = z
  .object({
    assigneeAgentId: z.string().uuid().optional().nullable(),
    assigneeUserId: z.string().uuid().optional().nullable(),
    reason: z.string().trim().min(1).max(1000).optional().nullable(),
    releasePauseHolds: z.boolean().optional().default(false),
  })
  .strict()
  .refine(
    (data) => data.assigneeAgentId || data.assigneeUserId,
    { message: "At least one of assigneeAgentId or assigneeUserId is required" },
  );

export type ReassignAgentIssues = z.infer<typeof reassignAgentIssuesSchema>;

export const forceReassignSchema = z
  .object({
    expectedVersion: z.number().int().min(0).optional().nullable(),
    fromAssigneeAgentId: z.string().uuid().optional().nullable(),
    assigneeAgentId: z.string().uuid().optional().nullable(),
    assigneeUserId: z.string().uuid().optional().nullable(),
    idempotencyKey: z.string().trim().min(1).max(128).optional().nullable(),
    reason: z.string().trim().min(1).max(2000).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .strict();

export type ForceReassign = z.infer<typeof forceReassignSchema>;
