-- CreateTable
CREATE TABLE "CheckCapture" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "checkDate" TIMESTAMP(3),
    "amount" DECIMAL(12,2),
    "checkNumber" TEXT,
    "payerName" TEXT,
    "routingNumber" TEXT,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "memo" TEXT,
    "imageUrl" TEXT NOT NULL,
    "rawOcrJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckCapture_companyId_idx" ON "CheckCapture"("companyId");
