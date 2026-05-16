-- Authoritative vendor USD may be unknown until manual entry or vendor dollar API.
ALTER TABLE "VendorBillingSnapshot" ALTER COLUMN "totalCost" DROP NOT NULL;
ALTER TABLE "VendorBillingSnapshot" ALTER COLUMN "totalCost" DROP DEFAULT;

ALTER TABLE "VendorBillingSnapshot" ADD COLUMN IF NOT EXISTS "billingPeriodStart" TIMESTAMP(3);
ALTER TABLE "VendorBillingSnapshot" ADD COLUMN IF NOT EXISTS "billingPeriodEnd" TIMESTAMP(3);
ALTER TABLE "VendorBillingSnapshot" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'estimated';
ALTER TABLE "VendorBillingSnapshot" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
