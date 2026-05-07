/** Parse METRC JSON body: either a bare array or `{ Data: [...] }`. */
export function parseLocationsPayload(bodyJson: unknown): Record<string, unknown>[] {
  if (Array.isArray(bodyJson)) {
    return bodyJson.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  if (bodyJson && typeof bodyJson === "object" && Array.isArray((bodyJson as { Data?: unknown }).Data)) {
    const data = (bodyJson as { Data: unknown[] }).Data;
    return data.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  return [];
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
