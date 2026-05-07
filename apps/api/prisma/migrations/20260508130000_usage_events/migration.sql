-- CreateEnum
CREATE TYPE "UsageProvider" AS ENUM ('vercel', 'railway', 'neon', 'resend', 'cloudflare_r2', 'ai');

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "UsageProvider" NOT NULL,
    "feature" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "UsageEvent_companyId_createdAt_idx" ON "UsageEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_companyId_provider_createdAt_idx" ON "UsageEvent"("companyId", "provider", "createdAt");
