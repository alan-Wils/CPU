# Implementation Plan - Cannabis CPU Platform

## 1) Target Outcomes
- Multi-company secure platform with strict tenant isolation.
- End-to-end operational workflow: Cultivation -> Extraction -> Packaging.
- Financial visibility via labor-cost and CPU analytics.
- Auditable, cloud-deployable architecture with RBAC controls.

## 2) Domain Modules
1. Identity & Access
   - Company onboarding
   - User invitation
   - Role assignment and permission checks
2. Operations Workflow
   - Cultivation batches
   - Extraction runs
   - Packaging lots
   - State transitions and traceability links
3. Labor & CPU
   - Labor entries by workflow stage
   - Cost rates by role/company
   - CPU per gram/unit and margin snapshots
4. Compliance & Audit
   - Immutable audit trail
   - Admin event feed
   - Change history exports
5. Platform Admin
   - Owner/admin company controls
   - Feature flags and policy settings

## 3) Multi-Agent CrewAI Design
### Agents
- Operations Manager: decomposes delivery scope and backlog priorities
- Cultivation Specialist: validates cultivation data model and process controls
- Extraction Specialist: validates extraction yields and quality checkpoints
- Packaging Specialist: validates lot lineage and labeling requirements
- Financial Analyst: defines labor-cost and CPU formulas
- Database Architect: owns Prisma schema, indexes, migrations
- Full Stack Developer: transforms plans into API/UI tasks
- QA Tester: builds test strategy and acceptance criteria

### Crew Flow
1. Discovery + requirements normalization
2. Data/workflow design review
3. Financial model sign-off
4. Technical implementation tasks generation
5. QA gate and release checklist

## 4) Architecture
- Frontend (`apps/web`): Next.js App Router, server components for dashboards, client components for forms.
- Backend (`apps/api`): Express modular routes/services/repositories.
- Shared package (`packages/shared`): role enums, DTOs, permission matrix.
- Database: Prisma schema with tenant-scoped relations and audit logs.
- Deployment: containerized services with managed Postgres and object storage.

## 5) Data Architecture
- Tenant boundary on `companyId` for all business entities.
- RBAC at API middleware + query layer guard.
- Workflow entities:
  - `CultivationBatch`
  - `ExtractionRun`
  - `PackagingLot`
  - `LaborEntry`
  - `CpuSnapshot`
  - `AuditLog`

## 6) Security and Compliance
- JWT access tokens + refresh rotation.
- Password hashing with bcrypt/argon2.
- API rate limiting, input validation, and structured logging.
- Audit events for all create/update/delete and privileged actions.

## 7) Implementation Phases
### Phase 1 - Foundation
- Monorepo scaffold
- Auth + tenancy + RBAC baseline
- Prisma schema and initial migration

### Phase 2 - Workflow MVP
- Cultivation/extraction/packaging APIs
- Basic dashboard UI and workflow forms
- Labor tracking endpoints

### Phase 3 - Finance Intelligence
- CPU calculations and trend snapshots
- Role-based financial dashboards

### Phase 4 - Hardening
- Integration/E2E tests
- Observability, CI/CD, deploy templates
- PostgreSQL migration rehearsal

## 8) Definition of Done
- Tenant-safe data access verified by tests.
- All critical workflow transitions covered by integration tests.
- Audit log coverage for privileged actions.
- Cloud deployment docs and environment templates complete.
