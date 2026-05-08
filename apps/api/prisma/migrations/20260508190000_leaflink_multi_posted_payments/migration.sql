-- Allow multiple LeafLink payment posts per check/cash row (one check paying several invoices).
ALTER TABLE "CheckCapture" ADD COLUMN "leaflinkPostedPayments" JSONB;

ALTER TABLE "CashLogEntry" ADD COLUMN "leaflinkPostedPayments" JSONB;
ALTER TABLE "CashLogEntry" ADD COLUMN "leaflinkPaymentSyncStatus" TEXT NOT NULL DEFAULT 'not_matched';
ALTER TABLE "CashLogEntry" ADD COLUMN "leaflinkPaymentSyncError" TEXT;
