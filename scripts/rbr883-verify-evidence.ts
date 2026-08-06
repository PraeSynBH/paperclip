/**
 * RBR-883 verification — Drata evidence resource is workspace-scoped
 * `/workspaces/{id}/evidence-library`, not `/evidence`.
 *
 * Proves, live against the Aira Drata account with the read-only key:
 *   1. `getAllEvidence()` returns records without throwing.
 *   2. The `DrataEvidence` type matches the real payload (no phantom
 *      `status` / `lastCollectedAt` / `renewalDate` / `collectionMethod`).
 *   3. `EvidenceIngestionPipeline.run()` no longer produces
 *      `status: undefined` / `controlId: 0` for every evidence record.
 *
 * Run: npx tsx scripts/rbr883-verify-evidence.ts
 */
import { DrataClient } from "../src/drata/client.js";
import {
  evidenceCollectedAt,
  evidenceControlIds,
  evidenceRenewalDate,
} from "../src/drata/helpers.js";
import { EvidenceIngestionPipeline } from "../src/pipeline/ingestion.js";

let failures = 0;

function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const client = new DrataClient();

  const workspaceId = await client.getWorkspaceId();
  console.log(`workspace id: ${workspaceId}\n`);

  // 1. Path fix -----------------------------------------------------------
  const page = await client.listEvidence({ size: 1 });
  check(
    "GET /workspaces/{id}/evidence-library returns 200",
    Array.isArray(page.data),
    `totalCount=${page.pagination?.totalCount ?? "?"}`
  );

  const evidence = await client.getAllEvidence();
  check(
    "getAllEvidence() paginates without throwing",
    evidence.length > 0,
    `${evidence.length} records`
  );

  // 2. Type shape ---------------------------------------------------------
  const sample = evidence[0] as unknown as Record<string, unknown>;
  const phantomFields = [
    "status",
    "lastCollectedAt",
    "renewalDate",
    "collectionMethod",
    "workspaceId",
  ].filter((f) => f in sample);
  check(
    "legacy /evidence fields absent from real payload",
    phantomFields.length === 0,
    phantomFields.length ? `unexpectedly present: ${phantomFields.join(", ")}` : "confirmed"
  );

  for (const field of ["id", "name", "createdAt", "updatedAt"]) {
    check(`payload carries \`${field}\``, field in sample, String(sample[field]).slice(0, 40));
  }

  const withVersions = evidence.filter((e) => (e.versions?.length ?? 0) > 0).length;
  const withRenewal = evidence.filter((e) => e.renewalSchema !== undefined).length;
  const withControls = evidence.filter((e) => (e.controls?.length ?? 0) > 0).length;
  const distinctControls = new Set(evidence.flatMap((e) => evidenceControlIds(e)));
  check(
    "expand[]=renewalSchemaAndVersions hydrated",
    withVersions > 0 && withRenewal > 0,
    `versions on ${withVersions}, renewalSchema on ${withRenewal}`
  );
  check(
    "expand[]=controls hydrated",
    withControls > 0,
    `${withControls} entries link to ${distinctControls.size} distinct controls`
  );

  // 3. Derived fields resolve --------------------------------------------
  const collectedResolved = evidence.filter((e) => evidenceCollectedAt(e) !== null).length;
  const renewalResolved = evidence.filter((e) => evidenceRenewalDate(e) !== null).length;
  check(
    "evidenceCollectedAt() derives a timestamp for every record",
    collectedResolved === evidence.length,
    `${collectedResolved}/${evidence.length}`
  );
  console.log(
    `note  evidenceRenewalDate() non-null for ${renewalResolved}/${evidence.length} ` +
      `(renewalScheduleType NONE => null is expected)`
  );

  // 4. Pipeline end-to-end ------------------------------------------------
  const batch = await new EvidenceIngestionPipeline().run();
  const evRecords = batch.records.filter((r) => r.evidenceType === "uploaded_evidence");
  const badStatus = evRecords.filter(
    (r) => !["active", "expiring", "expired"].includes(r.status as string)
  ).length;
  const unmapped = evRecords.filter((r) => r.controlId === 0).length;

  check(
    "pipeline emits one record per evidence-library entry",
    evRecords.length === evidence.length,
    `${evRecords.length} of ${evidence.length}`
  );
  check(
    "no evidence record has undefined/invalid status",
    badStatus === 0,
    `${badStatus} bad`
  );
  check(
    "evidence records carry real control linkage",
    unmapped < evRecords.length,
    `${evRecords.length - unmapped}/${evRecords.length} mapped to a control`
  );

  console.log(
    `\nbatch stats: ${JSON.stringify(batch.stats)}\n` +
      `evidence status split: ` +
      JSON.stringify(
        evRecords.reduce<Record<string, number>>((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {})
      )
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verification threw:", err);
  process.exit(1);
});
