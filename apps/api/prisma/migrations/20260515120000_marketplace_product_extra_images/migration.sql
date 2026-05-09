-- Additional product photos (gallery). Primary `MarketplaceProduct.imageUrl` is unchanged.
CREATE TABLE IF NOT EXISTS "MarketplaceProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageKey" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProductImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MarketplaceProductImage_productId_idx" ON "MarketplaceProductImage"("productId");

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceProductImage_productId_position_key" ON "MarketplaceProductImage"("productId", "position");

ALTER TABLE "MarketplaceProductImage"
    ADD CONSTRAINT "MarketplaceProductImage_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "MarketplaceProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
