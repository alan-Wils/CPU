/**
 * Map LeafLink / API category strings (often `Category #5`) to admin-configured display names.
 * Kept in sync with root `lib/productCategoryLabels.ts`.
 */
export type CategoryLabelOverride = { id: string; displayName: string };

function normalizeCategoryKey(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^Category\s*#\s*/i, "")
    .trim();
}

/** Resolve a single row's category for display and filtering. */
export function resolveInventoryCategoryLabel(
  rawCategory: string,
  overrides: CategoryLabelOverride[] | undefined,
): string {
  const t = String(rawCategory || "").trim();
  if (!t) return "";
  const list = Array.isArray(overrides) ? overrides : [];
  const norm = normalizeCategoryKey(t);
  for (const o of list) {
    const id = String(o.id || "").trim();
    if (!id) continue;
    const idNorm = normalizeCategoryKey(id);
    if (t === id || norm === idNorm || t === `Category #${idNorm}` || norm === idNorm) {
      const dn = String(o.displayName || "").trim();
      if (dn) return dn;
    }
  }
  return t;
}
