-- Outgoing cash: optional receipt photo URL (served under /uploads/cash-receipts/...).
ALTER TABLE "CashLogEntry" ADD COLUMN "receiptImageUrl" TEXT;
