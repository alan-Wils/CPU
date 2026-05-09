import type { CategoryLabelOverride } from "./productCategoryLabels.js";

/**
 * Prefer `sales.leafLinkCategoryLabels` when that key exists (including `[]`).
 * Otherwise fall back to legacy `sales.categoryLabels` then `products.categoryLabels`.
 * Matches admin `mergeLeafLinkCategoryLabelsFromPayload`.
 */
export function mergeLeafLinkCategoryLabelsFromConfigBlocks(
  sales: unknown,
  products: unknown,
): CategoryLabelOverride[] {
  const s = sales as { leafLinkCategoryLabels?: unknown; categoryLabels?: unknown } | undefined;
  if (s && typeof s === "object" && "leafLinkCategoryLabels" in s && Array.isArray(s.leafLinkCategoryLabels)) {
    return s.leafLinkCategoryLabels as CategoryLabelOverride[];
  }
  const legacySalesKey = s?.categoryLabels;
  if (Array.isArray(legacySalesKey) && legacySalesKey.length > 0) {
    return legacySalesKey as CategoryLabelOverride[];
  }
  const p = products as { categoryLabels?: unknown } | undefined;
  const legacyProducts = p?.categoryLabels;
  if (Array.isArray(legacyProducts)) {
    return legacyProducts as CategoryLabelOverride[];
  }
  return [];
}
