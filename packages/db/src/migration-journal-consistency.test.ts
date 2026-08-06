import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMigrationJournalConsistency,
  checkMigrationJournalConsistency,
  formatMigrationJournalInconsistencies,
} from "./migration-journal-consistency.js";

// RBR-927: an orphaned .sql file (present in the migrations folder, absent from
// meta/_journal.json) is invisible to drizzle's journal-driven migrator but is
// reported as permanently pending by folder-enumerating checks. That made
// database bootstrap fail with an unactionable message, and because bootstrap
// runs in `beforeAll`, whole suites reported `skipped` rather than `failed`.
// These tests pin the guard that turns that class of defect into a hard error
// naming the offending filename.

const createdDirs: string[] = [];

function makeFixture(options: {
  readonly files: readonly string[];
  readonly journalTags: readonly string[];
}): { migrationsDir: string; journalPath: string } {
  const migrationsDir = mkdtempSync(join(tmpdir(), "paperclip-journal-consistency-"));
  createdDirs.push(migrationsDir);
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });

  for (const fileName of options.files) {
    writeFileSync(join(migrationsDir, fileName), "SELECT 1;\n", "utf8");
  }

  const journalPath = join(migrationsDir, "meta", "_journal.json");
  writeFileSync(
    journalPath,
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: options.journalTags.map((tag, index) => ({
        idx: index,
        version: "7",
        when: 1_700_000_000_000 + index,
        tag,
        breakpoints: true,
      })),
    }),
    "utf8",
  );

  return { migrationsDir, journalPath };
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("checkMigrationJournalConsistency", () => {
  it("reports no inconsistencies when every file has a journal entry", async () => {
    const fixture = makeFixture({
      files: ["0001_first.sql", "0002_second.sql"],
      journalTags: ["0001_first", "0002_second"],
    });

    const result = await checkMigrationJournalConsistency(fixture);

    expect(result.inconsistencies).toEqual([]);
    expect(result.migrationFiles).toEqual(["0001_first.sql", "0002_second.sql"]);
    expect(result.journalFiles).toEqual(["0001_first.sql", "0002_second.sql"]);
  });

  it("flags an orphaned file whose number collides with a journalled slot", async () => {
    // The exact RBR-927 shape: 0128_force_reassign.sql left behind after the
    // migration was renumbered to 0131, with slot 0128 already taken.
    const fixture = makeFixture({
      files: ["0128_force_reassign.sql", "0128_user_specific_secrets.sql", "0131_force_reassign.sql"],
      journalTags: ["0128_user_specific_secrets", "0131_force_reassign"],
    });

    const result = await checkMigrationJournalConsistency(fixture);

    expect(result.inconsistencies).toEqual([
      { kind: "orphaned-migration-file", fileName: "0128_force_reassign.sql" },
    ]);
  });

  it("flags an orphaned file that occupies an otherwise-unused number", async () => {
    const fixture = makeFixture({
      files: ["0001_first.sql", "0300_orphan_never_journalled.sql"],
      journalTags: ["0001_first"],
    });

    const result = await checkMigrationJournalConsistency(fixture);

    expect(result.inconsistencies).toEqual([
      { kind: "orphaned-migration-file", fileName: "0300_orphan_never_journalled.sql" },
    ]);
  });

  it("flags an orphaned file whose name does not use a 4-digit prefix", async () => {
    // The numbering checks reject this on prefix shape alone; the journal
    // comparison must still identify it as the orphan it is.
    const fixture = makeFixture({
      files: ["0001_first.sql", "0130a_orphan_mid.sql"],
      journalTags: ["0001_first"],
    });

    const result = await checkMigrationJournalConsistency(fixture);

    expect(result.inconsistencies).toEqual([
      { kind: "orphaned-migration-file", fileName: "0130a_orphan_mid.sql" },
    ]);
  });

  it("flags a journal entry with no matching file", async () => {
    const fixture = makeFixture({
      files: ["0001_first.sql"],
      journalTags: ["0001_first", "0002_deleted_by_mistake"],
    });

    const result = await checkMigrationJournalConsistency(fixture);

    expect(result.inconsistencies).toEqual([
      { kind: "missing-migration-file", fileName: "0002_deleted_by_mistake.sql" },
    ]);
  });

  it("reports orphaned and missing files together", async () => {
    const fixture = makeFixture({
      files: ["0001_first.sql", "0009_orphan.sql"],
      journalTags: ["0001_first", "0002_missing"],
    });

    const result = await checkMigrationJournalConsistency(fixture);

    expect(result.inconsistencies).toEqual([
      { kind: "orphaned-migration-file", fileName: "0009_orphan.sql" },
      { kind: "missing-migration-file", fileName: "0002_missing.sql" },
    ]);
  });

  it("ignores non-.sql entries in the migrations folder", async () => {
    const fixture = makeFixture({
      files: ["0001_first.sql"],
      journalTags: ["0001_first"],
    });
    writeFileSync(join(fixture.migrationsDir, "README.md"), "notes\n", "utf8");

    const result = await checkMigrationJournalConsistency(fixture);

    expect(result.inconsistencies).toEqual([]);
  });
});

describe("assertMigrationJournalConsistency", () => {
  it("throws naming the orphaned filename", async () => {
    const fixture = makeFixture({
      files: ["0128_force_reassign.sql", "0128_user_specific_secrets.sql"],
      journalTags: ["0128_user_specific_secrets"],
    });

    await expect(assertMigrationJournalConsistency(fixture)).rejects.toThrow(
      /0128_force_reassign\.sql/,
    );
  });

  it("resolves for the real shipped migrations folder", async () => {
    // Guards the repository itself: packages/db/src/migrations must stay in
    // agreement with meta/_journal.json.
    await expect(assertMigrationJournalConsistency()).resolves.toBeUndefined();
  });
});

describe("formatMigrationJournalInconsistencies", () => {
  it("names the offending file and explains the failure mode", () => {
    const message = formatMigrationJournalInconsistencies([
      { kind: "orphaned-migration-file", fileName: "0128_force_reassign.sql" },
    ]);

    expect(message).toContain("0128_force_reassign.sql");
    expect(message).toContain("meta/_journal.json");
    expect(message).toContain("Orphaned migration file");
  });

  it("names a missing file separately from an orphan", () => {
    const message = formatMigrationJournalInconsistencies([
      { kind: "missing-migration-file", fileName: "0002_missing.sql" },
    ]);

    expect(message).toContain("0002_missing.sql");
    expect(message).not.toContain("Orphaned migration file");
  });
});
