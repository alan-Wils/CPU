/** LeafLink listing status filter — tolerant of display strings like "Available for sale". */
export function inventoryStatusMatchesFilter(rowStatus: string, filter: string): boolean {
  if (filter === "all") return true;
  const a = String(rowStatus || "").trim().toLowerCase();
  const b = String(filter || "").trim().toLowerCase();
  if (!a) return true;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}
