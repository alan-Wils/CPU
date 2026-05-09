/** How product / fallback logo is scaled inside the marketplace card frame. */
export type MarketplaceImageDisplayMode = "AUTO" | "CONTAIN" | "COVER";

export function normalizeMarketplaceImageDisplayMode(
  v: string | null | undefined,
): MarketplaceImageDisplayMode {
  const u = String(v || "").trim().toUpperCase();
  if (u === "CONTAIN" || u === "COVER") return u;
  return "AUTO";
}

/** CSS object-fit for `<img>`; AUTO uses scale-down (never upscales — tames oversized logos). */
export function objectFitForMarketplaceImage(
  mode: string | null | undefined,
): "contain" | "cover" | "scale-down" {
  const m = normalizeMarketplaceImageDisplayMode(mode);
  if (m === "COVER") return "cover";
  if (m === "CONTAIN") return "contain";
  return "scale-down";
}

export function marketplaceCardImageRawUrl(p: {
  imageUrl: string | null;
  companyInventoryLogoUrl?: string | null;
}): string {
  return (p.imageUrl || "").trim() || (p.companyInventoryLogoUrl || "").trim();
}
