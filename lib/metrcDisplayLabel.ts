/**
 * Safe METRC field label for React (never renders "[object Object]").
 */
export function formatMetrcDisplayLabel(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = formatMetrcDisplayLabel(item);
      if (s) return s;
    }
    return "";
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of [
      "NameDisplay",
      "nameDisplay",
      "Name",
      "name",
      "Label",
      "label",
      "Value",
      "value",
      "DisplayName",
      "displayName",
    ]) {
      if (!(k in o)) continue;
      const s = formatMetrcDisplayLabel(o[k]);
      if (s) return s;
    }
    return "";
  }
  return "";
}

export function formatMetrcFacilityTypeLabel(row: {
  facilityTypeName?: string | null;
  facilityType?: unknown;
}): string {
  const fromName = formatMetrcDisplayLabel(row.facilityTypeName);
  if (fromName) return fromName;
  const fromLegacy = formatMetrcDisplayLabel(row.facilityType);
  if (fromLegacy && fromLegacy !== "[object Object]") return fromLegacy;
  return "";
}
