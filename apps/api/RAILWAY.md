# Railway — API staging (Neon + apps/api)

## 1. Create the service

1. [Railway](https://railway.app) → **New project** → **Deploy from GitHub** (or Empty project → connect repo).
2. Add a **Node** service, select this repository.
3. **Settings** → **Root directory:** `apps/api`
4. **Settings** → **Build** (or watch Nixpacks use `railway.toml`):
   - **Build command:** `npm install && npm run build`
5. **Settings** → **Deploy**:
   - **Start command:** `node dist/server.js`
   - **Custom release command** (runs once per deploy, before the new version serves traffic):  
     `npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma`  
   - If the dashboard does not show release: rely on the **Procfile** `release` line (supported on many Railway stacks).

## 2. Environment variables (paste in Variables)

Use values from your secrets manager, **not** committed files. Example shape is in `apps/api/.env.staging.example`.

| Name | Staging (production-like) |
|------|---------------------------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` (or Railway’s assigned `PORT` — if Railway injects `PORT`, prefer the injected value in Variables) |
| `DATABASE_URL` | Neon **pooled** or **direct** connection string, `?sslmode=require` |
| `JWT_SECRET` | 32+ random bytes, e.g. `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `15m` |
| `CORS_ORIGIN` | Your Vercel app origin, e.g. `https://…vercel.app` (comma-separated for several origins; **never** `*` in production) |
| `APP_URL` | Same app URL as the browser, `https://…` |
| `OWNER_BOOTSTRAP_EMAIL` | Optional; e.g. `owner@example.com` if your bootstrap path uses it |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional until outbound email is wired; if any is set, fill host, port, and `SMTP_FROM` at minimum |

**Note:** The API enforces: in `NODE_ENV=production`, `CORS_ORIGIN` is not `*`, `JWT_SECRET` is at least 32 characters, `DATABASE_URL` is not `file:…`, and `APP_URL` is set.

## 3. Prisma migrate (exact command)

```bash
cd apps/api
npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma
```

Same command as the **Custom release command** in Railway. Run locally with `DATABASE_URL` pointed at staging Neon to debug migration issues.

## 4. Verify staging

1. `GET https://<railway-app>.up.railway.app/health/live` → `200`, JSON `check: "live"`.
2. `GET https://<railway-app>.up.railway.app/health/ready` → `200` when DB is reachable, `check: "ready"`.
3. `GET https://<railway-app>.up.railway.app/health` → same as **ready** (readiness with DB check).
4. `POST /api/...` from the Vercel app with a token — must not CORS-fail in the browser (origin must be listed in `CORS_ORIGIN`).

## 5. If you exposed `DATABASE_URL` or passwords (e.g. in chat, logs)

- Rotate the **Neon** user password, update `DATABASE_URL` in Railway, and re-deploy. Never commit real URLs with credentials to the repo.
