/**
 * LeafLink inventory compact list wire format (v1).
 * Field order MUST match `packages/shared/src/leafLinkInventoryCompact.ts` and
 * `lib/leafLinkInventoryCompact.ts` on the frontend.
 */
import type { LeafLinkInventoryItem, LeafLinkInventoryResponse } from "../services/leaflinkService.js";

export const LEAFLINK_INVENTORY_COMPACT_VERSION = 1 as const;

export const LEAFLINK_INVENTORY_COMPACT_COLS = [
  "i",
  "n",
  "s",
  "st",
  "c",
  "sc",
  "b",
  "q",
  "u",
  "pk",
  "$",
  "x",
  "t",
  "g",
] as const;

export const LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT = LEAFLINK_INVENTORY_COMPACT_COLS.length;

export type LeafLinkInventoryUltraCompactResponseDto = {
  v: typeof LEAFLINK_INVENTORY_COMPACT_VERSION;
  r: (string | number | null)[][];
  st: [number, number, number, number];
  ls: number;
  fc?: 0 | 1;
  sm?: LeafLinkInventoryResponse["syncMode"];
};

function capStr(value: unknown, max: number): string {
  const s = String(value ?? "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function updatedAtUnixSec(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function itemToCompactRow(item: LeafLinkInventoryItem): (string | number | null)[] {
  const sub = capStr(item.subcategory || item.productType, 24);
  const price = item.price == null ? null : Math.round(Number(item.price) * 100) / 100;
  return [
    capStr(item.id, 48),
    capStr(item.productName, 44),
    capStr(item.sku, 32),
    capStr(item.strain, 16),
    capStr(item.category, 20),
    sub,
    capStr(item.brand, 20),
    Number(item.availableQuantity) || 0,
    capStr(item.unit, 8),
    capStr(item.packageSize, 16),
    price,
    capStr(item.status, 16),
    updatedAtUnixSec(item.updatedAt),
    capStr(item.sourcePackageGroup, 24),
  ];
}

export function leafLinkInventoryToUltraCompactResponse(
  full: LeafLinkInventoryResponse,
): LeafLinkInventoryUltraCompactResponseDto {
  const rows = full.items.map(itemToCompactRow);
  const ls = updatedAtUnixSec(full.lastSyncedAt) || Math.floor(Date.now() / 1000);
  return {
    v: LEAFLINK_INVENTORY_COMPACT_VERSION,
    r: rows,
    st: [
      full.stats.totalSkus,
      full.stats.totalInventoryUnits,
      Math.round(full.stats.totalInventoryValue),
      full.stats.categoriesCount,
    ],
    ls,
    ...(full.fromCache ? { fc: 1 as const } : {}),
    ...(full.syncMode ? { sm: full.syncMode } : {}),
  };
}

/** @deprecated Legacy object list — use {@link leafLinkInventoryToUltraCompactResponse}. */
export type LeafLinkInventoryListItemDto = {
  id: string;
  productName: string;
  sku: string;
  strain: string;
  category: string;
  productType: string;
  subcategory: string;
  brand: string;
  availableQuantity: number;
  unit: string;
  packageSize: string;
  price: number | null;
  status: string;
  updatedAt: string;
  sourcePackageGroup: string;
  hasImage: boolean;
};

export function leafLinkInventoryItemToListRow(item: LeafLinkInventoryItem): LeafLinkInventoryListItemDto {
  return {
    id: item.id,
    productName: item.productName,
    sku: item.sku,
    strain: item.strain,
    category: item.category,
    productType: item.productType,
    subcategory: item.subcategory,
    brand: item.brand,
    availableQuantity: item.availableQuantity,
    unit: item.unit,
    packageSize: item.packageSize,
    price: item.price,
    status: item.status,
    updatedAt: item.updatedAt,
    sourcePackageGroup: item.sourcePackageGroup,
    hasImage: Boolean(String(item.imageUrl || "").trim()),
  };
}
