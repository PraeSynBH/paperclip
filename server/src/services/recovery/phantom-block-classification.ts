/**
 * Classification for the "blocked with no blocker edges" sweep (RBR-809 / RBR-824).
 *
 * The naive predicate — `blocked` + zero blocker edges => unblock — is unsafe. The
 * population is not homogeneous: some of those issues are genuinely gated on a human
 * (a pending interaction nobody but a person can answer), and some have a real
 * dependency that was described in prose but never edged. Blanket-unblocking hands
 * work to an agent that cannot perform it, which then spins or falsely closes.
 *
 * This module is a pure function so the buckets can be regression-tested without a DB
 * and so the sweep can run dry before it mutates anything.
 */

/** Interaction kinds a *user* comment silently expires (see RBR-823). */
const USER_COMMENT_SUPERSEDABLE_INTERACTION_KINDS = [
  "request_confirmation",
  "request_checkbox_confirmation",
  "ask_user_questions",
] as const;

export type PhantomBlockBucket =
  /** Has real unresolved blocker edges. Not a phantom; leave it alone. */
  | "real_blocker"
  /** Prose names an open blocker that was never edged. Create the edge, keep `blocked`. */
  | "missing_edge"
  /** Gated on a human (pending interaction / human owner). Move to `in_review`. NEVER unblock. */
  | "human_gated"
  /** No gate of any kind. Genuinely stranded: give it a wake path. */
  | "stranded";

export type PhantomBlockAction =
  | "none"
  | "create_blocker_edge"
  | "move_to_in_review"
  | "assign_and_wake";

export interface PhantomBlockInteractionInput {
  id: string;
  issueId: string;
  kind: string;
  status: string;
  /** `payload.supersedeOnUserComment`; defaults to true for supersedable kinds. */
  supersedeOnUserComment?: boolean | null;
}

export interface PhantomBlockIssueInput {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  /**
   * NOT a human-owner signal and NOT a wake path (RBR-809 Finding B, RBR-849).
   *
   * Measured across all 842 RBR issues: populated 842/842 with exactly one distinct
   * value. It is a constant, so it carries zero information and must never take part
   * in a discriminator. It is retained on the input purely so the variance check can
   * observe it and keep proving that.
   */
  responsibleUserId?: string | null;
  /** Unresolved (not done/cancelled) first-class `blocks` edges pointing at this issue. */
  unresolvedBlockerCount?: number | null;
  /**
   * Issue identifiers named in prose (description/comments) as blocking this issue.
   * The caller resolves prose -> identifiers; this module only decides what to do.
   */
  proseBlockerIdentifiers?: string[];
}

export interface PhantomBlockClassificationInput {
  issues: PhantomBlockIssueInput[];
  /** All pending interactions across the issues under analysis. */
  pendingInteractions?: PhantomBlockInteractionInput[];
  /**
   * Identifier -> status for every issue referenced in prose, so a prose mention of an
   * already-`done` issue is not mistaken for a live dependency.
   */
  issueStatusByIdentifier?: Record<string, string>;
  /**
   * True once RBR-823 has shipped (board comments no longer expire every pending
   * interaction). Until then a pending interaction is a *fragile* wake path and
   * bucket-2 mutations must not be auto-applied.
   */
  interactionWakePathIsDurable?: boolean;
}

export interface PhantomBlockClassification {
  issueId: string;
  identifier: string | null;
  bucket: PhantomBlockBucket;
  action: PhantomBlockAction;
  /** The status the sweep would write. `null` means "do not touch status". */
  targetStatus: string | null;
  reason: string;
  /** Hard invariant: bucket 2 and 3 must never be unblocked. */
  unblocks: boolean;
  /** True whenever a human — not an agent — owns the next action. */
  humanGated: boolean;
  pendingInteractionIds: string[];
  /** Prose-named blockers that are still open and have no edge yet. */
  missingBlockerIdentifiers: string[];
  /**
   * False when the only wake path is a pending interaction that a board comment would
   * silently expire (RBR-823). Such a classification is advisory only.
   */
  wakePathDurable: boolean;
  /** When true the sweep must emit this row for review instead of applying it. */
  requiresManualReview: boolean;
}

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

function isSupersedableKind(kind: string) {
  return (USER_COMMENT_SUPERSEDABLE_INTERACTION_KINDS as readonly string[]).includes(kind);
}

/** A pending interaction survives an unrelated board comment only if it is not supersedable. */
export function interactionSurvivesUserComment(interaction: PhantomBlockInteractionInput) {
  if (!isSupersedableKind(interaction.kind)) return true;
  return interaction.supersedeOnUserComment === false;
}

function label(issue: PhantomBlockIssueInput) {
  return issue.identifier ?? issue.id;
}

export function classifyPhantomBlockedIssues(
  input: PhantomBlockClassificationInput,
): PhantomBlockClassification[] {
  const statusByIdentifier = input.issueStatusByIdentifier ?? {};
  const durableInteractions = input.interactionWakePathIsDurable === true;

  const pendingByIssueId = new Map<string, PhantomBlockInteractionInput[]>();
  for (const interaction of input.pendingInteractions ?? []) {
    if (interaction.status !== "pending") continue;
    const list = pendingByIssueId.get(interaction.issueId) ?? [];
    list.push(interaction);
    pendingByIssueId.set(interaction.issueId, list);
  }

  return input.issues.map((issue) => {
    const pending = pendingByIssueId.get(issue.id) ?? [];
    const pendingIds = pending.map((interaction) => interaction.id);
    // RBR-849: `responsibleUserId` is deliberately absent here. It is populated on every
    // issue in the company with the same value, so including it made `hasHumanOwner`
    // unconditionally true — which buried 29 stranded issues in `in_review` and made the
    // RBR-823 fragility interlock below unreachable dead code.
    const hasHumanOwner = Boolean(issue.assigneeUserId);
    const humanGated = pending.length > 0 || hasHumanOwner;

    const missingBlockerIdentifiers = (issue.proseBlockerIdentifiers ?? []).filter((identifier) => {
      if (identifier === issue.identifier) return false;
      const status = statusByIdentifier[identifier];
      // Unknown identifiers are not assumed to be live dependencies.
      return typeof status === "string" && !TERMINAL_ISSUE_STATUSES.has(status);
    });

    const base = {
      issueId: issue.id,
      identifier: issue.identifier,
      humanGated,
      pendingInteractionIds: pendingIds,
      missingBlockerIdentifiers,
    };

    // Bucket 0: it has real edges. Not a phantom at all.
    if ((issue.unresolvedBlockerCount ?? 0) > 0) {
      return {
        ...base,
        bucket: "real_blocker" as const,
        action: "none" as const,
        targetStatus: null,
        unblocks: false,
        reason: `${label(issue)} has ${issue.unresolvedBlockerCount} unresolved blocker edge(s); correctly blocked.`,
        wakePathDurable: true,
        requiresManualReview: false,
      };
    }

    // Bucket 3: a real dependency exists in prose but was never edged. Edge it, stay blocked.
    // Evaluated before the human gate because creating an edge is additive and never
    // removes a wake path, and because `blocked` is already the correct status here.
    if (missingBlockerIdentifiers.length > 0) {
      return {
        ...base,
        bucket: "missing_edge" as const,
        action: "create_blocker_edge" as const,
        targetStatus: "blocked",
        unblocks: false,
        reason:
          `${label(issue)} describes an open dependency in prose (${missingBlockerIdentifiers.join(", ")}) ` +
          "that was never recorded as a blocker edge. Create the edge and keep it blocked.",
        wakePathDurable: true,
        requiresManualReview: false,
      };
    }

    // Bucket 2: human gate, wrong status. Do NOT unblock — an agent cannot do this work.
    if (humanGated) {
      const fragile = pending.length > 0 &&
        !durableInteractions &&
        !hasHumanOwner &&
        pending.every((interaction) => !interactionSurvivesUserComment(interaction));
      return {
        ...base,
        bucket: "human_gated" as const,
        action: "move_to_in_review" as const,
        targetStatus: "in_review",
        unblocks: false,
        reason: pending.length > 0
          ? `${label(issue)} has ${pending.length} pending interaction(s) only a human can answer. ` +
            "The status was the wrong word, not the wrong state: move to in_review and leave the " +
            "interaction as the wake path."
          : `${label(issue)} is owned by a human, not an agent. Move to in_review; the owner is the wake path.`,
        wakePathDurable: !fragile,
        requiresManualReview: fragile,
      };
    }

    // Bucket 1: no gate at all. Genuinely stranded — give it a wake path.
    return {
      ...base,
      bucket: "stranded" as const,
      action: "assign_and_wake" as const,
      targetStatus: "todo",
      unblocks: true,
      reason: `${label(issue)} has no blocker edge, no pending interaction, and no human owner; it is stranded.`,
      wakePathDurable: true,
      requiresManualReview: !issue.assigneeAgentId,
    };
  });
}

export interface PhantomBlockSweepSummary {
  total: number;
  byBucket: Record<PhantomBlockBucket, number>;
  unblockCount: number;
  requiresManualReviewCount: number;
  fragileWakePathCount: number;
}

export function summarizePhantomBlockClassifications(
  classifications: PhantomBlockClassification[],
): PhantomBlockSweepSummary {
  const byBucket: Record<PhantomBlockBucket, number> = {
    real_blocker: 0,
    missing_edge: 0,
    human_gated: 0,
    stranded: 0,
  };
  let unblockCount = 0;
  let requiresManualReviewCount = 0;
  let fragileWakePathCount = 0;

  for (const row of classifications) {
    byBucket[row.bucket] += 1;
    if (row.unblocks) unblockCount += 1;
    if (row.requiresManualReview) requiresManualReviewCount += 1;
    if (!row.wakePathDurable) fragileWakePathCount += 1;
  }

  return {
    total: classifications.length,
    byBucket,
    unblockCount,
    requiresManualReviewCount,
    fragileWakePathCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Discriminator variance guard (RBR-849 AC 3)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Guard the class, not the instance.
 *
 * RBR-849: the classifier trusted `responsibleUserId` as a human-owner signal. That
 * field is populated on 842/842 issues with a single distinct value — a constant. A
 * constant used as a discriminator does not classify; it forces one branch for the
 * whole population and silently disables everything downstream of it (here: 29 stranded
 * issues buried in `in_review`, and an unreachable RBR-823 interlock).
 *
 * The general rule: before a field is allowed to decide anything, it must be shown to
 * vary across the population it is deciding over. Zero variance is a defect in the
 * discriminator, not a finding about the data — so it fails loudly.
 */
export interface DiscriminatorVarianceReport {
  field: string;
  /** Issues in the population. */
  total: number;
  /** Issues where the field is non-null / non-empty. */
  populated: number;
  /** Distinct non-null values observed. */
  distinctValues: number;
  /**
   * True when the field takes the exact same non-null value on every issue in the
   * population. Such a field is a constant and cannot discriminate.
   */
  isConstant: boolean;
  /**
   * True when the field never varies at all — either constant-populated (above) or
   * absent everywhere. Absent-everywhere is inert rather than dangerous, so it is
   * reported but not fatal.
   */
  hasZeroVariance: boolean;
}

/** Fields the classifier is allowed to branch on. Each must be shown to vary. */
export const CLASSIFIER_DISCRIMINATOR_FIELDS = [
  "assigneeUserId",
  "assigneeAgentId",
  "unresolvedBlockerCount",
] as const;

export type ClassifierDiscriminatorField = (typeof CLASSIFIER_DISCRIMINATOR_FIELDS)[number];

function discriminatorValue(issue: PhantomBlockIssueInput, field: string): unknown {
  const value = (issue as unknown as Record<string, unknown>)[field];
  if (value === null || value === undefined || value === "") return null;
  return value;
}

/**
 * Measure the variance of each named field across the population. Pure and allocation
 * -cheap: one pass, one Set per field.
 */
export function analyzeDiscriminatorVariance(
  issues: PhantomBlockIssueInput[],
  fields: readonly string[] = CLASSIFIER_DISCRIMINATOR_FIELDS,
): DiscriminatorVarianceReport[] {
  return fields.map((field) => {
    const distinct = new Set<unknown>();
    let populated = 0;
    for (const issue of issues) {
      const value = discriminatorValue(issue, field);
      if (value === null) continue;
      populated += 1;
      distinct.add(value);
    }
    const total = issues.length;
    const isConstant = total > 0 && populated === total && distinct.size === 1;
    return {
      field,
      total,
      populated,
      distinctValues: distinct.size,
      isConstant,
      hasZeroVariance: isConstant || populated === 0,
    };
  });
}

export class ConstantDiscriminatorError extends Error {
  readonly reports: DiscriminatorVarianceReport[];

  constructor(reports: DiscriminatorVarianceReport[]) {
    const detail = reports
      .map(
        (report) =>
          `${report.field}: populated ${report.populated}/${report.total}, ` +
          `${report.distinctValues} distinct value(s)`,
      )
      .join("; ");
    super(
      "Refusing to classify on a constant discriminator (RBR-849). " +
        `${detail}. A field with one distinct value across the whole population carries ` +
        "zero information: branching on it forces a single bucket and disables every " +
        "guard downstream of it. Remove the field from the discriminator or explain why " +
        "the constant is meaningful.",
    );
    this.name = "ConstantDiscriminatorError";
    this.reports = reports;
  }
}

/**
 * Fail loudly when any trusted discriminator is a constant across the population.
 *
 * Populations of 0 or 1 are skipped — variance is not measurable there, and the sweep's
 * unit tests deliberately classify single synthetic issues.
 */
export function assertDiscriminatorVariance(
  issues: PhantomBlockIssueInput[],
  fields: readonly string[] = CLASSIFIER_DISCRIMINATOR_FIELDS,
  options: { minimumPopulation?: number } = {},
): DiscriminatorVarianceReport[] {
  const reports = analyzeDiscriminatorVariance(issues, fields);
  const minimumPopulation = options.minimumPopulation ?? 2;
  if (issues.length < minimumPopulation) return reports;

  const constants = reports.filter((report) => report.isConstant);
  if (constants.length > 0) throw new ConstantDiscriminatorError(constants);
  return reports;
}
