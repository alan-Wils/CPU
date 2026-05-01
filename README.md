# Cannabis CPU Platform Monorepo

Production-ready foundation for a multi-company cannabis operations platform with a CrewAI planning swarm and a web stack based on Next.js, Node.js, Prisma, and SQLite -> PostgreSQL migration readiness.

## Stack
- Frontend: Next.js 16 (App Router), TypeScript
- Backend: Node.js + Express + TypeScript
- ORM: Prisma
- Databases: SQLite default, PostgreSQL migration target
- Auth: JWT, password reset request foundation, invite foundation
- Multi-tenancy: Company-scoped data model enforced by repository/service layer
- RBAC: Owner (application-level), Admin (highest company-level), specialist roles
- Workflow: Cultivation -> Extraction -> Packaging
- Automation: CrewAI multi-agent orchestration

## Staging & production (Vercel, Railway/Render, Neon)
- [docs/STAGING_DEPLOYMENT.md](docs/STAGING_DEPLOYMENT.md) — Prisma, Neon, API host, checklists
- [apps/web/VERCEL.md](apps/web/VERCEL.md) — Vercel project root `apps/web`, `NEXT_PUBLIC_*` env, smoke tests

## Monorepo Layout
- `apps/web`: Next.js dashboard frontend (live API integration)
- `apps/api`: Node API + Prisma + seed system
- `packages/shared`: shared role and permission constants
- `automation/crewai`: CrewAI agents/tasks/crew orchestration
- `docs`: architecture and implementation plan
- `infrastructure`: docker/deploy assets

## Quick Start
1. Install deps: `npm install`
2. Prepare API env: copy `apps/api/.env.example` to `apps/api/.env`
3. Prepare web env: copy `apps/web/.env.example` to `apps/web/.env.local`
4. Push schema: `npm --workspace @cpu/api run prisma:push`
5. Seed data: `npm --workspace @cpu/api run prisma:seed`
6. Run API: `npm --workspace @cpu/api run dev`
7. Run web: `npm --workspace @cpu/web run dev`

## Demo Seed Credentials
- owner@budfox.com / OwnerPass!234
- admin@budfox.com / AdminPass!234
- cultivation@budfox.com / CultivationPass!234
- extraction@budfox.com / ExtractionPass!234
- packaging@budfox.com / PackagingPass!234
- viewer@budfox.com / ViewerPass!234

## Production Notes
- Owner is preserved as application-level control.
- Admin remains highest company-level role.
- Route payloads use strict Zod validation.
- Routes never query Prisma directly; services + repositories enforce company scoping.
- See `docs/IMPLEMENTATION_PLAN.md` for phase roadmap.
