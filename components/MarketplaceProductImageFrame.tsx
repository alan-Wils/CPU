"use client";

import type { CSSProperties } from "react";
import { objectFitForMarketplaceImage, marketplaceCardImageRawUrl } from "@/lib/marketplaceProductImageDisplay";
import { resolveCompanyLogoImgSrc } from "@/lib/inventoryExport";

type Props = {
  apiBaseUrl: string;
  imageUrl: string | null;
  companyInventoryLogoUrl?: string | null;
  imageDisplayMode?: string | null;
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
  directSrc,
  height = 100,
  placeholderBackground,
  borderRadius = 0,
  className,
}: Props) {
  const frameStyle: CSSProperties = {
    flexShrink: 0,
    height,
    backgroundColor: "#020617",
    borderRadius: borderRadius || undefined,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const local = directSrc?.trim() || "";
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
  const fit = objectFitForMarketplaceImage(imageDisplayMode);

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
