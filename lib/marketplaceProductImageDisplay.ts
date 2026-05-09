/** How product / fallback logo is scaled inside the marketplace card frame. */
export type MarketplaceImageDisplayMode = "AUTO" | "CONTAIN" | "COVER";

export function normalizeMarketplaceImageDisplayMode(
  v: string | null | undefined,
): MarketplaceImageDisplayMode {
  const u = String(v || "").trim().toUpperCase();
  if (u === "CONTAIN" || u === "COVER") return u;
  return "AUTO";
}

export type ObjectFitForMarketplaceOptions = {
  /** True when showing an uploaded/linked product `imageUrl` (or local preview), not logo-only fallback. */
  hasProductImage?: boolean;
};

/**
 * CSS object-fit for marketplace card images.
 * COVER / CONTAIN are explicit. AUTO: `cover` for product photos, `scale-down` when only the inventory logo is used
 * (avoids cropping wide logos).
 */
export function objectFitForMarketplaceImage(
  mode: string | null | undefined,
  options?: ObjectFitForMarketplaceOptions,
): "contain" | "cover" | "scale-down" {
  const m = normalizeMarketplaceImageDisplayMode(mode);
  if (m === "COVER") return "cover";
  if (m === "CONTAIN") return "contain";
  if (options?.hasProductImage) return "cover";
  return "scale-down";
}

export function marketplaceCardImageRawUrl(p: {
  imageUrl: string | null;
  companyInventoryLogoUrl?: string | null;
}): string {
  return (p.imageUrl || "").trim() || (p.companyInventoryLogoUrl || "").trim();
}
