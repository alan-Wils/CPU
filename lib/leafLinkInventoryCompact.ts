import type { LeafLinkInventoryDto, LeafLinkInventoryItemDto } from "@/lib/api";
import {
  expandLeafLinkInventoryWire,
  diagnoseLeafLinkInventoryDecode,
  countWireInventoryRows,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
  LEAFLINK_INVENTORY_COMPACT_VERSION,
  type LeafLinkInventoryDecodeDiagnostics,
} from "@cpu/shared";

export {
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
  LEAFLINK_INVENTORY_COMPACT_VERSION,
  countWireInventoryRows,
  diagnoseLeafLinkInventoryDecode,
  type LeafLinkInventoryDecodeDiagnostics,
};

const DECODE_DEBUG =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_LEAFLINK_INVENTORY_DECODE_DEBUG === "1";

function toUiItem(row: ReturnType<typeof expandLeafLinkInventoryWire>["payload"]["items"][number]): LeafLinkInventoryItemDto {
  return {
    ...row,
    imageUrl: "",
  };
}

/** Expands GET /api/inventory/leaflink ultra-compact columnar payload into UI DTOs. */
export function expandLeafLinkInventoryDto(raw: LeafLinkInventoryDto): LeafLinkInventoryDto {
  const { payload, diagnostics } = expandLeafLinkInventoryWire(raw);
  logDecodeDiagnostics(raw, diagnostics);
  return {
    source: "leaflink",
    items: payload.items.map(toUiItem),
    stats: payload.stats,
    lastSyncedAt: payload.lastSyncedAt,
    fromCache: payload.fromCache,
    syncMode: payload.syncMode,
  };
}

export function logDecodeDiagnostics(
  raw: unknown,
  diagnostics: LeafLinkInventoryDecodeDiagnostics,
): void {
  const wireRows = countWireInventoryRows(raw);
  const decoded = diagnostics.decodedRowCount;
  const shouldLog = DECODE_DEBUG || (wireRows > 0 && decoded === 0) || diagnostics.schemaMismatch;

  if (!shouldLog) return;

  const payload = {
    event: "leaflink_inventory_decode",
    wireVersion: diagnostics.wireVersion,
    compactFieldCount: diagnostics.compactFieldCount,
    wireRowCount: wireRows,
    decodedRowCount: decoded,
    legacyItemsCount: diagnostics.legacyItemsCount,
    rowsWithMissingId: diagnostics.rowsWithMissingId,
    rowsWithMissingName: diagnostics.rowsWithMissingName,
    rowsWithMissingStatus: diagnostics.rowsWithMissingStatus,
    firstDecodedRow: diagnostics.firstDecodedRow,
    schemaMismatch: diagnostics.schemaMismatch,
    schemaMismatchReason: diagnostics.schemaMismatchReason,
  };

  if (wireRows > 0 && decoded === 0) {
    console.error("[LEAFLINK_INVENTORY] decode produced zero rows from non-empty wire payload", payload);
  } else if (diagnostics.schemaMismatch) {
    console.warn("[LEAFLINK_INVENTORY] compact schema mismatch", payload);
  } else if (DECODE_DEBUG) {
    console.info("[LEAFLINK_INVENTORY] decode diagnostics", payload);
  }
}
