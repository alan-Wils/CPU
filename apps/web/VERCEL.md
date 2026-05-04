# Vercel — `apps/web`

This workspace is a **subset** of pages (home, check capture). The full **Company Admin** UI (`/admin`, user permissions dialog) lives in the **repository root** Next app (`vercel.json` at repo root + `npm run build:platform`). If `nexbatch.com` should show that admin, point a Vercel project at the **monorepo root** (not only `apps/web`) or mirror those routes here.

## Project settings

1. **Root Directory:** `apps/web` (Framework Presets: Next.js).
2. **Install Command** (if not using `vercel.json`): `cd ../.. && npm install` so npm workspaces in the monorepo resolve correctly.
3. **Build Command:** `npm run build` (default).
4. **Output:** Next.js default (no static export required).

`vercel.json` in this folder sets `installCommand` and `buildCommand` for a consistent deploy.

## Environment variables (Production / Preview)

Paste in **Project → Settings → Environment Variables** (same values for *Production*; use Preview if you use preview deployments with a staging API).

| Name | Value (example) |
|------|------------------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://YOUR-RAILWAY-API-URL/api` |
| `NEXT_PUBLIC_API_URL` | `https://YOUR-RAILWAY-API-URL` (no `/api` path) |
| `NEXT_PUBLIC_APP_NAME` | `Cannabis CPU` |
| `NEXT_PUBLIC_ENABLE_STORE_COMPAT_WRITE` | `false` |

`NEXT_PUBLIC_*` variables are inlined at **build** time. After changing them, **redeploy** (not only redeploy from cache if your plan skips rebuilds).

**API CORS:** the Railway API must list your Vercel origin in `CORS_ORIGIN` (e.g. `https://your-app.vercel.app` or your custom domain).

## Smoke test

1. Open the deployed URL; no console errors for missing `NEXT_PUBLIC_` in production.
2. Log in; in DevTools **Network**, requests go to your Railway host, not `localhost`.
3. Open a protected route (e.g. `/cultivation` with auth) — data loads and guards behave as in local.
4. Confirm all `fetch` targets use the Railway base (filter Network by your API host).

## Monorepo note

The repo root uses npm `workspaces`. Installing only inside `apps/web` may fail; `installCommand` steps up to the monorepo root and runs `npm install` so `@cpu/web` and linked packages install correctly.
