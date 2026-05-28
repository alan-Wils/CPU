export const METRC_DEFAULT_MOTHER_PLANT_PACKAGE_NOTE =
  "NexBatch sandbox evaluation - package from mother plant.";

export function buildMetrcMotherPlantPackageBody(input: {
  metrcPlantId: number;
  packageTag: string;
  count: number;
  actualDate: string;
  locationName?: string | null;
  itemName: string;
  note?: string | null;
}): unknown[] {
  const location = String(input.locationName || "").trim();
  const item = String(input.itemName || "").trim();
  return [
    {
      Id: input.metrcPlantId,
      PlantBatch: null,
      Count: input.count,
      Tag: input.packageTag.trim(),
      Location: location || null,
      Item: item,
      PatientLicenseNumber: null,
      Note: String(input.note || "").trim() || METRC_DEFAULT_MOTHER_PLANT_PACKAGE_NOTE,
      IsTradeSample: false,
      IsDonation: false,
      ActualDate: input.actualDate,
    },
  ];
}
