"use client";

import type { CSSProperties } from "react";
import { objectFitForMarketplaceImage, marketplaceCardImageRawUrl } from "@/lib/marketplaceProductImageDisplay";
import { resolveCompanyLogoImgSrc } from "@/lib/inventoryExport";

type Props = {
  apiBaseUrl: string;
  imageUrl: string | null;
  companyInventoryLogoUrl?: string | null;
  imageDisplayMode?: string | null;
  /** When set, overrides seller `imageDisplayMode` (e.g. detail modal hero uses `cover`). */
  objectFitOverride?: "contain" | "cover" | "scale-down";
  /** Fill a positioned parent (use with parent `position: relative` + fixed aspect / height). */
  fillParent?: boolean;
  /** Local preview (`blob:`) — skips `resolveCompanyLogoImgSrc`. */
  directSrc?: string | null;
  height?: number;
  placeholderBackground: string;
  borderRadius?: number;
  className?: string;
};

/**
 * Product card image area: `<img>` + object-fit so sellers can pick AUTO / CONTAIN / COVER per product.
 */
export default function MarketplaceProductImageFrame({
  apiBaseUrl,
  imageUrl,
  companyInventoryLogoUrl,
  imageDisplayMode,
  objectFitOverride,
  fillParent,
  directSrc,
  height = 100,
  placeholderBackground,
  borderRadius = 0,
  className,
}: Props) {
  const frameStyle: CSSProperties = {
    ...(fillParent
      ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
      : { flexShrink: 0, height }),
    backgroundColor: "#020617",
    borderRadius: borderRadius || undefined,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const local = directSrc?.trim() || "";
  const hasProductImage = !!local || !!(imageUrl || "").trim();
  const raw = local || marketplaceCardImageRawUrl({ imageUrl, companyInventoryLogoUrl });
  if (!raw) {
    return (
      <div
        className={className}
        style={{ ...frameStyle, background: placeholderBackground }}
        aria-hidden
      />
    );
  }

  const src = local ? local : resolveCompanyLogoImgSrc(raw, apiBaseUrl);
  const fit =
    objectFitOverride ?? objectFitForMarketplaceImage(imageDisplayMode, { hasProductImage });

  return (
    <div className={className} style={frameStyle}>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          objectPosition: "center",
        }}
      />
    </div>
  );
}
