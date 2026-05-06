/** Sort strain-like objects by display name (then acronym) for selects and lists. */
export function sortStrainsAlphabetically<
  T extends { name?: string; strain?: string; acronym?: string },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const labelA = String(a.name ?? a.strain ?? "").trim().toLowerCase();
    const labelB = String(b.name ?? b.strain ?? "").trim().toLowerCase();
    const keyA = labelA || String(a.acronym ?? "").trim().toLowerCase();
    const keyB = labelB || String(b.acronym ?? "").trim().toLowerCase();
    const c = keyA.localeCompare(keyB, undefined, { sensitivity: "base" });
    if (c !== 0) return c;
    return String(a.acronym ?? "")
      .trim()
      .localeCompare(String(b.acronym ?? "").trim(), undefined, { sensitivity: "base" });
  });
}
