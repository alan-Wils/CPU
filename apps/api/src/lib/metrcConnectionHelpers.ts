import {
  extractMetrcCollectionPagination,
  normalizeMetrcCollectionRecords,
} from "./metrcCollectionResponse.js";

export {
  metrcCollectionReportedTotal,
  normalizeMetrcCollectionRecords,
  normalizeMetrcCollectionResponse,
} from "./metrcCollectionResponse.js";

/** Parse METRC JSON body: bare array, `{ Data: [...] }`, or `{ data: [...] }` of objects. */
export function parseMetrcDataRecords(bodyJson: unknown): Record<string, unknown>[] {
  return normalizeMetrcCollectionRecords(bodyJson).filter(
    (x) => x && typeof x === "object" && !Array.isArray(x),
  ) as Record<string, unknown>[];
}

export function metrcDataRecordCount(bodyJson: unknown): number {
  return parseMetrcDataRecords(bodyJson).length;
}

export function extractMetrcListPagination(bodyJson: unknown): Record<string, unknown> | null {
  const paging = extractMetrcCollectionPagination(bodyJson);
  const out: Record<string, unknown> = {};
  if (paging.total != null) out.Total = paging.total;
  if (paging.totalRecords != null) out.TotalRecords = paging.totalRecords;
  if (paging.totalPages != null) out.TotalPages = paging.totalPages;
  if (paging.pageSize != null) out.PageSize = paging.pageSize;
  if (paging.pageNumber != null) out.PageNumber = paging.pageNumber;
  if (paging.currentPage != null) out.CurrentPage = paging.currentPage;
  if (paging.recordsOnPage != null) out.RecordsOnPage = paging.recordsOnPage;
  if (paging.page != null) out.Page = paging.page;
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse METRC JSON body: either a bare array or `{ Data: [...] }`. */
export function parseLocationsPayload(bodyJson: unknown): Record<string, unknown>[] {
  return parseMetrcDataRecords(bodyJson);
}

/**
 * Labels from GET /tags/v2/plant/available (bare array or `Data`).
 * Uses `Label` per METRC docs; trims and drops blanks.
 */
export function parsePlantTagLabelsFromAvailableResponse(bodyJson: unknown): string[] {
  const rows = parseMetrcDataRecords(bodyJson);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row.Label ?? row.label;
    const s = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Reason names from GET /plantbatches/v2/waste/reasons (bare array, `Data`, or string list).
 */
export function parseMetrcPlantBatchWasteReasonNames(bodyJson: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const s = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const processItems = (items: unknown[]) => {
    for (const item of items) {
      if (typeof item === "string") {
        push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        push(row.Name ?? row.name ?? row.WasteReasonName ?? row.wasteReasonName);
      }
    }
  };
  processItems(normalizeMetrcCollectionRecords(bodyJson));
  return out;
}

/**
 * Lab test type names from GET /labtests/v2/types (bare array, `Data`, or string list).
 */
export function parseMetrcLabTestTypeNames(bodyJson: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const s = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  const processItems = (items: unknown[]) => {
    for (const item of items) {
      if (typeof item === "string") {
        push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        push(row.Name ?? row.name ?? row.LabTestTypeName ?? row.labTestTypeName);
      }
    }
  };
  processItems(normalizeMetrcCollectionRecords(bodyJson));
  return out;
}

export type MetrcSampleLocation = {
  id: string | number;
  name: string;
  label?: string;
};

export function toSampleLocation(loc: Record<string, unknown>): MetrcSampleLocation {
  const idRaw = loc.Id ?? loc.id ?? "";
  const id =
    typeof idRaw === "string" || typeof idRaw === "number" ? idRaw : String(idRaw ?? "");
  const name = String(loc.Name ?? loc.name ?? loc.DisplayName ?? loc.displayName ?? "").slice(0, 200);
  const labelRaw = loc.Label ?? loc.label;
  const label =
    labelRaw !== undefined && labelRaw !== null && String(labelRaw).trim()
      ? String(labelRaw).slice(0, 200)
      : undefined;
  return { id, name, ...(label ? { label } : {}) };
}

/**
 * Pull a short, display-safe summary from METRC error JSON when present.
 * Avoid echoing huge payloads or values that look like secrets.
 */
export function extractMetrcApiErrorSummary(bodyJson: unknown, bodyText: string, maxLen = 320): string | null {
  if (bodyJson && typeof bodyJson === "object" && !Array.isArray(bodyJson)) {
    const o = bodyJson as Record<string, unknown>;
    const direct = [o.Message, o.message, o.Error, o.error, o.ExceptionMessage, o.exceptionMessage];
    for (const c of direct) {
      if (typeof c === "string" && c.trim()) {
        const s = sanitizeMetrcErrorSnippet(c.trim(), maxLen);
        if (s) return s;
      }
    }
    const errors = o.Errors ?? o.errors;
    if (Array.isArray(errors) && errors.length && errors[0] && typeof errors[0] === "object") {
      const e0 = errors[0] as Record<string, unknown>;
      const m = e0.Message ?? e0.message;
      if (typeof m === "string" && m.trim()) {
        const s = sanitizeMetrcErrorSnippet(m.trim(), maxLen);
        if (s) return s;
      }
    }
  }
  const t = String(bodyText || "").trim();
  if (!t || t.length > 800) return null;
  if (/^<!DOCTYPE/i.test(t) || /<html[\s>]/i.test(t)) return null;
  try {
    JSON.parse(t);
    return null;
  } catch {
    return sanitizeMetrcErrorSnippet(t.slice(0, maxLen), maxLen);
  }
}

function sanitizeMetrcErrorSnippet(s: string, maxLen: number): string | null {
  const trimmed = s.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9+/=_-]{48,}$/.test(trimmed)) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

export function messageForMetrcHttpFailure(status: number, metrcDetail?: string | null): string {
  const detail =
    metrcDetail && String(metrcDetail).trim()
      ? ` (${String(metrcDetail).trim().slice(0, 400)})`
      : "";

  if (status === 401)
    return `Authentication failed. Paste the full METRC user API key, use a real integrator vendor key (or leave vendor empty), and save before testing.${detail}`;
  if (status === 403)
    return `Permission denied. Check METRC user permissions and license access.${detail}`;
  if (status === 400) return `Bad request. Check license number, state, and base URL.${detail}`;
  if (status === 500 || status === 502 || status === 503)
    return `METRC returned HTTP ${status} (server error). Try again in a few minutes. Confirm license format and base URL match Colorado production; if this persists, it may be on METRC's side.${detail}`;
  return `METRC returned HTTP ${status}.${detail}`;
}
