-- Persisted LeafLink wholesale orders for analytics (upserted when orders are fetched).
CREATE TABLE "LeafLinkStoredOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leafLinkKey" TEXT NOT NULL,
    "buyerCustomerId" TEXT NOT NULL DEFAULT '',
    "customerName" TEXT NOT NULL DEFAULT '',
    "statusRaw" TEXT NOT NULL DEFAULT '',
    "createdOn" TIMESTAMP(3),
    "totalUsd" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "sourcePage" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeafLinkStoredOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeafLinkStoredOrder_companyId_leafLinkKey_key" ON "LeafLinkStoredOrder"("companyId", "leafLinkKey");

CREATE INDEX "LeafLinkStoredOrder_companyId_createdOn_idx" ON "LeafLinkStoredOrder"("companyId", "createdOn");

ALTER TABLE "LeafLinkStoredOrder" ADD CONSTRAINT "LeafLinkStoredOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
