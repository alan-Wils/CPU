/**
 * Dry canopy allocation: flower table sq ft is split by the share of plants
 * harvested on the dry (A-grade) path vs plants counted at move-to-flower.
 */

export type FlowerRoomForSqFt = Readonly<{
  id: string;
  bays: ReadonlyArray<{
    id: string;
    tables: ReadonlyArray<{ id: string; squareFeet?: string }>;
  }>;
}>;

export function sumTableSquareFeetFromIds(
  flowerRooms: ReadonlyArray<FlowerRoomForSqFt>,
  flowerRoomId: string,
  flowerBayId: string,
  flowerTableIds: ReadonlyArray<string>,
): number {
  const room = flowerRooms.find((r) => r.id === flowerRoomId);
  if (!room) return 0;
  const bay = room.bays.find((b) => b.id === flowerBayId);
  if (!bay) return 0;
  let sum = 0;
  for (const tid of flowerTableIds) {
    const t = bay.tables.find((x) => x.id === tid);
    if (!t) continue;
    const sf = Number(String(t.squareFeet ?? "").replace(/,/g, ""));
    if (Number.isFinite(sf) && sf > 0) sum += sf;
  }
  return sum;
}

/**
 * Allocated dry canopy = total selected table sq ft × min(1, plantsHarvestedDry / plantsAtFlower).
 */
export function computeAllocatedDryCanopySqFt(
  totalTableSqFt: number,
  plantsAtFlower: number,
  plantsHarvestedDry: number,
): number {
  const denom = Math.max(1, plantsAtFlower);
  const pDry = Math.max(0, plantsHarvestedDry);
  const frac = Math.min(1, pDry / denom);
  const t = Math.max(0, totalTableSqFt);
  return t * frac;
}

export function computeDryYieldGPerSqFt(
  grams: number,
  dryCanopySqFt: number,
  eps = 1e-6,
): number {
  const g = Math.max(0, grams);
  const sq = Math.max(dryCanopySqFt, eps);
  return g / sq;
}

export function meanFinite(values: number[]): number | null {
  const xs = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
