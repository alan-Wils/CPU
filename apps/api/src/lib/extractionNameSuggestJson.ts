/**
 * Parse model output into a clean suggestions array (exported for unit tests).
 */
export function parseModelSuggestionsJson(raw: string): string[] {
  let text = String(raw || "").trim();
  if (!text) return [];

  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/im.exec(text);
  if (fence?.[1]) text = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const suggestions = (parsed as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];

  const out: string[] = [];
  for (const item of suggestions) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || t.length > 80) continue;
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}
