import {
  encodeLeafLinkInventoryCompactRow,
  LEAFLINK_INVENTORY_COMPACT_COLS,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
  LEAFLINK_INVENTORY_COMPACT_VERSION,
  type LeafLinkInventoryCompactWire,
} from "@cpu/shared";
import type { LeafLinkInventoryItem, LeafLinkInventoryResponse } from "../services/leaflinkService.js";

export {
  LEAFLINK_INVENTORY_COMPACT_COLS,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
  LEAFLINK_INVENTORY_COMPACT_VERSION,
};

export type LeafLinkInventoryUltraCompactResponseDto = LeafLinkInventoryCompactWire;

function updatedAtUnixSec(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function leafLinkInventoryToUltraCompactResponse(
  full: LeafLinkInventoryResponse,
): LeafLinkInventoryUltraCompactResponseDto {
  const rows = full.items.map((item) =>
    encodeLeafLinkInventoryCompactRow({
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
    }),
  );
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
