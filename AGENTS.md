<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

### Architecture overview

Cannabis CPU (NexBatch) is a multi-company cannabis operations platform. Monorepo with npm workspaces:

| Service | Path | Port | Command |
|---|---|---|---|
| Express API (`@cpu/api`) | `apps/api/` | 4000 | See below |
| Next.js Platform (root) | `/` | 3000 | `npm run dev:app` |
| Next.js Dashboard (`@cpu/web`) | `apps/web/` | 3001 | `npm run dev:web` |
| Shared library (`@cpu/shared`) | `packages/shared/` | — | `npm --workspace @cpu/shared run build` |

### Database: PostgreSQL required (not SQLite)

The codebase's `prisma/schema.prisma` defaults to SQLite, but the app code uses PostgreSQL-only Prisma features (e.g. `mode: "insensitive"` in queries). **You must use PostgreSQL for local dev.**

- PostgreSQL must be running on `localhost:5432` with user `cpu`, password `cpu`, database `cannabis_cpu`.
- Start PostgreSQL: `sudo pg_ctlcluster 16 main start`
- The `.env` file at the workspace root (not `apps/api/.env`) is what the API actually reads (via `apps/api/src/config/env.ts`).
- Required env vars: `DATABASE_URL` (PostgreSQL connection string), `JWT_SECRET` (min 24 chars).

### Starting the API server

The default `npm --workspace @cpu/api run dev` script runs `prisma generate` first, which regenerates the Prisma client from the SQLite schema and breaks the PostgreSQL connection. Instead:

1. Generate the PostgreSQL client: `npm --workspace @cpu/api run prisma:generate:pg`
2. Push schema if needed: `cd apps/api && npx prisma db push --schema=prisma/schema.postgresql.prisma`
3. Start server directly: `cd apps/api && npx tsx watch src/server.ts`

### Seeding

`npm --workspace @cpu/api run prisma:seed` — creates BudFox + Demo Company with sample users. Credentials are in `README.md`. Login requires `companyCode: "budfox"`.

### Running tests

- All workspaces: `npm test` (runs `@cpu/shared` tests + root vitest)
- API tests: `npm --workspace @cpu/api run test`
- Shared tests: `npm --workspace @cpu/shared run test`

### Lint

No dedicated lint script is configured in the root `package.json`. TypeScript checking is done via `tsc`. Build the shared package before building other packages: `npm --workspace @cpu/shared run build`.
