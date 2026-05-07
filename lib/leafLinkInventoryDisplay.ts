import type { LeafLinkInventoryItemDto } from "@/lib/api";

/** Match server-side `deriveSourcePackageGroup` when `sourcePackageGroup` is missing (older syncs). */
export function inferSourcePackageGroup(row: LeafLinkInventoryItemDto): string {
  const fromApi = (row.sourcePackageGroup || "").trim();
  if (fromApi) return fromApi;
  const s = (row.sku || "").trim();
  const parenBatch = s.match(/^(B\d+\([^)]+\))/i);
  if (parenBatch) return parenBatch[1];
  const dateSku = s.match(/^(\d{2}\.\d{2}\.\d{2})/);
  if (dateSku) return dateSku[1];
  if (s) return s;
  return (row.productName || "").trim() || row.id;
}

/** Sort 1g / 2g / 4g style lines in a sensible order. */
export function variantSortKey(row: LeafLinkInventoryItemDto): number {
  const hay = `${row.productName} ${row.packageSize} ${row.sku}`;
  const m = hay.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (m) return Number(m[1]);
  const u = hay.match(/\b(\d+)\s*ml\b/i);
  if (u) return Number(u[1]) + 1000;
  return 9999;
}

export type InventoryPackageGroup = {
  key: string;
  rows: LeafLinkInventoryItemDto[];
};

export function groupInventoryBySourcePackage(rows: LeafLinkInventoryItemDto[]): InventoryPackageGroup[] {
  const map = new Map<string, LeafLinkInventoryItemDto[]>();
  for (const row of rows) {
    const k = inferSourcePackageGroup(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row);
  }
  const groups: InventoryPackageGroup[] = [...map.entries()].map(([key, r]) => ({
    key,
    rows: [...r].sort((a, b) => {
      const va = variantSortKey(a);
      const vb = variantSortKey(b);
      if (va !== vb) return va - vb;
      return (a.productName || "").localeCompare(b.productName || "");
    }),
  }));
  groups.sort((a, b) => {
    const an = a.rows[0]?.productName || "";
    const bn = b.rows[0]?.productName || "";
    return an.localeCompare(bn);
  });
  return groups;
}
