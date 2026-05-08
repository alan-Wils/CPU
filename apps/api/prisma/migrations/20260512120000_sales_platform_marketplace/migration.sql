-- Sales Platform: company service flags + B2B marketplace products and orders.

CREATE TYPE "MarketplaceProductAvailability" AS ENUM ('AVAILABLE', 'INTERNAL', 'NOT_AVAILABLE');
CREATE TYPE "MarketplaceProductSource" AS ENUM ('MANUAL', 'LEAFLINK');
CREATE TYPE "MarketplaceOrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'FULFILLED', 'CANCELLED');

CREATE TABLE "CompanyServiceSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "salesSellerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "salesBuyerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "leafLinkInventorySyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyServiceSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyServiceSettings_companyId_key" ON "CompanyServiceSettings"("companyId");

ALTER TABLE "CompanyServiceSettings" ADD CONSTRAINT "CompanyServiceSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MarketplaceProduct" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "productType" TEXT,
    "strainName" TEXT,
    "flavorName" TEXT,
    "sku" TEXT,
    "unitSize" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "quantityAvailable" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "availabilityStatus" "MarketplaceProductAvailability" NOT NULL,
    "source" "MarketplaceProductSource" NOT NULL,
    "leafLinkInventoryId" TEXT,
    "leafLinkRawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketplaceProduct_companyId_idx" ON "MarketplaceProduct"("companyId");
CREATE INDEX "MarketplaceProduct_availabilityStatus_idx" ON "MarketplaceProduct"("availabilityStatus");
CREATE INDEX "MarketplaceProduct_source_idx" ON "MarketplaceProduct"("source");
CREATE INDEX "MarketplaceProduct_leafLinkInventoryId_idx" ON "MarketplaceProduct"("leafLinkInventoryId");

ALTER TABLE "MarketplaceProduct" ADD CONSTRAINT "MarketplaceProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MarketplaceOrder" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "status" "MarketplaceOrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketplaceOrder_buyerCompanyId_idx" ON "MarketplaceOrder"("buyerCompanyId");
CREATE INDEX "MarketplaceOrder_sellerCompanyId_idx" ON "MarketplaceOrder"("sellerCompanyId");
CREATE INDEX "MarketplaceOrder_status_idx" ON "MarketplaceOrder"("status");
CREATE INDEX "MarketplaceOrder_createdAt_idx" ON "MarketplaceOrder"("createdAt");

ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MarketplaceOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "unitSizeSnapshot" TEXT,
    "priceSnapshot" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,
    "imageUrlSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketplaceOrderItem_orderId_idx" ON "MarketplaceOrderItem"("orderId");

ALTER TABLE "MarketplaceOrderItem" ADD CONSTRAINT "MarketplaceOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceOrderItem" ADD CONSTRAINT "MarketplaceOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MarketplaceProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
