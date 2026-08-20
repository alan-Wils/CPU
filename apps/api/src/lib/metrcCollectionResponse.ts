/**
 * METRC v2 collection responses may be a bare array (legacy/sandbox) or a
 * paginated object with `Data`/`data` plus paging metadata.
 */

export const METRC_COLLECTION_PAGE_SIZE = 20;
export const METRC_COLLECTION_MAX_PAGES = 100;

export type MetrcCollectionPagination = {
  totalRecords: number | null;
  total: number | null;
  recordsOnPage: number | null;
  page: number | null;
  currentPage: number | null;
  totalPages: number | null;
  pageSize: number | null;
  pageNumber: number | null;
};

export type MetrcNormalizedCollection<T = unknown> = MetrcCollectionPagination & {
  records: T[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readOptionalInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function readPaginationField(
  body: Record<string, unknown>,
  pascalKey: string,
  camelKey: string,
): number | null {
  const fromPascal = readOptionalInt(body[pascalKey]);
  if (fromPascal != null) return fromPascal;
  return readOptionalInt(body[camelKey]);
}

/** Raw collection rows: direct array, `Data`, `data`, or empty on malformed input. */
export function normalizeMetrcCollectionRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const body = asRecord(payload);
  if (!body) return [];
  if (Array.isArray(body.Data)) return body.Data;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

export function extractMetrcCollectionPagination(payload: unknown): MetrcCollectionPagination {
  const empty: MetrcCollectionPagination = {
    totalRecords: null,
    total: null,
    recordsOnPage: null,
    page: null,
    currentPage: null,
    totalPages: null,
    pageSize: null,
    pageNumber: null,
  };
  const body = asRecord(payload);
  if (!body) return empty;
  return {
    totalRecords: readPaginationField(body, "TotalRecords", "totalRecords"),
    total: readPaginationField(body, "Total", "total"),
    recordsOnPage: readPaginationField(body, "RecordsOnPage", "recordsOnPage"),
    page: readPaginationField(body, "Page", "page"),
    currentPage: readPaginationField(body, "CurrentPage", "currentPage"),
    totalPages: readPaginationField(body, "TotalPages", "totalPages"),
    pageSize: readPaginationField(body, "PageSize", "pageSize"),
    pageNumber: readPaginationField(body, "PageNumber", "pageNumber"),
  };
}

export function normalizeMetrcCollectionResponse<T = unknown>(
  payload: unknown,
): MetrcNormalizedCollection<T> {
  const records = normalizeMetrcCollectionRecords(payload) as T[];
  return {
    records,
    ...extractMetrcCollectionPagination(payload),
  };
}

/** Prefer TotalRecords, then Total, then the normalized records length. */
export function metrcCollectionReportedTotal(
  payloadOrNormalized: unknown | MetrcNormalizedCollection,
): number {
  const normalized =
    payloadOrNormalized
    && typeof payloadOrNormalized === "object"
    && !Array.isArray(payloadOrNormalized)
    && Array.isArray((payloadOrNormalized as MetrcNormalizedCollection).records)
    && ("totalRecords" in (payloadOrNormalized as object) || "total" in (payloadOrNormalized as object))
      ? (payloadOrNormalized as MetrcNormalizedCollection)
      : normalizeMetrcCollectionResponse(payloadOrNormalized);
  if (normalized.totalRecords != null) return normalized.totalRecords;
  if (normalized.total != null) return normalized.total;
  return normalized.records.length;
}

export function extractMetrcRecordId(row: unknown): string | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const raw = rec.Id ?? rec.id;
  if (raw === undefined || raw === null || raw === "") return null;
  const id = String(raw).trim();
  return id || null;
}

/** Last row wins when METRC `Id`/`id` repeats across pages. Rows without an id are kept. */
export function dedupeMetrcRecordsById<T>(records: T[]): T[] {
  const byId = new Map<string, T>();
  const withoutId: T[] = [];
  for (const rec of records) {
    const id = extractMetrcRecordId(rec);
    if (!id) {
      withoutId.push(rec);
      continue;
    }
    byId.set(id, rec);
  }
  return [...byId.values(), ...withoutId];
}

export function shouldFetchNextMetrcCollectionPage(input: {
  pageNumber: number;
  maxPages?: number;
  pageSize?: number;
  recordsOnPage?: number;
  payload?: unknown;
  totalPages?: number | null;
}): boolean {
  const maxPages = input.maxPages ?? METRC_COLLECTION_MAX_PAGES;
  if (input.pageNumber >= maxPages) return false;
  const normalized =
    input.payload !== undefined ? normalizeMetrcCollectionResponse(input.payload) : null;
  const totalPages = input.totalPages ?? normalized?.totalPages ?? null;
  if (totalPages != null && totalPages > 0) {
    return input.pageNumber < totalPages;
  }
  const pageSize = input.pageSize ?? normalized?.pageSize ?? METRC_COLLECTION_PAGE_SIZE;
  const recordsOnPage = input.recordsOnPage ?? normalized?.records.length ?? 0;
  return recordsOnPage >= pageSize;
}

export function withMetrcCollectionPageQuery(
  pathnameAndQuery: string,
  pageNumber: number,
  pageSize: number = METRC_COLLECTION_PAGE_SIZE,
): string {
  const trimmed = String(pathnameAndQuery || "").trim();
  const qIndex = trimmed.indexOf("?");
  const path = qIndex >= 0 ? trimmed.slice(0, qIndex) : trimmed;
  const query = qIndex >= 0 ? trimmed.slice(qIndex + 1) : "";
  const q = new URLSearchParams(query);
  q.set("pageNumber", String(pageNumber));
  q.set("pageSize", String(pageSize));
  return `${path}?${q.toString()}`;
}

export async function fetchAllMetrcCollectionPages(input: {
  fetchPage: (pageNumber: number) => Promise<unknown>;
  maxPages?: number;
  pageSize?: number;
}): Promise<{
  records: unknown[];
  pagesFetched: number;
  reportedTotal: number;
}> {
  const maxPages = input.maxPages ?? METRC_COLLECTION_MAX_PAGES;
  const pageSize = input.pageSize ?? METRC_COLLECTION_PAGE_SIZE;
  const combined: unknown[] = [];
  let pagesFetched = 0;
  let reportedTotal = 0;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const payload = await input.fetchPage(pageNumber);
    const page = normalizeMetrcCollectionResponse(payload);
    pagesFetched += 1;
    combined.push(...page.records);
    reportedTotal = metrcCollectionReportedTotal(page);
    if (
      !shouldFetchNextMetrcCollectionPage({
        pageNumber,
        maxPages,
        pageSize,
        recordsOnPage: page.records.length,
        totalPages: page.totalPages,
        payload,
      })
    ) {
      break;
    }
  }

  return {
    records: dedupeMetrcRecordsById(combined),
    pagesFetched,
    reportedTotal,
  };
}
