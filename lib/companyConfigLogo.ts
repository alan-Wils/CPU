import {
  clampCompanyHeaderLogoMaxHeightPx,
  clampCompanyHeaderLogoMaxWidthPx,
} from "@/lib/inventoryExport";

/** Company-config logo used for prints and header branding (`sales.inventoryPrintLogoUrl`). */
export function extractCompanyInventoryLogoUrl(config: unknown): string {
  const data = config as { sales?: { inventoryPrintLogoUrl?: string } } | null;
  const u = typeof data?.sales?.inventoryPrintLogoUrl === "string"
    ? data.sales.inventoryPrintLogoUrl.trim()
    : "";
  return u;
}

/** 0 = keep default navigation bar logo height (56 / 64). */
export function extractCompanyHeaderLogoMaxHeightPx(config: unknown): number {
  return clampCompanyHeaderLogoMaxHeightPx(
    (config as { sales?: { companyHeaderLogoMaxHeightPx?: unknown } } | null)?.sales
      ?.companyHeaderLogoMaxHeightPx,
  );
}

/** 0 = derive max width from height (legacy). */
export function extractCompanyHeaderLogoMaxWidthPx(config: unknown): number {
  return clampCompanyHeaderLogoMaxWidthPx(
    (config as { sales?: { companyHeaderLogoMaxWidthPx?: unknown } } | null)?.sales?.companyHeaderLogoMaxWidthPx,
  );
}
