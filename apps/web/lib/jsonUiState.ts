/** Strip keys that must not be duplicated into JSON UI blobs sent to the API. */
export function pickSerializableUiFields(source: unknown, deny: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return out;
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (deny.has(k)) continue;
    if (v === undefined) continue;
    if (typeof v === "function") continue;
    try {
      JSON.stringify(v);
    } catch {
      continue;
    }
    out[k] = v;
  }
  return out;
}
