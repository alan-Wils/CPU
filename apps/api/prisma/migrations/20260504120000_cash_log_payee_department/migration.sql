CREATE TYPE "CashLogDepartment" AS ENUM ('CULTIVATION', 'EXTRACTION', 'PACKAGING', 'GENERAL');

ALTER TABLE "CashLogEntry" ADD COLUMN "payeeCompany" TEXT;
ALTER TABLE "CashLogEntry" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "CashLogEntry" ADD COLUMN "department" "CashLogDepartment";
