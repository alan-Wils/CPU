# Cannabis CPU — staging deployment (Phase 1)

This document describes how to run the **full stack** in a real staging environment: **Vercel (web)**, **Railway or Render (API)**, **Neon (PostgreSQL)**. It does not change app UI or business logic; it is infrastructure and process only.

---

## Architecture

| Layer | Suggested host | Notes |
|--------|----------------|--------|
| Web | **Vercel** | Next.js at `apps/web` |
| API | **Railway** or **Render** | Node at `apps/api` |
| DB | **Neon** PostgreSQL (or Supabase Postgres) | SSL required; separate staging project or branch from production |

**Why Railway for the API (default recommendation):** simple Node/Procfile + env UI, one-click log streaming, and good fit for a single `web` + `postdeploy` / release-style migration. **Render** is equivalent; use `render.yaml` as a starting blueprint.

---

## 1. PostgreSQL migration (Prisma)

- **Local:** SQLite in `prisma/schema.prisma` + `prisma db push` (`npm run prisma:push`). Do not run `prisma migrate` against the SQLite schema (see `apps/api/prisma/README.md` and P3019 note).
- **Staging/production:** `prisma/schema.postgresql.prisma` (synced from `schema.prisma`) + `prisma/migrations` + `npm run prisma:migrate:deploy` (direct Neon + advisory lock disabled for that run only).

**After you change models:**

1. Edit `prisma/schema.prisma` (SQLite is the day-to-day file).
2. `npm run prisma:sync-pg` (regenerates `schema.postgresql.prisma`).
3. Local: `npm run prisma:push`.
4. With `DATABASE_URL` pointing at a **Postgres** database:  
   `npx prisma migrate dev --name describe_change --schema=prisma/schema.postgresql.prisma`  
   to create a new migration under `prisma/migrations`.

**Production / staging deploy (CI or host “release” step):**

```bash
cd apps/api
npm run prisma:migrate:deploy
```

Use **Neon pooler** in `DATABASE_URL` for the API at runtime. Set **`DIRECT_DATABASE_URL`** to the non-`-pooler` host for migrations (or let the script derive it). Run migrations **once per deploy** (Railway `releaseCommand` / Render `preDeployCommand`), not on every replica start.

`DATABASE_URL` must be the only place the DB is chosen (no hardcoded connection strings in code). The API `build` script runs `prisma generate` against the **PostgreSQL** schema so the client matches Neon. Config lives in `prisma.config.ts` (not `package.json#prisma`).

**Why `prisma` is in `dependencies`:** the CLI must be present when the host runs migrate deploy in production (some installs omit `devDependencies`).

---

## 2. Environment files

| File | Use |
|------|-----|
| `apps/api/.env.example` | Local API |
| `apps/api/.env.staging.example` | Staging template |
| `apps/api/.env.production.example` | Production template |
| `apps/web/.env.example` | Shared web defaults |
| `apps/web/.env.local.example` | Local Next overrides (gitignored) |
| `apps/web/.env.staging.example` / `.env.production.example` | Vercel staging/prod reference |

**API (required in staging):** `NODE_ENV`, `DATABASE_URL` (Postgres), `JWT_SECRET` (long random), `PORT`, `CORS_ORIGIN` (set to your **exact** Vercel staging URL, not `*`), optional `APP_URL` for future email links, optional `SMTP_*` for mail.

**Web (Vercel):** `NEXT_PUBLIC_API_BASE_URL` = `https://<api-host>/api` (trailing path `/api` as used by `lib/api.ts`), `NEXT_PUBLIC_API_URL` = same origin without `/api` (used by a few pages), `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_ENABLE_STORE_COMPAT_WRITE=false` unless you explicitly need the legacy path.

**JWT:** use a 32+ character secret; rotate between environments (staging ≠ production).

**CORS:** `CORS_ORIGIN` supports a single origin, comma-separated list, or `*` (dev only). Staging and production should list only trusted web origins to avoid credentialed cross-origin abuse.

**Secrets:** do not commit `.env`, `.env.local`, or real staging/production values. `.gitignore` allows `*.example` through.

---

## 3. Vercel (web)

1. Create a Vercel project; connect the Git repository.
2. **Root directory:** `apps/web`.
3. **Framework:** Next (auto from `vercel.json`).
4. **Environment variables** (at least for Preview/Production as needed):
   - `NEXT_PUBLIC_API_BASE_URL`
   - `NEXT_PUBLIC_API_URL`
   - `NEXT_PUBLIC_APP_NAME`
   - `NEXT_PUBLIC_ENABLE_STORE_COMPAT_WRITE` = `false`
5. **Build:** `npm run build` (default). This repo is an npm monorestr; if install must run at repo root, set **Install command** in Vercel to `npm install` at root and set root directory to `apps/web` (Vercel will install from root when using monorepos — verify “Root Directory” + “Install Command” in project settings; often `cd ../.. && npm install` is not needed if `apps/web` has its own `package.json` and hoisted deps).
6. **Auth / routing:** the app already uses `NEXT_PUBLIC_API_BASE_URL` and client-side token storage; no UI changes. After deploy, log in and confirm API calls go to the Railway/Render API URL, not `localhost`.
7. **Preview URLs:** if you use dynamic preview URLs, either point every preview at a static staging API or set `CORS_ORIGIN` to include all preview hostnames (or use a single `staging` branch deployment with a fixed Vercel URL and match `CORS_ORIGIN` to that only).

**Exact command (if installing from repository root is required):**

```bash
# From monorepo root
npm install
npm run build
```

For a typical workspace setup, see `package.json` at repo root. Adjust Vercel “Install Command” if packages are hoisted to root.

---

## 4. Railway or Render (API)

### Railway (recommended outline)

1. New **Empty** or **GitHub** project; add a **Node** service.
2. **Root directory:** `apps/api`.
3. **Build command:** `npm install && npm run build`.
4. **Start command:** `node dist/server.js` only (see `apps/api/railway.toml`).
5. **Release command:** `node scripts/prisma-migrate-deploy-production.mjs` — runs **once per deploy**, not per replica. Do **not** chain migrate into start (avoids Neon pooler advisory-lock timeouts when scaling).
6. **Variables:** `DATABASE_URL` (pooler), `DIRECT_DATABASE_URL` (direct host, optional if derivable), `JWT_SECRET`, and `RUN_PRISMA_MIGRATIONS=false` on any extra replicas.

### Render

See repository `render.yaml` (simplified blueprint). In the Render dashboard, set the same env vars, confirm **Pre-deploy** runs migrate, and **Health check path** can be `/health/live` (liveness) or `/health/ready` (DB). Render env reference: [Render Blueprints](https://render.com/docs/blueprint-spec).

### CORS and health

- `GET /health/live` — process up (no DB); use for simple probes.
- `GET /health` and `GET /health/ready` — DB check (`SELECT 1`); use for “ready” semantics.

Log streaming: use Railway/Render process logs. Structured logs from the app go through `src/lib/logger.ts` (if used elsewhere).

**Rate limiting:** not implemented in this repo. For production, put **Cloudflare** or a reverse proxy in front, or add `express-rate-limit` in a follow-up (not part of this phase).

---

## 5. Neon (database)

1. Create a Neon project; choose region near your API.
2. **Connection strings:** pooler URL → `DATABASE_URL` (API runtime); direct URL → `DIRECT_DATABASE_URL` (migrations). Add `?sslmode=require` if missing.
3. Paste both on Railway/Render (or set only `DATABASE_URL` and let the migrate script strip `-pooler` for deploy).
4. **Migrations:** `npm run prisma:migrate:deploy` in the release/preDeploy step only.
5. **Backups:** Neon Pro includes PITR; on Free tier, schedule periodic `pg_dump` from CI or a trusted runner and store in encrypted object storage. Document owner approval for RPO/RTO.
6. **Restore:** new Neon branch from backup, or `pg_restore` / SQL replay per Neon docs.
7. **Owner / admin access:** all multi-tenancy is **company-scoped in the app layer**; DB credentials are superuser on the database — restrict Neon console access, enable MFA, and do not share `DATABASE_URL` in chat. **Recovery:** if locked out, use Neon’s SQL console (with a new secure password) only from trusted networks; the app’s **OWNER** / **bootstrap** email flows are product-level (see your existing admin routes).

**Supabase alternative:** any Postgres 14+ with SSL and connection string in `DATABASE_URL` works; `migrate deploy` is the same.

---

## 6. Email (invites, password reset)

The API currently **persists** invite and password-reset tokens; outbound SMTP is not fully wired in all paths. For staging:

- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `APP_URL` in the API environment.
- For **Resend** (or similar), use a verified domain, SPF/DKIM, and low rate limits in staging to avoid bounces. Handle failures: log the error, do not leak whether an email exists (password reset already returns generic `{ ok: true }`).
- **Resend-safe:** do not use personal Gmail SMTP for production bulk; use a provider API and monitor bounce webhooks in a later phase.
- **Owner recovery:** if email is not yet reliable, use Neon console to inspect users / `InviteToken` only under break-glass policy; long-term, wire admin password reset to a support process.

---

## 7. Staging validation checklist (manual)

Run in order; record pass/fail.

- [ ] **Owner / admin login** to staging (JWT, company scope).
- [ ] **Create company** (or use seed) and confirm data appears only under that `companyId`.
- [ ] **Create users** / **Invite user** (token created; email optional until SMTP works).
- [ ] **Company switching** (if applicable to your roles).
- [ ] **Cultivation** batch create/edit.
- [ ] **Source** packages.
- [ ] **Extraction** run (biomass, phases as designed).
- [ ] **Packaging** and weigh sessions.
- [ ] **Data hub** (exports, labor / cost as on local).
- [ ] **Logs / audit** entries for sensitive actions.
- [ ] **Deletion / protection** (confirm restricted deletes as implemented).

**No cross-company data:** for each test, use two companies and ensure IDs from company A never appear in API responses for company B (inspect network tab or add temporary audit queries in a read-only way).

---

## 8. Safety and go-live (production) checklist

- [ ] **CORS** restricted to real app origins; no `*` in production API.
- [ ] **JWT_SECRET** long, unique, rotated from staging; `JWT_EXPIRES_IN` appropriate.
- [ ] **HTTPS** everywhere (Vercel + Railway/Render + Neon).
- [ ] **DATABASE_URL** only in host secrets; not in the client, not in Git.
- [ ] **Backups** and tested restore (Neon PITR or `pg_dump` drill).
- [ ] **Migrations** applied via deploy pipeline before new code serves traffic; avoid parallel migrate on many dynos (use a release job).
- [ ] **Admin/owner recovery** runbook: Neon access, Vercel env, Railway/Render restart, `OWNER_BOOTSTRAP_EMAIL` only if still used and secured.
- [ ] **Rate limiting** at edge or API before high-traffic go-live.
- [ ] **SMTP** and DMARC/SPF for any customer-facing email.

---

## Quick reference: exact commands

```bash
# Monorepo install (from repo root)
npm install

# API — local SQLite
cd apps/api
cp .env.example .env   # then edit
npm run dev

# API — generate client for production schema (as in build)
npx prisma generate --schema=prisma/schema.postgresql.prisma

# API — apply migrations to Neon / Postgres (staging/prod, release job)
npm run prisma:migrate:deploy

# Web — local
cd apps/web
cp .env.local.example .env.local
npm run dev

# Web — production build (same as Vercel)
npm run build
```

---

## Staging test credentials (you create these; nothing is hardcoded in the repo)

| Item | You set in |
|------|------------|
| API base URL | Vercel `NEXT_PUBLIC_*` |
| First owner account | Seeded or “create company” flow on staging + password you choose |
| Test users / invites | Admin UI on staging after login |

**Do not** commit real passwords or JWT secrets. Store staging passwords in a team vault (1Password, etc.) and rotate if exposed.

---

## Files added or changed in this setup (reference)

- `apps/api`: `prisma/migrations/`, `scripts/sync-prisma-postgres-schema.mjs`, `prisma/README.md`, `schema.postgresql.prisma` (regenerated), `package.json` scripts, `Procfile`, `railway.toml`, `src/config/cors.ts`, `src/config/env.ts`, `src/server.ts` (health, CORS), `prisma` in `dependencies`, `.env*.example` files.
- `apps/web`: `vercel.json`, `.env*.example` files.
- `docs/STAGING_DEPLOYMENT.md` (this file), `render.yaml` (root).
- Root `.gitignore` (negate `*.example` for committed env templates).

When you are ready, align **Neon** → **API** `DATABASE_URL` → **Vercel** `CORS_ORIGIN` and `NEXT_PUBLIC_API_*` in one pass to avoid 401/CORS issues during smoke tests.
