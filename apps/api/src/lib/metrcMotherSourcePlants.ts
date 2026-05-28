/** Veg / flowering METRC plants eligible as a mother-plant package source. */
export function isMetrcMotherSourceGrowthPhase(growthPhase: string): boolean {
  const phase = String(growthPhase || "").trim().toLowerCase();
  if (!phase) return false;
  if (phase.includes("immatur") || phase.includes("clone")) return false;
  return (
    phase.includes("veg") ||
    phase.includes("flower") ||
    phase === "mother" ||
    phase === "motherplant"
  );
}

export function parseMetrcPlantApiId(metrcPlantId: string): number | null {
  const parsed = Number.parseInt(String(metrcPlantId || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}
