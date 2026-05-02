# Fix: failed `20260427120000_init_check_capture` (P3009)

That migration used to `CREATE TABLE "CheckCapture"` again after `20260427112000_add_check_capture` had already created it, so it could fail with “relation already exists”.

The SQL is now a no-op (`SELECT 1`).

## Your Neon / Postgres already shows this migration as **failed**

From `apps/api` with production `DATABASE_URL` in `.env`:

```bash
npx prisma migrate resolve --applied 20260427120000_init_check_capture --schema=prisma/schema.postgresql.prisma
npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma
```

`--applied` marks the migration finished **without** re-running SQL (your `CheckCapture` table is already correct from `20260427112000_add_check_capture`).

## If `migrate deploy` reports a checksum error (P3018) on that migration

Rare edge case if the row was recorded with an old file hash:

```bash
npx prisma migrate resolve --rolled-back 20260427120000_init_check_capture --schema=prisma/schema.postgresql.prisma
npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma
```

That re-applies the migration using the current no-op file, then continues.
