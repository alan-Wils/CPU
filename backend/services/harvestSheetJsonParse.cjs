/**
 * @param {string} raw
 * @returns {{ rows: Array<{tag?: string, weightValue?: number|null, unitGuess?: string}>, bundles?: number|null, totalGrams?: number|null, notes?: string }}
 */
function parseHarvestSheetJsonResponse(raw) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model did not return JSON object");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Invalid JSON from model");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Parsed payload not an object");
  }
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const normalized = rows.map((r) => ({
    tag: r && r.tag != null ? String(r.tag).trim() : "",
    weightValue:
      r && r.weightValue != null && Number.isFinite(Number(r.weightValue))
        ? Number(r.weightValue)
        : null,
    unitGuess: r && r.unitGuess != null ? String(r.unitGuess).trim().toLowerCase() : "unknown",
  }));
  return {
    rows: normalized,
    bundles:
      parsed.bundles != null && Number.isFinite(Number(parsed.bundles))
        ? Number(parsed.bundles)
        : null,
    totalGrams:
      parsed.totalGrams != null && Number.isFinite(Number(parsed.totalGrams))
        ? Number(parsed.totalGrams)
        : null,
    notes: parsed.notes != null ? String(parsed.notes).trim() : "",
  };
}

module.exports = { parseHarvestSheetJsonResponse };
