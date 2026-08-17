import { z } from "zod";

// ─── Memory Capabilities ────────────────────────────────────────────────────

export const memoryCapabilitiesSchema = z.object({
  profile: z.boolean().optional(),
  correction: z.boolean().optional(),
  multimodal: z.boolean().optional(),
  providerManagedExtraction: z.boolean().optional(),
  asyncExtraction: z.boolean().optional(),
  providerNativeBrowse: z.boolean().optional(),
});

export type MemoryCapabilitiesInput = z.infer<typeof memoryCapabilitiesSchema>;

// ─── Memory Binding Config ───────────────────────────────────────────────────

export const memoryBindingConfigSchema = z.object({
  providerType: z.string().min(1).max(128),
  configJson: z.record(z.unknown()).optional().default({}),
  capabilitiesJson: memoryCapabilitiesSchema.optional().default({}),
});

export type MemoryBindingConfigInput = z.infer<typeof memoryBindingConfigSchema>;

// ─── Target Type ────────────────────────────────────────────────────────────

export const memoryTargetTypeSchema = z.enum(["company", "agent"]);

// ─── Create/Update Memory Binding ───────────────────────────────────────────

export const createMemoryBindingSchema = z.object({
  key: z.string().min(1).max(128),
  providerType: z.string().min(1).max(128),
  configJson: z.record(z.unknown()).optional().default({}),
  capabilitiesJson: memoryCapabilitiesSchema.optional().default({}),
  enabled: z.boolean().optional().default(true),
});

export type CreateMemoryBinding = z.infer<typeof createMemoryBindingSchema>;

export const updateMemoryBindingSchema = z.object({
  providerType: z.string().min(1).max(128).optional(),
  configJson: z.record(z.unknown()).optional(),
  capabilitiesJson: memoryCapabilitiesSchema.optional(),
  enabled: z.boolean().optional(),
});

export type UpdateMemoryBinding = z.infer<typeof updateMemoryBindingSchema>;

// ─── Binding Target ─────────────────────────────────────────────────────────

export const createMemoryBindingTargetSchema = z.object({
  targetType: memoryTargetTypeSchema,
  targetId: z.string().uuid(),
  bindingId: z.string().uuid(),
  priority: z.number().int().optional().default(0),
});

export type CreateMemoryBindingTarget = z.infer<typeof createMemoryBindingTargetSchema>;

// ─── Query ──────────────────────────────────────────────────────────────────

export const resolveMemoryBindingQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
});

export type ResolveMemoryBindingQuery = z.infer<typeof resolveMemoryBindingQuerySchema>;

// ─── Memory Record Types ────────────────────────────────────────────────────

export const memoryRecordTypeSchema = z.enum([
  "auto_capture",
  "curated_note",
  "profile",
  "decision",
]);
export type MemoryRecordType = z.infer<typeof memoryRecordTypeSchema>;

export const memorySourceKindSchema = z.enum([
  "issue_comment",
  "issue_document",
  "issue",
  "run",
  "activity",
  "manual_note",
  "external_document",
]);
export type MemorySourceKind = z.infer<typeof memorySourceKindSchema>;

export const memoryScopeSchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  issueId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  subjectId: z.string().optional(),
  sessionKey: z.string().optional(),
  namespace: z.string().optional(),
});
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memorySourceRefSchema = z.object({
  kind: memorySourceKindSchema,
  companyId: z.string().uuid(),
  issueId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional(),
  documentKey: z.string().optional(),
  runId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
  externalRef: z.string().optional(),
});
export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>;

export const memoryRecordHandleSchema = z.object({
  providerKey: z.string(),
  providerRecordId: z.string(),
});
export type MemoryRecordHandle = z.infer<typeof memoryRecordHandleSchema>;

export const memoryUsageSchema = z.object({
  provider: z.string(),
  biller: z.string().optional(),
  model: z.string().optional(),
  billingType: z
    .enum([
      "metered_api",
      "subscription_included",
      "subscription_overage",
      "unknown",
    ])
    .optional(),
  attributionMode: z
    .enum([
      "billed_directly",
      "included_in_run",
      "external_invoice",
      "untracked",
    ])
    .optional(),
  inputTokens: z.number().int().optional(),
  cachedInputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  embeddingTokens: z.number().int().optional(),
  costCents: z.number().optional(),
  latencyMs: z.number().int().optional(),
});
export type MemoryUsage = z.infer<typeof memoryUsageSchema>;

// ─── Capture Request ────────────────────────────────────────────────────────

export const memoryCaptureRequestSchema = z.object({
  bindingKey: z.string().min(1),
  scope: memoryScopeSchema,
  source: memorySourceRefSchema,
  payload: z.object({
    text: z.string().optional(),
    mimeType: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  metadata: z.record(z.unknown()).optional(),
});
export type MemoryCaptureRequest = z.infer<typeof memoryCaptureRequestSchema>;

// ─── Record Write Request ───────────────────────────────────────────────────

export const memoryRecordWriteEntrySchema = z.object({
  text: z.string().min(1),
  summary: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const memoryRecordWriteRequestSchema = z.object({
  bindingKey: z.string().min(1),
  scope: memoryScopeSchema,
  source: memorySourceRefSchema.optional(),
  records: z.array(memoryRecordWriteEntrySchema).min(1).max(100),
});
export type MemoryRecordWriteRequest = z.infer<
  typeof memoryRecordWriteRequestSchema
>;

// ─── Query Request ──────────────────────────────────────────────────────────

export const memoryQueryRequestSchema = z.object({
  bindingKey: z.string().min(1),
  scope: memoryScopeSchema,
  query: z.string().min(1),
  topK: z.number().int().min(1).max(100).optional().default(10),
  intent: z
    .enum(["agent_preamble", "answer", "browse"])
    .optional()
    .default("answer"),
  metadataFilter: z.record(z.unknown()).optional(),
});
export type MemoryQueryRequest = z.infer<typeof memoryQueryRequestSchema>;

// ─── List Request ───────────────────────────────────────────────────────────

export const memoryListRequestSchema = z.object({
  bindingKey: z.string().min(1),
  scope: memoryScopeSchema,
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  metadataFilter: z.record(z.unknown()).optional(),
});
export type MemoryListRequest = z.infer<typeof memoryListRequestSchema>;

// ─── Response Schemas ───────────────────────────────────────────────────────

export const memorySnippetSchema = z.object({
  handle: memoryRecordHandleSchema,
  text: z.string(),
  score: z.number().optional(),
  summary: z.string().optional(),
  source: memorySourceRefSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type MemorySnippet = z.infer<typeof memorySnippetSchema>;

export const memoryContextBundleSchema = z.object({
  snippets: z.array(memorySnippetSchema),
  profileSummary: z.string().optional(),
  usage: z.array(memoryUsageSchema).optional(),
});
export type MemoryContextBundle = z.infer<typeof memoryContextBundleSchema>;

export const memoryListPageSchema = z.object({
  items: z.array(memorySnippetSchema),
  nextCursor: z.string().optional(),
  usage: z.array(memoryUsageSchema).optional(),
});
export type MemoryListPage = z.infer<typeof memoryListPageSchema>;

export const memoryBindingResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  key: z.string(),
  providerType: z.string(),
  configJson: z.record(z.unknown()),
  capabilitiesJson: z.record(z.unknown()),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MemoryBindingResponse = z.infer<typeof memoryBindingResponseSchema>;

export const memoryBindingTargetResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  targetType: memoryTargetTypeSchema,
  targetId: z.string().uuid(),
  bindingId: z.string().uuid(),
  priority: z.number(),
  createdAt: z.date(),
});

export type MemoryBindingTargetResponse = z.infer<typeof memoryBindingTargetResponseSchema>;

export const agentMemoryConfigSchema = z.object({
  bindingId: z.string().uuid(),
  bindingKey: z.string(),
  providerType: z.string(),
  enabled: z.boolean(),
  targetType: memoryTargetTypeSchema,
  capabilities: memoryCapabilitiesSchema,
  createdAt: z.string(),
});

export type AgentMemoryConfig = z.infer<typeof agentMemoryConfigSchema>;