-- Per-product image scaling for seller / buyer marketplace cards.
ALTER TABLE "MarketplaceProduct" ADD COLUMN IF NOT EXISTS "imageDisplayMode" TEXT;
