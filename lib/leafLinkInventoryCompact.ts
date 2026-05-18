import type { LeafLinkInventoryDto, LeafLinkInventoryItemDto } from "@/lib/api";

const COL_INDEX = {
  i: 0,
  n: 1,
  s: 2,
  st: 3,
  c: 4,
  sc: 5,
  b: 6,
  q: 7,
  u: 8,
  pk: 9,
  $: 10,
  x: 11,
  t: 12,
  g: 13,
} as const;

function cellStr(row: (string | number | null)[], idx: number): string {
  const v = row[idx];
  return v == null ? "" : String(v).trim();
}

function cellNum(row: (string | number | null)[], idx: number): number {
  const v = row[idx];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function unixSecToIso(sec: number): string {
  if (!sec) return "";
  return new Date(sec * 1000).toISOString();
}

/** Expands GET /api/inventory/leaflink ultra-compact columnar payload into UI DTOs. */
export function expandLeafLinkInventoryDto(raw: LeafLinkInventoryDto): LeafLinkInventoryDto {
  const wire = raw as LeafLinkInventoryDto & {
    v?: number;
    r?: (string | number | null)[][];
    st?: [number, number, number, number];
    ls?: number;
    fc?: 0 | 1;
    sm?: LeafLinkInventoryDto["syncMode"];
  };
  const rows = wire.r ?? raw.rows;
  if ((!raw.compact && wire.v !== 1) || !Array.isArray(rows)) {
    return raw;
  }
  const statsTuple = wire.st;
  const items: LeafLinkInventoryItemDto[] = rows.map((row) => {
    const sub = cellStr(row, COL_INDEX.sc);
    return {
      id: cellStr(row, COL_INDEX.i),
      productName: cellStr(row, COL_INDEX.n),
      sku: cellStr(row, COL_INDEX.s),
      strain: cellStr(row, COL_INDEX.st),
      category: cellStr(row, COL_INDEX.c),
      productType: sub,
      subcategory: sub,
      brand: cellStr(row, COL_INDEX.b),
      availableQuantity: cellNum(row, COL_INDEX.q),
      unit: cellStr(row, COL_INDEX.u),
      packageSize: cellStr(row, COL_INDEX.pk),
      price: row[COL_INDEX.$] == null ? null : cellNum(row, COL_INDEX.$),
      status: cellStr(row, COL_INDEX.x),
      updatedAt: unixSecToIso(cellNum(row, COL_INDEX.t)),
      sourcePackageGroup: cellStr(row, COL_INDEX.g),
      imageUrl: "",
    };
  });
  return {
    source: "leaflink",
    items,
    stats: statsTuple
      ? {
          totalSkus: statsTuple[0],
          totalInventoryUnits: statsTuple[1],
          totalInventoryValue: statsTuple[2],
          categoriesCount: statsTuple[3],
        }
      : raw.stats,
    lastSyncedAt: wire.ls ? unixSecToIso(wire.ls) : raw.lastSyncedAt,
    fromCache: wire.fc === 1 ? true : raw.fromCache,
    syncMode: wire.sm ?? raw.syncMode,
  };
}
