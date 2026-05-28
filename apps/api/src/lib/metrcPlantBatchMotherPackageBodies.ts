export const METRC_DEFAULT_MOTHER_PLANT_PACKAGE_NOTE =
  "NexBatch sandbox evaluation - package from mother plant.";

export function buildMetrcMotherPlantPackageBody(input: {
  sourcePlantLabel: string;
  packageTag: string;
  count: number;
  actualDate: string;
  locationName?: string | null;
  itemName: string;
  note?: string | null;
}): unknown[] {
  const location = String(input.locationName || "").trim();
  const plantBatch = String(input.sourcePlantLabel || "").trim();
  const item = String(input.itemName || "").trim();
  const row: Record<string, unknown> = {
    PlantBatch: plantBatch,
    Count: input.count,
    Tag: input.packageTag.trim(),
    Item: item,
    Note: String(input.note || "").trim() || METRC_DEFAULT_MOTHER_PLANT_PACKAGE_NOTE,
    IsTradeSample: false,
    IsDonation: false,
    ActualDate: input.actualDate,
  };
  if (location) {
    row.Location = location;
  }
  return [row];
}
