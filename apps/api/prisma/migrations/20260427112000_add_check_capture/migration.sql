-- CreateTable
CREATE TABLE "public"."CheckCapture" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "checkDate" TIMESTAMP(3),
    "amount" DOUBLE PRECISION,
    "checkNumber" TEXT,
    "payerName" TEXT,
    "routingNumber" TEXT,
    "accountNumber" TEXT,
    "bankName" TEXT,
    "memo" TEXT,
    "imageUrl" TEXT NOT NULL,
    "rawOcrJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckCapture_companyId_createdAt_idx" ON "public"."CheckCapture"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckCapture_createdByUserId_createdAt_idx" ON "public"."CheckCapture"("createdByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."CheckCapture" ADD CONSTRAINT "CheckCapture_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckCapture" ADD CONSTRAINT "CheckCapture_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
