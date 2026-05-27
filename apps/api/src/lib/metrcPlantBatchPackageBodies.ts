export const METRC_DEFAULT_PLANT_BATCH_PACKAGE_NOTE =
  "NexBatch sandbox evaluation - plant batch package.";

export function buildMetrcPlantBatchPackageBody(input: {
  plantBatchName: string;
  packageTag: string;
  count: number;
  actualDate: string;
  locationName?: string | null;
  itemName: string;
  note?: string | null;
}): unknown[] {
  const location = String(input.locationName || "").trim();
  const plantBatch = String(input.plantBatchName || "").trim();
  const item = String(input.itemName || "").trim();
  return [
    {
      PlantBatch: plantBatch,
      Count: input.count,
      Tag: input.packageTag.trim(),
      Location: location || null,
      Item: item,
      PatientLicenseNumber: null,
      Note: String(input.note || "").trim() || METRC_DEFAULT_PLANT_BATCH_PACKAGE_NOTE,
      IsTradeSample: false,
      IsDonation: false,
      ActualDate: input.actualDate,
    },
  ];
}
