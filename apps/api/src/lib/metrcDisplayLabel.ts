/**
 * Human-readable label from METRC scalar or nested object fields (e.g. FacilityType).
 * Never uses `String(object)` — that yields "[object Object]" in React tables.
 */
export function readMetrcDisplayLabel(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = readMetrcDisplayLabel(item);
      if (s) return s;
    }
    return "";
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = [
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
      "Description",
      "description",
      "Title",
      "title",
    ];
    for (const k of keys) {
      if (!(k in o)) continue;
      const s = readMetrcDisplayLabel(o[k]);
      if (s) return s;
    }
    return "";
  }
  return "";
}
