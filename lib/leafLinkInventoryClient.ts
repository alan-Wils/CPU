import type { LeafLinkInventoryDto, LeafLinkInventoryItemDto } from "@/lib/api";
import { expandLeafLinkInventoryDto } from "@/lib/leafLinkInventoryCompact";

const LIST_CACHE_MS = 3 * 60_000;

let cached: LeafLinkInventoryDto | null = null;
let cachedExpanded: LeafLinkInventoryDto | null = null;
let cachedAt = 0;
let inflight: Promise<LeafLinkInventoryDto> | null = null;

export function clearLeafLinkInventoryClientCache(): void {
  cached = null;
  cachedExpanded = null;
  cachedAt = 0;
  inflight = null;
}

export function peekLeafLinkInventoryClientCache(): LeafLinkInventoryDto | null {
  if (!cachedExpanded) return null;
  if (Date.now() - cachedAt > LIST_CACHE_MS) return null;
  return cachedExpanded;
}

/**
 * Dedupes concurrent GET /api/inventory/leaflink and reuses a short TTL cache (skip on refresh).
 */
export async function fetchLeafLinkInventoryDeduped(
  loader: () => Promise<LeafLinkInventoryDto>,
  opts?: { refresh?: boolean },
): Promise<LeafLinkInventoryDto> {
  const refresh = Boolean(opts?.refresh);
  const now = Date.now();
  if (!refresh && cachedExpanded && now - cachedAt < LIST_CACHE_MS) {
    return cachedExpanded;
  }
  if (!refresh && inflight) {
    return inflight;
  }
  inflight = loader()
    .then((raw) => {
      cached = raw;
      cachedExpanded = expandLeafLinkInventoryDto(raw);
      cachedAt = Date.now();
      return cachedExpanded;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Map expanded list row for table rendering. */
export function leafLinkListRowToUiDto(row: LeafLinkInventoryItemDto): LeafLinkInventoryItemDto {
  return {
    ...row,
    imageUrl: row.imageUrl ?? "",
  };
}
