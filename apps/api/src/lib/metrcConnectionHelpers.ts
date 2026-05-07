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

export function messageForMetrcHttpFailure(status: number): string {
  if (status === 401)
    return "Authentication failed. Paste the full METRC user API key, use a real integrator vendor key (or leave vendor empty), and save before testing.";
  if (status === 403) return "Permission denied. Check METRC user permissions and license access.";
  if (status === 400) return "Bad request. Check license number, state, and base URL.";
  return `METRC returned HTTP ${status}.`;
}
