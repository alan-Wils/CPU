# Prisma layout

| File / folder | Purpose |
|---------------|---------|
| `schema.prisma` | **Source of truth for models.** SQLite for local dev (`DATABASE_URL=file:./dev.db`). Use `npm run prisma:push` — not `prisma migrate` — to apply changes to SQLite. |
| `schema.postgresql.prisma` | Auto-generated: `npm run prisma:sync-pg` from `schema.prisma`. Used for staging/production builds and migrations. |
| `migrations/` | **PostgreSQL only** (`migration_lock.toml`). `prisma migrate deploy --schema=prisma/schema.postgresql.prisma` in CI/staging/prod. |

If you run `prisma migrate status` against the SQLite schema, Prisma returns `P3019` (provider mismatch). That is expected: use PostgreSQL + `schema.postgresql.prisma` for any `migrate` command.
