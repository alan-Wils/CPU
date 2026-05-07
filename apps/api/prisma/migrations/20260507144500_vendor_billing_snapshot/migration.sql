-- CreateTable
CREATE TABLE "VendorBillingSnapshot" (
    "id" TEXT NOT NULL,
    "provider" "UsageProvider" NOT NULL,
    "month" TEXT NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "rawUsageJson" JSONB,
    "status" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBillingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorBillingSnapshot_month_provider_idx" ON "VendorBillingSnapshot"("month", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBillingSnapshot_provider_month_key" ON "VendorBillingSnapshot"("provider", "month");
