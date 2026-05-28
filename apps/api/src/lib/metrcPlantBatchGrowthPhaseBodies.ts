export type MetrcPlantBatchGrowthPhaseName = "Vegetative" | "Flowering";

export function buildMetrcPlantBatchGrowthPhaseBody(input: {
  plantBatchName: string;
  growthPhase: MetrcPlantBatchGrowthPhaseName;
  count: number;
  actualDate: string;
  locationName?: string | null;
  note?: string | null;
}): unknown[] {
  const name = String(input.plantBatchName || "").trim();
  const entry: Record<string, unknown> = {
    Name: name,
    GrowthPhase: input.growthPhase,
    Count: input.count,
    GrowthDate: input.actualDate,
  };
  const location = String(input.locationName || "").trim();
  if (location) {
    entry.NewLocation = location;
  }
  const note = String(input.note || "").trim();
  if (note) {
    entry.Note = note;
  }
  return [entry];
}
