-- CheckCapture: optional stub photo URL and explicit invoice number for exports.
ALTER TABLE "CheckCapture" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "CheckCapture" ADD COLUMN "stubImageUrl" TEXT;
