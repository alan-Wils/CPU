export type MetrcPlantBatchGrowthPhaseName = "Vegetative" | "Flowering";

export function buildMetrcPlantBatchGrowthPhaseBody(input: {
  plantBatchName: string;
  growthPhase: MetrcPlantBatchGrowthPhaseName;
  count: number;
  startingTag: string;
  growthDate: string;
  locationName?: string | null;
}): unknown[] {
  const name = String(input.plantBatchName || "").trim();
  const startingTag = String(input.startingTag || "").trim();
  const location = String(input.locationName || "").trim();
  return [
    {
      Name: name,
      CountPerPlant: null,
      Count: input.count,
      StartingTag: startingTag,
      GrowthPhase: input.growthPhase,
      NewLocation: location || null,
      NewSublocation: null,
      GrowthDate: input.growthDate,
      PatientLicenseNumber: null,
    },
  ];
}
