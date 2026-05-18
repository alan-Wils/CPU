/** Package unit dropdown options by extraction / packaging product type. */

export const PACKAGE_OPTIONS_LIVE_RESIN_OIL = [
  "1 Gram Cartridges",
  "1 Gram Disposables",
] as const;

export const PACKAGE_OPTIONS_LIVE_RESIN_DABBABLE = [
  "1 Gram Units",
  "2 Gram Units",
  "4 Gram Units",
] as const;

export const PACKAGE_OPTIONS_CURED_WAX = ["2 Gram Units", "4 Gram Units"] as const;

export const PACKAGE_OPTIONS_GUMMIES = ["Blueberry", "Peach", "Watermelon"] as const;

export const PACKAGE_OPTIONS_DEFAULT = ["1 Gram Units"] as const;

/** Lowercase search string from product fields (productType is checked first). */
export function packagingProductSearchText(batch: any): string {
  const parts = [batch?.productType, batch?.type, batch?.name]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean);
  return parts.join(" ").toLowerCase();
}

export function isLiveResinOilProduct(text: string): boolean {
  return text.includes("live resin oil") && !text.includes("edible");
}

export function isLiveResinDabbableProduct(text: string): boolean {
  return (
    text.includes("live resin dabbable") ||
    text.includes("live resin dabable") ||
    text.includes("live resin dabbables") ||
    text.includes("live resin dabables") ||
    /\blive\s+resin\s+dabb?ables?\b/.test(text)
  );
}

export function isCuredOrSugarWaxProduct(text: string): boolean {
  return (
    text.includes("cured wax") ||
    text.includes("dry sugar wax") ||
    text.includes("sugar wax")
  );
}

export function isGummyProduct(text: string): boolean {
  return text.includes("gummy") || text.includes("gummies");
}

export function getPackageOptions(batch: any): string[] {
  const text = packagingProductSearchText(batch);

  if (isLiveResinOilProduct(text)) {
    return [...PACKAGE_OPTIONS_LIVE_RESIN_OIL];
  }

  if (isLiveResinDabbableProduct(text)) {
    return [...PACKAGE_OPTIONS_LIVE_RESIN_DABBABLE];
  }

  if (isCuredOrSugarWaxProduct(text)) {
    return [...PACKAGE_OPTIONS_CURED_WAX];
  }

  if (isGummyProduct(text)) {
    return [...PACKAGE_OPTIONS_GUMMIES];
  }

  return [...PACKAGE_OPTIONS_DEFAULT];
}

export function getUnitSizeGramsFromPackageType(packageType: string): number {
  const text = String(packageType || "").toLowerCase();

  if (text.includes("4 gram")) return 4;
  if (text.includes("2 gram")) return 2;
  if (text.includes("1 gram")) return 1;

  return 0;
}
