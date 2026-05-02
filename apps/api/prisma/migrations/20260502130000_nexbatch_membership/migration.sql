-- NexBatch: company memberships, optional user home company, platform roles.

CREATE TYPE "NexBatchCompanyRole" AS ENUM (
  'grow_staff',
  'extraction_staff',
  'packaging_staff',
  'trimming_staff',
  'lead_staff',
  'management',
  'admin',
  'owner'
);

CREATE TYPE "NexBatchPlatformRole" AS ENUM (
  'grow_staff',
  'extraction_staff',
  'packaging_staff',
  'trimming_staff',
  'lead_staff',
  'management',
  'admin',
  'owner',
  'nexbatch_admin'
);

CREATE TABLE "CompanyMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "NexBatchCompanyRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyMembership_userId_companyId_key" ON "CompanyMembership"("userId", "companyId");
CREATE INDEX "CompanyMembership_companyId_idx" ON "CompanyMembership"("companyId");
CREATE INDEX "CompanyMembership_userId_idx" ON "CompanyMembership"("userId");

ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "platformRole" "NexBatchPlatformRole";

ALTER TABLE "User" DROP CONSTRAINT "User_companyId_fkey";
ALTER TABLE "User" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CompanyMembership" ("id", "userId", "companyId", "role", "createdAt", "updatedAt")
SELECT
    md5(random()::text || clock_timestamp()::text || u.id),
    u.id,
    u."companyId",
    CASE u."role"::text
        WHEN 'OWNER' THEN 'owner'::"NexBatchCompanyRole"
        WHEN 'ADMIN' THEN 'admin'::"NexBatchCompanyRole"
        WHEN 'OPERATIONS_MANAGER' THEN 'management'::"NexBatchCompanyRole"
        WHEN 'CULTIVATION_SPECIALIST' THEN 'grow_staff'::"NexBatchCompanyRole"
        WHEN 'EXTRACTION_SPECIALIST' THEN 'extraction_staff'::"NexBatchCompanyRole"
        WHEN 'PACKAGING_SPECIALIST' THEN 'packaging_staff'::"NexBatchCompanyRole"
        WHEN 'FINANCIAL_ANALYST' THEN 'lead_staff'::"NexBatchCompanyRole"
        WHEN 'DATABASE_ARCHITECT' THEN 'lead_staff'::"NexBatchCompanyRole"
        WHEN 'FULL_STACK_DEVELOPER' THEN 'lead_staff'::"NexBatchCompanyRole"
        WHEN 'QA_TESTER' THEN 'lead_staff'::"NexBatchCompanyRole"
        WHEN 'VIEW_ONLY' THEN 'grow_staff'::"NexBatchCompanyRole"
        ELSE 'lead_staff'::"NexBatchCompanyRole"
    END,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM "User" u
WHERE u."companyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "CompanyMembership" m
    WHERE m."userId" = u.id AND m."companyId" = u."companyId"
  );
