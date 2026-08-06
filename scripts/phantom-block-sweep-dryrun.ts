#!/usr/bin/env tsx
/**
 * RBR-809 / RBR-824 phantom-block sweep — DRY RUN BY DEFAULT.
 *
 * Finds every `blocked` issue with zero unresolved blocker edges and classifies it into
 * the buckets defined in server/src/services/recovery/phantom-block-classification.ts:
 *
 *   real_blocker  -> has edges after all; leave alone
 *   missing_edge  -> prose names an open blocker that was never edged; create edge, stay blocked
 *   human_gated   -> >=1 pending interaction or a human owner; move to in_review, NEVER unblock
 *   stranded      -> no gate at all; assign + wake
 *
 * The bucket discriminator is mechanical: GET /issues/{id}/interactions, one call per issue,
 * any row with status == "pending".
 *
 * This script NEVER mutates. It emits the full classification for review (RBR-824 AC 3).
 * Applying the classification is a separate, explicitly-gated step that must not ship before
 * RBR-823 lands, because until then a board comment silently expires every pending
 * interaction and destroys the bucket-2 wake path.
 *
 * Usage:
 *   PAPERCLIP_API_URL=... PAPERCLIP_API_KEY=... PAPERCLIP_COMPANY_ID=... \
 *     tsx scripts/phantom-block-sweep-dryrun.ts [--json out.json]
 */

import { writeFileSync } from "node:fs";
import {
  analyzeDiscriminatorVariance,
  assertDiscriminatorVariance,
  classifyPhantomBlockedIssues,
  CLASSIFIER_DISCRIMINATOR_FIELDS,
  summarizePhantomBlockClassifications,
  type PhantomBlockClassification,
  type PhantomBlockInteractionInput,
  type PhantomBlockIssueInput,
} from "../server/src/services/recovery/phantom-block-classification.ts";

const RAW_API = process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100";
const API = /\/api$/.test(RAW_API.replace(/\/$/, ""))
  ? RAW_API.replace(/\/$/, "")
  : `${RAW_API.replace(/\/$/, "")}/api`;
const KEY = process.env.PAPERCLIP_API_KEY ?? "";
const COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID ?? "";

if (!KEY) throw new Error("PAPERCLIP_API_KEY is required");
if (!COMPANY_ID) throw new Error("PAPERCLIP_COMPANY_ID is required");

/** Prose that names a blocker, e.g. "blocked by RBR-813" / "depends on RBR-805". */
const PROSE_BLOCKER_RE =
  /(?:blocked\s+(?:by|on)|blocker[:\s]+|depends\s+on|dependent\s+on|waiting\s+on|gated\s+(?:by|on)|behind)\s+((?:[A-Z]{2,5}-\d+[,\s/and]*)+)/gi;
const IDENTIFIER_RE = /[A-Z]{2,5}-\d+/g;

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function apiSoft<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}

interface ApiIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  description?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  responsibleUserId?: string | null;
  blockerAttention?: { unresolvedBlockerCount?: number } | null;
  blockedBy?: Array<{ id: string; identifier: string | null; status: string }>;
}

interface ApiInteraction {
  id: string;
  kind: string;
  status: string;
  payload?: { supersedeOnUserComment?: boolean } | null;
}

interface ApiComment {
  id: string;
  content?: string | null;
  body?: string | null;
}

function extractProseBlockers(text: string, self: string | null): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PROSE_BLOCKER_RE)) {
    for (const identifier of match[1].match(IDENTIFIER_RE) ?? []) {
      if (identifier !== self) found.add(identifier);
    }
  }
  return [...found];
}

/** Bounded-concurrency map. The board API is slow; serial scanning does not finish. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const CONCURRENCY = Number(process.env.PHANTOM_SWEEP_CONCURRENCY ?? 8);

async function main() {
  // The list payload already carries description, assignees and
  // blockerAttention.unresolvedBlockerCount, so no per-issue detail call is needed.
  const [all, board] = await Promise.all([
    api<ApiIssue[]>(`/companies/${COMPANY_ID}/issues?status=blocked&limit=500`),
    api<ApiIssue[]>(`/companies/${COMPANY_ID}/issues?limit=1000`),
  ]);

  // Status for every issue on the board, so prose mentions of done work are not
  // mistaken for live dependencies.
  const statusByIdentifier: Record<string, string> = {};
  for (const row of [...board, ...all]) {
    if (row.identifier) statusByIdentifier[row.identifier] = row.status;
  }

  console.error(`Scanning ${all.length} blocked issues at concurrency ${CONCURRENCY}...`);

  const pendingInteractions: PhantomBlockInteractionInput[] = [];
  let scanned = 0;

  const issues: PhantomBlockIssueInput[] = await mapPool(all, CONCURRENCY, async (row) => {
    // Mechanical bucket discriminator: one interactions call per issue (RBR-824 AC 2).
    const [interactions, comments] = await Promise.all([
      apiSoft<ApiInteraction[]>(`/issues/${row.id}/interactions`, []),
      apiSoft<ApiComment[]>(`/issues/${row.id}/comments`, []),
    ]);

    for (const interaction of Array.isArray(interactions) ? interactions : []) {
      if (interaction.status !== "pending") continue;
      pendingInteractions.push({
        id: interaction.id,
        issueId: row.id,
        kind: interaction.kind,
        status: interaction.status,
        supersedeOnUserComment: interaction.payload?.supersedeOnUserComment ?? null,
      });
    }

    const prose = [
      row.description ?? "",
      ...(Array.isArray(comments) ? comments.map((c) => c.content ?? c.body ?? "") : []),
    ].join("\n");

    scanned += 1;
    if (scanned % 10 === 0) console.error(`  ...${scanned}/${all.length}`);

    return {
      id: row.id,
      identifier: row.identifier,
      title: row.title,
      status: row.status,
      assigneeAgentId: row.assigneeAgentId ?? null,
      assigneeUserId: row.assigneeUserId ?? null,
      responsibleUserId: row.responsibleUserId ?? null,
      unresolvedBlockerCount: row.blockerAttention?.unresolvedBlockerCount ?? 0,
      proseBlockerIdentifiers: extractProseBlockers(prose, row.identifier),
    };
  });

  const classifications = classifyPhantomBlockedIssues({
    issues,
    pendingInteractions,
    issueStatusByIdentifier: statusByIdentifier,
    // RBR-823 has not shipped: a board comment still expires pending interactions.
    interactionWakePathIsDurable: false,
  });

  const summary = summarizePhantomBlockClassifications(classifications);

  // RBR-849 AC 3: guard the class, not the instance. Any field the classifier branches
  // on must be shown to vary across the population before its output is trusted. A
  // constant discriminator forces one bucket for everyone and silently disables every
  // guard downstream of it — that is exactly how `responsibleUserId` buried 29 issues
  // and turned the RBR-823 interlock into dead code.
  console.log("=== discriminator variance (RBR-849 AC 3) ===\n");
  const auditedFields = [...CLASSIFIER_DISCRIMINATOR_FIELDS, "responsibleUserId"];
  for (const report of analyzeDiscriminatorVariance(issues, auditedFields)) {
    const verdict = report.isConstant
      ? "CONSTANT — carries zero information, must not discriminate"
      : report.populated === 0
        ? "absent across the population (inert)"
        : "varies";
    const trusted = (CLASSIFIER_DISCRIMINATOR_FIELDS as readonly string[]).includes(report.field);
    console.log(
      `  ${report.field.padEnd(22)} populated ${String(report.populated).padStart(4)}/${report.total}` +
      `  distinct ${String(report.distinctValues).padStart(4)}  ${trusted ? "[trusted] " : "[excluded] "}${verdict}`,
    );
  }
  console.log("");

  // Fails loudly rather than classifying on a constant.
  assertDiscriminatorVariance(issues);

  console.log("=== RBR-824 phantom-block sweep — DRY RUN (no mutations) ===\n");
  console.log(`blocked issues scanned : ${summary.total}`);
  console.log(`real_blocker           : ${summary.byBucket.real_blocker}  (leave alone)`);
  console.log(`missing_edge           : ${summary.byBucket.missing_edge}  (create edge, stay blocked)`);
  console.log(`human_gated            : ${summary.byBucket.human_gated}  (-> in_review, NEVER unblock)`);
  console.log(`stranded               : ${summary.byBucket.stranded}  (assign + wake)`);
  console.log(`would unblock          : ${summary.unblockCount}`);
  console.log(`needs manual review    : ${summary.requiresManualReviewCount}`);
  console.log(`fragile wake path      : ${summary.fragileWakePathCount}  (RBR-823 hazard)\n`);

  const order: PhantomBlockClassification["bucket"][] = [
    "human_gated",
    "missing_edge",
    "stranded",
    "real_blocker",
  ];
  for (const bucket of order) {
    const rows = classifications.filter((row) => row.bucket === bucket);
    if (rows.length === 0) continue;
    console.log(`--- ${bucket} (${rows.length}) ---`);
    for (const row of rows) {
      const flags = [
        row.unblocks ? "UNBLOCKS" : null,
        row.requiresManualReview ? "MANUAL" : null,
        row.wakePathDurable ? null : "FRAGILE",
      ].filter(Boolean).join(",");
      console.log(
        `  ${row.identifier ?? row.issueId}  action=${row.action}  status=${row.targetStatus ?? "-"}` +
        `${flags ? `  [${flags}]` : ""}`,
      );
      console.log(`      ${row.reason}`);
    }
    console.log("");
  }

  const jsonFlagIndex = process.argv.indexOf("--json");
  if (jsonFlagIndex !== -1 && process.argv[jsonFlagIndex + 1]) {
    const out = process.argv[jsonFlagIndex + 1];
    writeFileSync(out, JSON.stringify({ summary, classifications }, null, 2));
    console.log(`Wrote ${out}`);
  }

  console.log("DRY RUN ONLY — nothing was mutated. Do not auto-apply (RBR-824 AC 3).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
