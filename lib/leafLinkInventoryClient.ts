import type { LeafLinkInventoryDto, LeafLinkInventoryItemDto } from "@/lib/api";

const LIST_CACHE_MS = 3 * 60_000;

let cached: LeafLinkInventoryDto | null = null;
let cachedAt = 0;
let inflight: Promise<LeafLinkInventoryDto> | null = null;

export function clearLeafLinkInventoryClientCache(): void {
  cached = null;
  cachedAt = 0;
  inflight = null;
}

export function peekLeafLinkInventoryClientCache(): LeafLinkInventoryDto | null {
  if (!cached) return null;
  if (Date.now() - cachedAt > LIST_CACHE_MS) return null;
  return cached;
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
  if (!refresh && cached && now - cachedAt < LIST_CACHE_MS) {
    return cached;
  }
  if (!refresh && inflight) {
    return inflight;
  }
  inflight = loader()
    .then((out) => {
      cached = out;
      cachedAt = Date.now();
      return out;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Map compact list rows (no imageUrl) to UI DTO with empty image until detail fetch. */
export function leafLinkListRowToUiDto(
  row: LeafLinkInventoryItemDto & { hasImage?: boolean },
): LeafLinkInventoryItemDto {
  return {
    ...row,
    imageUrl: row.imageUrl ?? "",
  };
}
