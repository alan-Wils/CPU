/** Company-config logo used for prints and header branding (`sales.inventoryPrintLogoUrl`). */
export function extractCompanyInventoryLogoUrl(config: unknown): string {
  const data = config as { sales?: { inventoryPrintLogoUrl?: string } } | null;
  const u = typeof data?.sales?.inventoryPrintLogoUrl === "string"
    ? data.sales.inventoryPrintLogoUrl.trim()
    : "";
  return u;
}
