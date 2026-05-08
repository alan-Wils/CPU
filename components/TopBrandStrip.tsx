"use client";

import type { CSSProperties } from "react";
import BrandLogo from "@/components/BrandLogo";
import { resolveCompanyLogoImgSrc } from "@/lib/inventoryExport";

export type TopBrandStripProps = {
  /** Stored config path or absolute URL (`sales.inventoryPrintLogoUrl`). */
  companyLogoConfiguredUrl?: string;
  apiBaseUrl: string;
  companyLogoMaxHeightPx?: number;
  nexbatchHeight?: number;
  linkNexbatchToHome?: boolean;
};

/**
 * NexBatch logo and optional tenant logo side-by-side for page headers.
 */
export default function TopBrandStrip({
  companyLogoConfiguredUrl,
  apiBaseUrl,
  companyLogoMaxHeightPx = 54,
  /** NexBatch wordmark height (px); company logo size is controlled only by `companyLogoMaxHeightPx`. */
  nexbatchHeight = 186,
  linkNexbatchToHome = true,
}: TopBrandStripProps) {
  const raw = (companyLogoConfiguredUrl || "").trim();
  const resolved = raw ? resolveCompanyLogoImgSrc(raw, apiBaseUrl) : "";

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 16,
    width: "100%",
    boxSizing: "border-box",
    padding: "22px 22px",
    marginBottom: 14,
    background:
      "linear-gradient(90deg, rgba(2, 6, 23, 0.95) 0%, rgba(15, 23, 42, 0.95) 50%, rgba(30, 41, 59, 0.9) 100%)",
    borderRadius: 16,
    border: "1px solid rgba(148, 163, 184, 0.22)",
  };

  return (
    <div style={rowStyle}>
      {resolved ? (
        <img
          src={resolved}
          alt="Company logo"
          style={{
            maxHeight: companyLogoMaxHeightPx,
            maxWidth: Math.min(360, Math.max(96, Math.round(companyLogoMaxHeightPx * 6))),
            width: "auto",
            height: "auto",
            objectFit: "contain",
            display: "block",
          }}
        />
      ) : null}
      {resolved ? (
        <span
          aria-hidden
          style={{
            width: 1,
            alignSelf: "stretch",
            minHeight: 28,
            background: "rgba(148, 163, 184, 0.35)",
          }}
        />
      ) : null}
      <BrandLogo
        height={nexbatchHeight}
        maxWidth={Math.min(920, Math.round(nexbatchHeight * 6.2))}
        linkToHome={linkNexbatchToHome}
      />
    </div>
  );
}
