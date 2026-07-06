import { companies, createDb } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";
import { backfillSecurityGateGrants } from "../server/src/services/security-gate-backfill.js";

function parseFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function parseBoolFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim()
    || config.databaseUrl
    || `postgres://paperclip:paperclip@127.0.0.1:${config.embeddedPostgresPort}/paperclip`;

  const db = createDb(dbUrl);
  const companyId = parseFlag("--company");
  const dryRun = parseBoolFlag("--dry-run");
  const actor = {
    type: "system" as const,
    id: parseFlag("--actor-id") ?? "ram-931-backfill",
  };

  const targetCompanies = companyId
    ? [{ id: companyId, name: companyId }]
    : await db.select({ id: companies.id, name: companies.name }).from(companies);

  if (targetCompanies.length === 0) {
    console.log("No companies found; nothing to backfill.");
    return;
  }

  console.log(
    `Backfilling security gate grants for ${targetCompanies.length} compan${targetCompanies.length === 1 ? "y" : "ies"} (dryRun=${dryRun})...`,
  );
  for (const company of targetCompanies) {
    console.log(`- ${company.id} ${company.name ? `(${company.name})` : ""}`);
    const result = await backfillSecurityGateGrants(db, {
      companyId: company.id,
      dryRun,
      actor,
    });
    console.log(
      `  scanned ${result.scannedIssues} open G-gate issue(s), ${result.scannedDecisionOwners} active decision owner(s)`,
    );
    console.log(`  minted ${result.mintedGrants.length} grant(s), skipped ${result.skipped.length}`);
    for (const grant of result.mintedGrants) {
      console.log(
        `    + grant ${grant.grantId} for agent ${grant.agentId} on issue ${grant.issueIdentifier ?? grant.issueId}`,
      );
    }
    for (const skip of result.skipped) {
      console.log(
        `    - skip ${skip.issueIdentifier ?? skip.issueId} (${skip.reason})`,
      );
    }
  }
  console.log("Security gate backfill complete.");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Security gate backfill failed: ${message}`);
  process.exitCode = 1;
});
