-- Add LeafLink matching/payment sync metadata to check captures.
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkOrderId" TEXT;
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkOrderNumber" TEXT;
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkPaymentId" TEXT;
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkPaymentStatus" TEXT;
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkMatchedAt" TIMESTAMP(3);
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkPaidAt" TIMESTAMP(3);
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkPaymentResponseJson" TEXT;
ALTER TABLE "CheckCapture" ADD COLUMN "paymentSyncStatus" TEXT NOT NULL DEFAULT 'not_matched';
ALTER TABLE "CheckCapture" ADD COLUMN "paymentSyncError" TEXT;

CREATE INDEX "CheckCapture_companyId_paymentSyncStatus_createdAt_idx"
ON "CheckCapture"("companyId", "paymentSyncStatus", "createdAt");
