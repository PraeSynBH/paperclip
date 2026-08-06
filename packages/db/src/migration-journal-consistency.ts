import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));
const MIGRATIONS_JOURNAL_JSON = fileURLToPath(
  new URL("./migrations/meta/_journal.json", import.meta.url),
);

/**
 * An orphaned migration file (a `.sql` in the migrations folder with no
 * `meta/_journal.json` entry) is invisible to drizzle's journal-driven
 * `migrate()` but *is* visible to any folder-enumerating check such as
 * `inspectMigrations`. The result is a database that is genuinely up to date
 * while bootstrap reports it as permanently pending, which surfaces as an
 * unfixable "Failed to bootstrap migrations" and — when it happens inside a
 * `beforeAll` — a whole suite reporting `skipped` instead of `failed`.
 *
 * This module is the single source of truth for that invariant so the build
 * gate (`check:migrations`) and the runtime bootstrap path both fail the same
 * way: a hard error that names the offending filename.
 */
export type MigrationJournalInconsistency =
  | { readonly kind: "orphaned-migration-file"; readonly fileName: string }
  | { readonly kind: "missing-migration-file"; readonly fileName: string };

export type MigrationJournalConsistencyResult = {
  readonly migrationFiles: readonly string[];
  readonly journalFiles: readonly string[];
  readonly inconsistencies: readonly MigrationJournalInconsistency[];
};

type JournalFile = {
  entries?: Array<{ idx?: number; tag?: string; when?: number }>;
};

export async function listMigrationFolderFiles(
  migrationsDir: string = MIGRATIONS_FOLDER,
): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function listJournalMigrationFileNames(
  journalPath: string = MIGRATIONS_JOURNAL_JSON,
): Promise<string[]> {
  const raw = await readFile(journalPath, "utf8");
  const parsed = JSON.parse(raw) as JournalFile;
  const entries = parsed.entries ?? [];

  return entries.map((entry, index) => {
    if (typeof entry?.tag !== "string" || entry.tag.length === 0) {
      throw new Error(`Migration journal entry ${index} is missing a tag`);
    }
    return `${entry.tag}.sql`;
  });
}

/**
 * Compares the migrations folder against `meta/_journal.json` and reports every
 * file that exists on only one side. Pure comparison: it never throws for an
 * inconsistency, so callers can format their own message.
 */
export async function checkMigrationJournalConsistency(options?: {
  readonly migrationsDir?: string;
  readonly journalPath?: string;
}): Promise<MigrationJournalConsistencyResult> {
  const migrationFiles = await listMigrationFolderFiles(options?.migrationsDir);
  const journalFiles = await listJournalMigrationFileNames(options?.journalPath);

  const journalFileSet = new Set(journalFiles);
  const migrationFileSet = new Set(migrationFiles);

  const inconsistencies: MigrationJournalInconsistency[] = [];

  for (const fileName of migrationFiles) {
    if (!journalFileSet.has(fileName)) {
      inconsistencies.push({ kind: "orphaned-migration-file", fileName });
    }
  }

  for (const fileName of journalFiles) {
    if (!migrationFileSet.has(fileName)) {
      inconsistencies.push({ kind: "missing-migration-file", fileName });
    }
  }

  return { migrationFiles, journalFiles, inconsistencies };
}

export function formatMigrationJournalInconsistencies(
  inconsistencies: readonly MigrationJournalInconsistency[],
): string {
  const orphaned = inconsistencies
    .filter((entry) => entry.kind === "orphaned-migration-file")
    .map((entry) => entry.fileName);
  const missing = inconsistencies
    .filter((entry) => entry.kind === "missing-migration-file")
    .map((entry) => entry.fileName);

  const lines: string[] = ["Migration folder and meta/_journal.json disagree."];

  if (orphaned.length > 0) {
    lines.push(
      `Orphaned migration file(s) present in packages/db/src/migrations but absent from meta/_journal.json: ${orphaned.join(", ")}.`,
      "An orphaned file is never applied by drizzle's journal-driven migrator but is reported as permanently pending by folder-based checks, which breaks database bootstrap. Delete the file if it is a leftover duplicate, or add its journal entry if the migration is real.",
    );
  }

  if (missing.length > 0) {
    lines.push(
      `Journal entry/entries with no matching .sql file in packages/db/src/migrations: ${missing.join(", ")}.`,
      "Restore the missing file or remove the stale journal entry.",
    );
  }

  return lines.join("\n");
}

/**
 * Hard-fails with the offending filename when the migrations folder and the
 * journal disagree. Called from migration bootstrap so an orphaned file can
 * never degrade into a silently skipped test suite.
 */
export async function assertMigrationJournalConsistency(options?: {
  readonly migrationsDir?: string;
  readonly journalPath?: string;
}): Promise<void> {
  const { inconsistencies } = await checkMigrationJournalConsistency(options);
  if (inconsistencies.length === 0) return;
  throw new Error(formatMigrationJournalInconsistencies(inconsistencies));
}
