-- Cash ledger: incoming vs outgoing cash movements per company.
CREATE TYPE "CashLogDirection" AS ENUM ('INCOMING', 'OUTGOING');

CREATE TABLE "CashLogEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "direction" "CashLogDirection" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "memo" TEXT,
    "entryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashLogEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashLogEntry_companyId_createdAt_idx" ON "CashLogEntry"("companyId", "createdAt");
CREATE INDEX "CashLogEntry_createdByUserId_createdAt_idx" ON "CashLogEntry"("createdByUserId", "createdAt");

ALTER TABLE "CashLogEntry" ADD CONSTRAINT "CashLogEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashLogEntry" ADD CONSTRAINT "CashLogEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
