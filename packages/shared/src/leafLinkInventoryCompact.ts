/**
 * Canonical LeafLink inventory list compact wire schema (v1).
 * Backend encodes and frontend decodes MUST stay in lockstep.
 */
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

export const LEAFLINK_INVENTORY_COMPACT_COL_INDEX = {
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

export type LeafLinkInventoryCompactCol = (typeof LEAFLINK_INVENTORY_COMPACT_COLS)[number];
export type LeafLinkInventoryCompactRow = (string | number | null)[];

export type LeafLinkInventoryCompactStats = [
  totalSkus: number,
  totalInventoryUnits: number,
  totalInventoryValue: number,
  categoriesCount: number,
];

export type LeafLinkInventoryCompactWire = {
  v: typeof LEAFLINK_INVENTORY_COMPACT_VERSION;
  r: LeafLinkInventoryCompactRow[];
  st: LeafLinkInventoryCompactStats;
  ls: number;
  fc?: 0 | 1;
  sm?: "cache" | "full" | "incremental";
};

export type LeafLinkInventoryCompactItemDecoded = {
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
};

export type LeafLinkInventoryDecodeDiagnostics = {
  wireVersion: number | null;
  compactFieldCount: number;
  wireRowCount: number;
  decodedRowCount: number;
  legacyItemsCount: number;
  rowsWithMissingId: number;
  rowsWithMissingName: number;
  rowsWithMissingStatus: number;
  firstDecodedRow: LeafLinkInventoryCompactItemDecoded | null;
  schemaMismatch: boolean;
  schemaMismatchReason: string | null;
};

function cellStr(row: LeafLinkInventoryCompactRow, idx: number): string {
  const v = row[idx];
  return v == null ? "" : String(v).trim();
}

function cellNum(row: LeafLinkInventoryCompactRow, idx: number): number {
  const v = row[idx];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function unixSecToIso(sec: number): string {
  if (!sec) return "";
  return new Date(sec * 1000).toISOString();
}

export function isLeafLinkInventoryCompactRow(value: unknown): value is LeafLinkInventoryCompactRow {
  return Array.isArray(value) && value.length >= LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT;
}

export function isLeafLinkInventoryObjectRow(
  value: unknown,
): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function decodeLeafLinkInventoryCompactRow(
  row: LeafLinkInventoryCompactRow,
): LeafLinkInventoryCompactItemDecoded {
  const sub = cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.sc);
  return {
    id: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.i),
    productName: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.n),
    sku: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.s),
    strain: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.st),
    category: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.c),
    productType: sub,
    subcategory: sub,
    brand: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.b),
    availableQuantity: cellNum(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.q),
    unit: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.u),
    packageSize: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.pk),
    price: row[LEAFLINK_INVENTORY_COMPACT_COL_INDEX.$] == null
      ? null
      : cellNum(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.$),
    status: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.x),
    updatedAt: unixSecToIso(cellNum(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.t)),
    sourcePackageGroup: cellStr(row, LEAFLINK_INVENTORY_COMPACT_COL_INDEX.g),
  };
}

export function decodeLeafLinkInventoryObjectRow(
  row: Record<string, unknown>,
): LeafLinkInventoryCompactItemDecoded {
  const sub = String(row.subcategory ?? row.productType ?? "").trim();
  const priceRaw = row.price;
  const price =
    priceRaw == null || priceRaw === ""
      ? null
      : Number.isFinite(Number(priceRaw))
        ? Number(priceRaw)
        : null;
  return {
    id: String(row.id ?? "").trim(),
    productName: String(row.productName ?? row.name ?? "").trim(),
    sku: String(row.sku ?? "").trim(),
    strain: String(row.strain ?? "").trim(),
    category: String(row.category ?? "").trim(),
    productType: sub,
    subcategory: sub,
    brand: String(row.brand ?? "").trim(),
    availableQuantity: Number(row.availableQuantity) || 0,
    unit: String(row.unit ?? "").trim(),
    packageSize: String(row.packageSize ?? "").trim(),
    price,
    status: String(row.status ?? "").trim(),
    updatedAt: String(row.updatedAt ?? "").trim(),
    sourcePackageGroup: String(row.sourcePackageGroup ?? "").trim(),
  };
}

export function countWireInventoryRows(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const wire = raw as Record<string, unknown>;
  if (typeof wire.rowCount === "number" && Number.isFinite(wire.rowCount)) {
    return Math.max(0, Math.floor(wire.rowCount));
  }
  if (Array.isArray(wire.r)) return wire.r.length;
  if (Array.isArray(wire.rows)) return wire.rows.length;
  if (Array.isArray(wire.items)) return wire.items.length;
  return 0;
}

export function isUltraCompactInventoryWire(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const wire = raw as Record<string, unknown>;
  if (wire.v === LEAFLINK_INVENTORY_COMPACT_VERSION) return true;
  if (Array.isArray(wire.r)) return true;
  if (wire.compact === true && Array.isArray(wire.r)) return true;
  return false;
}

export function diagnoseLeafLinkInventoryDecode(raw: unknown): LeafLinkInventoryDecodeDiagnostics {
  const wire = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const wireVersion = typeof wire.v === "number" ? wire.v : null;
  const wireRowCount = countWireInventoryRows(raw);
  const legacyItems = Array.isArray(wire.items) ? wire.items : [];
  const legacyItemsCount = legacyItems.length;

  let decoded: LeafLinkInventoryCompactItemDecoded[] = [];
  let schemaMismatch = false;
  let schemaMismatchReason: string | null = null;

  if (wireVersion != null && wireVersion !== LEAFLINK_INVENTORY_COMPACT_VERSION) {
    schemaMismatch = true;
    schemaMismatchReason = `Unsupported compact schema v${wireVersion} (expected v${LEAFLINK_INVENTORY_COMPACT_VERSION})`;
  } else if (isUltraCompactInventoryWire(raw) && Array.isArray(wire.r)) {
    const rows = wire.r as unknown[];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isLeafLinkInventoryCompactRow(row)) {
        decoded.push(decodeLeafLinkInventoryCompactRow(row));
      } else if (isLeafLinkInventoryObjectRow(row)) {
        decoded.push(decodeLeafLinkInventoryObjectRow(row));
      }
    }
  } else if (legacyItemsCount > 0) {
    for (const row of legacyItems) {
      if (isLeafLinkInventoryObjectRow(row)) {
        decoded.push(decodeLeafLinkInventoryObjectRow(row));
      }
    }
  }

  let rowsWithMissingId = 0;
  let rowsWithMissingName = 0;
  let rowsWithMissingStatus = 0;
  for (const row of decoded) {
    if (!row.id) rowsWithMissingId++;
    if (!row.productName) rowsWithMissingName++;
    if (!row.status) rowsWithMissingStatus++;
  }

  return {
    wireVersion,
    compactFieldCount: LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
    wireRowCount,
    decodedRowCount: decoded.length,
    legacyItemsCount,
    rowsWithMissingId,
    rowsWithMissingName,
    rowsWithMissingStatus,
    firstDecodedRow: decoded[0] ?? null,
    schemaMismatch,
    schemaMismatchReason,
  };
}

export type LeafLinkInventoryExpandedPayload = {
  source: "leaflink";
  items: LeafLinkInventoryCompactItemDecoded[];
  stats?: {
    totalSkus: number;
    totalInventoryUnits: number;
    totalInventoryValue: number;
    categoriesCount: number;
  };
  lastSyncedAt?: string;
  fromCache?: boolean;
  syncMode?: "cache" | "full" | "incremental";
};

export function expandLeafLinkInventoryWire(
  raw: unknown,
): { payload: LeafLinkInventoryExpandedPayload; diagnostics: LeafLinkInventoryDecodeDiagnostics } {
  const diagnostics = diagnoseLeafLinkInventoryDecode(raw);
  const wire = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  if (
    diagnostics.wireVersion != null &&
    diagnostics.wireVersion !== LEAFLINK_INVENTORY_COMPACT_VERSION
  ) {
    return {
      payload: {
        source: "leaflink",
        items: [],
        stats: readStats(wire),
        lastSyncedAt: readLastSynced(wire),
        fromCache: wire.fc === 1,
        syncMode: readSyncMode(wire),
      },
      diagnostics,
    };
  }

  const items: LeafLinkInventoryCompactItemDecoded[] = [];
  if (isUltraCompactInventoryWire(raw) && Array.isArray(wire.r)) {
    for (const row of wire.r as unknown[]) {
      if (isLeafLinkInventoryCompactRow(row)) {
        items.push(decodeLeafLinkInventoryCompactRow(row));
      } else if (isLeafLinkInventoryObjectRow(row)) {
        items.push(decodeLeafLinkInventoryObjectRow(row));
      }
    }
  } else if (Array.isArray(wire.items)) {
    for (const row of wire.items) {
      if (isLeafLinkInventoryObjectRow(row)) {
        items.push(decodeLeafLinkInventoryObjectRow(row));
      }
    }
  }

  const statsTuple = Array.isArray(wire.st) ? (wire.st as LeafLinkInventoryCompactStats) : null;
  return {
    payload: {
      source: "leaflink",
      items,
      stats: statsTuple
        ? {
            totalSkus: statsTuple[0],
            totalInventoryUnits: statsTuple[1],
            totalInventoryValue: statsTuple[2],
            categoriesCount: statsTuple[3],
          }
        : readStats(wire),
      lastSyncedAt: typeof wire.ls === "number" ? unixSecToIso(wire.ls) : readLastSynced(wire),
      fromCache: wire.fc === 1 ? true : wire.fromCache === true,
      syncMode: readSyncMode(wire),
    },
    diagnostics: {
      ...diagnostics,
      decodedRowCount: items.length,
      rowsWithMissingId: items.filter((r) => !r.id).length,
      rowsWithMissingName: items.filter((r) => !r.productName).length,
      rowsWithMissingStatus: items.filter((r) => !r.status).length,
      firstDecodedRow: items[0] ?? null,
    },
  };
}

function readStats(wire: Record<string, unknown>) {
  const s = wire.stats;
  if (!s || typeof s !== "object") return undefined;
  const st = s as Record<string, unknown>;
  return {
    totalSkus: Number(st.totalSkus) || 0,
    totalInventoryUnits: Number(st.totalInventoryUnits) || 0,
    totalInventoryValue: Number(st.totalInventoryValue) || 0,
    categoriesCount: Number(st.categoriesCount) || 0,
  };
}

function readLastSynced(wire: Record<string, unknown>): string | undefined {
  const v = wire.lastSyncedAt;
  return typeof v === "string" && v.trim() ? v : undefined;
}

function readSyncMode(wire: Record<string, unknown>): "cache" | "full" | "incremental" | undefined {
  const sm = wire.sm ?? wire.syncMode;
  if (sm === "cache" || sm === "full" || sm === "incremental") return sm;
  return undefined;
}

/** Encode one normalized item row for API compact list (mirrors backend caps). */
export function encodeLeafLinkInventoryCompactRow(item: {
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
}): LeafLinkInventoryCompactRow {
  const capStr = (value: unknown, max: number) => {
    const s = String(value ?? "").trim();
    return s.length <= max ? s : s.slice(0, max);
  };
  const updatedAtUnixSec = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  };
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
