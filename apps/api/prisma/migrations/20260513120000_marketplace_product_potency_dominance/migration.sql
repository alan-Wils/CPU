-- Optional seller-facing labels for buyer marketplace cards (wholesale catalog).
ALTER TABLE "MarketplaceProduct" ADD COLUMN IF NOT EXISTS "potencyLabel" TEXT;
ALTER TABLE "MarketplaceProduct" ADD COLUMN IF NOT EXISTS "strainDominance" TEXT;
