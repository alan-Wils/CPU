import type { LeafLinkInventoryDto } from "@/lib/api";
import {
  countWireInventoryRows,
  expandLeafLinkInventoryDto,
  diagnoseLeafLinkInventoryDecode,
} from "@/lib/leafLinkInventoryCompact";

export type LeafLinkInventoryPipelineDebug = {
  wireRowCount: number;
  decodedRowCount: number;
  normalizedRowCount: number;
  filteredRowCount: number | null;
  firstDecodedSku: string;
  firstDecodedName: string;
  firstDecodedStatus: string;
  firstDecodedQuantity: number;
  schemaMismatch: boolean;
  schemaMismatchReason: string | null;
};

export type LeafLinkInventoryDedupedResult = LeafLinkInventoryDto & {
  pipeline?: LeafLinkInventoryPipelineDebug;
};

function buildPipelineDebug(
  raw: LeafLinkInventoryDto,
  expanded: LeafLinkInventoryDto,
): LeafLinkInventoryPipelineDebug {
  const diag = diagnoseLeafLinkInventoryDecode(raw);
  const first = diag.firstDecodedRow;
  const decodedRowCount = (expanded.items || []).length;
  return {
    wireRowCount: countWireInventoryRows(raw),
    decodedRowCount,
    normalizedRowCount: decodedRowCount,
    filteredRowCount: null,
    firstDecodedSku: first?.sku ?? "",
    firstDecodedName: first?.productName ?? "",
    firstDecodedStatus: first?.status ?? "",
    firstDecodedQuantity: first?.availableQuantity ?? 0,
    schemaMismatch: diag.schemaMismatch,
    schemaMismatchReason: diag.schemaMismatchReason,
  };
}

const LIST_CACHE_MS = 3 * 60_000;

let cached: LeafLinkInventoryDto | null = null;
let cachedExpanded: LeafLinkInventoryDto | null = null;
let cachedAt = 0;
let inflight: Promise<LeafLinkInventoryDto> | null = null;
let detailFallbackUsed = false;

export function clearLeafLinkInventoryClientCache(): void {
  cached = null;
  cachedExpanded = null;
  cachedAt = 0;
  inflight = null;
  detailFallbackUsed = false;
}

export function peekLeafLinkInventoryClientCache(): LeafLinkInventoryDto | null {
  if (!cachedExpanded) return null;
  if (Date.now() - cachedAt > LIST_CACHE_MS) return null;
  if (!(cachedExpanded.items || []).length) return null;
  return cachedExpanded;
}

function wireHasRowsButDecodeEmpty(raw: LeafLinkInventoryDto, expanded: LeafLinkInventoryDto): boolean {
  const wireRows = countWireInventoryRows(raw);
  const decoded = (expanded.items || []).length;
  const diag = diagnoseLeafLinkInventoryDecode(raw);
  return wireRows > 0 && decoded === 0 && !diag.schemaMismatch;
}

export type FetchLeafLinkInventoryDedupedOptions = {
  refresh?: boolean;
  /** When compact decode yields 0 rows but wire has rows, fetch detail=1 once. */
  fetchDetailFallback?: () => Promise<LeafLinkInventoryDto>;
};

/**
 * Dedupes concurrent GET /api/inventory/leaflink and reuses a short TTL cache (skip on refresh).
 */
export async function fetchLeafLinkInventoryDeduped(
  loader: () => Promise<LeafLinkInventoryDto>,
  opts?: FetchLeafLinkInventoryDedupedOptions,
): Promise<LeafLinkInventoryDedupedResult> {
  const refresh = Boolean(opts?.refresh);
  const now = Date.now();
  if (!refresh && cachedExpanded && (cachedExpanded.items || []).length && now - cachedAt < LIST_CACHE_MS) {
    return cachedExpanded;
  }
  if (!refresh && inflight) {
    return inflight;
  }

  inflight = (async () => {
    let raw = await loader();
    let expanded = expandLeafLinkInventoryDto(raw);

    const needsFallback =
      wireHasRowsButDecodeEmpty(raw, expanded) &&
      !detailFallbackUsed &&
      typeof opts?.fetchDetailFallback === "function";

    if (needsFallback) {
      detailFallbackUsed = true;
      console.error(
        "[LEAFLINK_INVENTORY] compact decode empty while wire has rows — retrying with detail=1 fallback",
        { wireRowCount: countWireInventoryRows(raw) },
      );
      try {
        raw = await opts.fetchDetailFallback!();
        expanded = expandLeafLinkInventoryDto(raw);
      } catch (err) {
        console.error("[LEAFLINK_INVENTORY] detail=1 fallback failed", err);
      }
    }

    if (wireHasRowsButDecodeEmpty(raw, expanded)) {
      throw new Error(
        "Inventory could not be decoded from the server response. Try Refresh or contact support.",
      );
    }

    if ((expanded.items || []).length) {
      cached = raw;
      cachedExpanded = expanded;
      cachedAt = Date.now();
    }
    return {
      ...expanded,
      pipeline: buildPipelineDebug(raw, expanded),
    };
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** Map expanded list row for table rendering. */
export function leafLinkListRowToUiDto(
  row: NonNullable<LeafLinkInventoryDto["items"]>[number],
): NonNullable<LeafLinkInventoryDto["items"]>[number] {
  return {
    ...row,
    imageUrl: row.imageUrl ?? "",
  };
}
