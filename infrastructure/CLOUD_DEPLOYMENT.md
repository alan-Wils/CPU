# Cloud Deployment Readiness

## Baseline
- Containerize `apps/api` and `apps/web`.
- Deploy web to Vercel or container runtime.
- Deploy API on container service (Railway/Fly.io/AWS ECS/Azure Container Apps).
- Use managed PostgreSQL for production.

## Required Services
- Managed Postgres
- Secret manager (JWT keys, DB URL)
- Centralized logging/monitoring
- Object storage (future docs/assets)

## CI/CD
- Run type checks and tests on pull requests.
- Run Prisma migration checks against staging DB.
- Enforce branch protection and mandatory QA gate.
