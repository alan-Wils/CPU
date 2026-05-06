export type ParsedHarvestSheetJson = {
    rows: Array<{ tag: string; weightValue: number | null; unitGuess: string }>;
    bundles: number | null;
    totalGrams: number | null;
    notes: string;
};

export function parseHarvestSheetJsonResponse(raw: string): ParsedHarvestSheetJson {
    const text = String(raw || "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
        throw new Error("Model did not return JSON object");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
        throw new Error("Invalid JSON from model");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Parsed payload not an object");
    }
    const o = parsed as Record<string, unknown>;
    const rows = Array.isArray(o.rows) ? o.rows : [];
    const normalized = rows.map((r) => {
        const row = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
        const tag = row.tag != null ? String(row.tag).trim() : "";
        const w = row.weightValue;
        const weightValue =
            w != null && Number.isFinite(Number(w)) ? Number(w) : null;
        const ug = row.unitGuess != null ? String(row.unitGuess).trim().toLowerCase() : "unknown";
        return { tag, weightValue, unitGuess: ug };
    });
    return {
        rows: normalized,
        bundles:
            o.bundles != null && Number.isFinite(Number(o.bundles))
                ? Number(o.bundles)
                : null,
        totalGrams:
            o.totalGrams != null && Number.isFinite(Number(o.totalGrams))
                ? Number(o.totalGrams)
                : null,
        notes: o.notes != null ? String(o.notes).trim() : "",
    };
}
