-- Outgoing cash: support multiple receipt photos (JSON array of URLs).
ALTER TABLE "CashLogEntry" ADD COLUMN "receiptImageUrls" JSONB;

UPDATE "CashLogEntry"
SET "receiptImageUrls" = jsonb_build_array("receiptImageUrl")
WHERE "receiptImageUrl" IS NOT NULL AND btrim("receiptImageUrl") <> '';

ALTER TABLE "CashLogEntry" DROP COLUMN "receiptImageUrl";
