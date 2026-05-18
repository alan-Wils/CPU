import type { LeafLinkInventoryItem, LeafLinkInventoryResponse } from "../services/leaflinkService.js";

/** Compact list row for GET /api/inventory/leaflink (detail via ?detail=1 or GET …/:id). */
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

export type LeafLinkInventoryListResponseDto = {
  source: "leaflink";
  items: LeafLinkInventoryListItemDto[];
  stats: LeafLinkInventoryResponse["stats"];
  lastSyncedAt: string;
  fromCache?: boolean;
  syncMode?: LeafLinkInventoryResponse["syncMode"];
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

export function leafLinkInventoryToListResponse(full: LeafLinkInventoryResponse): LeafLinkInventoryListResponseDto {
  return {
    source: full.source,
    items: full.items.map(leafLinkInventoryItemToListRow),
    stats: full.stats,
    lastSyncedAt: full.lastSyncedAt,
    fromCache: full.fromCache,
    syncMode: full.syncMode,
  };
}
