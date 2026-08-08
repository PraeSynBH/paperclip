# Database

Paperclip uses PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/). There are three ways to run the database, from simplest to most production-ready.

## 1. Embedded PostgreSQL — zero config

If you don't set `DATABASE_URL`, the server automatically starts an embedded PostgreSQL instance and manages a local data directory.

```sh
pnpm dev
```

That's it. On first start the server:

1. Creates a `~/.paperclip/instances/default/db/` directory for storage
2. Ensures the `paperclip` database exists
3. Runs migrations automatically for empty databases
4. Starts serving requests

Data persists across restarts in `~/.paperclip/instances/default/db/`. To reset local dev data, delete that directory.

If you need to apply pending migrations manually, run:

```sh
pnpm db:migrate
```

When `DATABASE_URL` is unset, this command targets the current embedded PostgreSQL instance for your active Paperclip config/instance.

Issue reference mentions follow the normal migration path: the schema migration creates the tracking table, but it does not backfill historical issue titles, descriptions, comments, or documents automatically.

To backfill existing content manually after migrating, run:

```sh
pnpm issue-references:backfill
# optional: limit to one company
pnpm issue-references:backfill -- --company <company-id>
```

Future issue, comment, and document writes sync references automatically without running the backfill command.

This mode is ideal for local development and one-command installs.

Docker note: the Docker quickstart image also uses embedded PostgreSQL by default. Persist `/paperclip` to keep DB state across container restarts (see `doc/DOCKER.md`).

## 2. Local PostgreSQL (Docker)

For a full PostgreSQL server locally, use the included Docker Compose setup:

```sh
docker compose up -d
```

This starts PostgreSQL 17 on `localhost:5432`. Then set the connection string:

```sh
cp .env.example .env
# .env already contains:
# DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip
```

Run migrations:

```sh
DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip \
  pnpm db:migrate
```

Start the server:

```sh
pnpm dev
```

## 3. Hosted PostgreSQL (Supabase)

For production, use a hosted PostgreSQL provider. [Supabase](https://supabase.com/) is a good option with a free tier.

### Setup

1. Create a project at [database.new](https://database.new)
2. Go to **Project Settings > Database > Connection string**
3. Copy the URI and replace the password placeholder with your database password

### Connection string

Supabase offers two connection modes:

**Direct connection** (port 5432) — use for migrations and one-off scripts:

```
postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

**Connection pooling via Supavisor** (port 6543) — use for the application:

```
postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

### Configure

For the application runtime, use a direct PostgreSQL connection unless the database client has explicit prepared-statement configuration for your pooling mode:

```sh
DATABASE_URL=postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

If you later run the app with a pooled runtime URL, set `DATABASE_MIGRATION_URL` to the direct connection URL. Paperclip uses it for startup schema checks/migrations and plugin namespace migrations, while the app continues to use `DATABASE_URL` for runtime queries:

```sh
DATABASE_URL=postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
DATABASE_MIGRATION_URL=postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

If your hosted database requires transaction-pooling-only connections, use a direct or session-pooled connection for Paperclip until runtime pooling support is documented in this guide. Do not edit database client source files as part of deployment setup.

### Push the schema

```sh
# Use the direct connection (port 5432) for schema changes
DATABASE_URL=postgres://postgres.[PROJECT-REF]:[PASSWORD]@...5432/postgres \
  pnpm db:migrate
```

### Free tier limits

- 500 MB database storage
- 200 concurrent connections
- Projects pause after 1 week of inactivity

See [Supabase pricing](https://supabase.com/pricing) for current details.

## Switching between modes

The database mode is controlled by `DATABASE_URL`:

| `DATABASE_URL` | Mode |
|---|---|
| Not set | Embedded PostgreSQL (`~/.paperclip/instances/default/db/`) |
| `postgres://...localhost...` | Local Docker PostgreSQL |
| `postgres://...supabase.com...` | Hosted Supabase |

Your Drizzle schema (`packages/db/src/schema/`) stays the same regardless of mode.

## Migration authoring checklist

The 0126 issue comment attribution backfill showed the failure mode this checklist is meant to prevent: each batch looked for the next rows with an unindexed predicate, so PostgreSQL repeatedly scanned the same table and the migration became O(n²) as the table grew.

When authoring migrations or one-time backfills:

- Create the supporting index for the batch predicate before the backfill loop runs.
- Bound batches by an indexed key, such as an id range or keyset pagination cursor. Do not use `OFFSET` pagination or a query shape that re-scans already-visited rows each batch.
- Avoid unbounded full-table `UPDATE` or `DELETE` statements. Add a selective predicate and process rows in bounded batches when table size can be large.
- Use `CREATE INDEX CONCURRENTLY` for large existing tables when the migration can run outside a transaction and must avoid long write locks.
- Split schema changes, index creation, and data backfill into separate phases so each step has clear locking and rollback behavior.
- Treat the `check:migrations` CI gate as the enforcement backstop for these rules. If it flags a migration, rewrite the migration or add a suppression comment with the indexed predicate, batch bound, and reason the remaining scan is safe.

## Migration journal consistency guard

`packages/db/src/migrations/meta/_journal.json` is the only list drizzle's
`migrate()` reads. The migrations *folder* is what folder-enumerating checks
read. When the two disagree the failure is silent and confusing: an orphaned
`.sql` (in the folder, not in the journal) is never applied, yet it is counted
as permanently pending, so `applyPendingMigrations` throws — and because that
throw happens in a suite's `beforeAll`, Vitest reports the whole suite as
`skipped` rather than `failed`.

The guard that prevents this lives in `packages/db/src/migration-journal-consistency.ts`
and is enforced at three points:

| Where | What it enforces |
|---|---|
| `applyPendingMigrations()` (runtime/bootstrap) | File↔journal bijection only, so a defect can never degrade into a skipped suite. Deliberately does *not* check `idx`, so pre-existing shipped journal history cannot brick startup. |
| `pnpm --filter @paperclipai/db check:migrations` (gates build/typecheck/generate/migrate) | Full audit: bijection, `idx` uniqueness, `idx` continuity. |
| `scripts/run-vitest-stable.mjs` preflight | Same full audit, run once before any embedded-Postgres suite starts. |

Run it directly:

```sh
pnpm --filter @paperclipai/db check:migration-journal          # baseline honoured
pnpm --filter @paperclipai/db exec tsx src/check-migration-journal.ts --strict
```

Rules the guard applies:

- **Bijection violations are always hard errors** and always name the offending filename.
- **A duplicate `idx` is a hard error**, except for groups recorded in
  `packages/db/src/migration-journal-idx-baseline.json`, which are reported as
  warnings so the guard could be adopted without first rewriting shipped
  history. This fork's journal currently has no such duplicates (the baseline
  is empty); `upstream/paperclipai/paperclip` master carried one at idx 178
  as of RBR-968, which never reached this fork's journal history.
- **`idx` gaps are warnings.** This fork's journal (128 entries, max idx 127)
  currently has none. Gaps usually mean a migration dropped before merge and
  make "latest idx" an unreliable count of applied migrations.

The baseline file is a ratchet, not an excuse list. A baselined group is
excused only when its `idx` *and* its exact tag set still match, so a third
entry joining a baselined group is a fresh error; and a baseline entry that no
longer matches the journal is itself a hard error, so the file cannot rot. Do
not add entries to unblock your own change — if your change introduces a
duplicate `idx`, fix the journal.

## Resource membership tables

Paperclip stores current-user sidebar membership state in:

- `project_memberships`
- `agent_memberships`

These rows are company-scoped and user-scoped. A missing row means the user is joined, so existing users keep seeing projects and agents in the sidebar until they explicitly leave them. Rows only control sidebar visibility; they do not affect project/agent detail access, all-pages, selectors, assignment flows, or existing company permissions.

Both tables use a unique key on `(company_id, user_id, resource_id)` and keep `state` as `joined` or `left`. Join/leave mutations are idempotent board-user `/me` operations and write activity entries when the effective state changes.

## Plugin database namespaces

The plugin runtime tracks plugin-owned database namespaces and migrations in `plugin_database_namespaces` and `plugin_migrations`. Hosted deployments that separate runtime and migration connections should set `DATABASE_MIGRATION_URL`; plugin namespace migration work uses the migration connection when present.

## Backups

Paperclip supports automatic and manual logical database backups. These dumps include
non-system database schemas such as `public`, the Drizzle migration journal, and
plugin-owned database schemas. See `doc/DEVELOPING.md` for the current
`paperclipai db:backup` / `pnpm db:backup` commands and backup retention
configuration.

Database backups do not include non-database instance files such as local-disk
uploads, workspace files, or the local encrypted secrets master key. Back those paths
up separately when you need full instance disaster recovery.

## Secret storage

Paperclip stores secret metadata and versions in:

- `company_secrets`
- `company_secret_versions`
- `company_secret_bindings`
- `secret_access_events`

Secret-aware env bindings are supported by agents, projects, and routines. Routine env lives in `routines.env`, is captured in `routine_revisions.snapshot`, and routine dispatches store `routine_runs.routine_revision_id` so runtime secret resolution uses the env snapshot that existed when the run was created. Routine secret refs bind with `target_type = 'routine'`, `target_id = routines.id`, and `config_path` values under `env.*`.

For local/default installs, the active provider is `local_encrypted`:

- Secret material is encrypted at rest with a local master key.
- Default key file: `~/.paperclip/instances/default/secrets/master.key` (auto-created if missing).
- CLI config location: `~/.paperclip/instances/default/config.json` under `secrets.localEncrypted.keyFilePath`.
- Backup/restore requires both the database metadata and the local master key file; either artifact alone is insufficient.
- The server best-effort enforces `0600` key file permissions and provider health reports permission warnings.

Optional overrides:

- `PAPERCLIP_SECRETS_MASTER_KEY` (32-byte key as base64, hex, or raw 32-char string)
- `PAPERCLIP_SECRETS_MASTER_KEY_FILE` (custom key file path)

Strict mode to block new inline sensitive env values:

```sh
PAPERCLIP_SECRETS_STRICT_MODE=true
```

You can set strict mode and provider defaults via:

```sh
pnpm paperclipai configure --section secrets
```

Inline secret migration command:

```sh
pnpm paperclipai secrets migrate-inline-env --company-id <company-id> --apply

# direct database maintenance fallback
pnpm secrets:migrate-inline-env --apply
```

Hosted AWS provider notes live in [SECRETS-AWS-PROVIDER.md](./SECRETS-AWS-PROVIDER.md).
