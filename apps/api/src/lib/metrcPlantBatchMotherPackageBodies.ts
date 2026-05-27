export const METRC_DEFAULT_MOTHER_PLANT_PACKAGE_ITEM = "Immature Plants";

export function buildMetrcMotherPlantPackageBody(input: {
  plantBatchId: number;
  plantBatchName?: string | null;
  packageTag: string;
  count: number;
  actualDate: string;
  locationName?: string | null;
  itemName?: string | null;
  note?: string | null;
}): unknown[] {
  const location = String(input.locationName || "").trim();
  return [
    {
      Id: input.plantBatchId,
      PlantBatch: String(input.plantBatchName || "").trim() || null,
      Count: input.count,
      Location: location || null,
      Sublocation: null,
      Item: String(input.itemName || "").trim() || METRC_DEFAULT_MOTHER_PLANT_PACKAGE_ITEM,
      Tag: input.packageTag.trim(),
      PatientLicenseNumber: null,
      Note: String(input.note || "").trim() || "NexBatch sandbox evaluation — package from mother plant batch.",
      IsTradeSample: false,
      IsDonation: false,
      ActualDate: input.actualDate,
    },
  ];
}
