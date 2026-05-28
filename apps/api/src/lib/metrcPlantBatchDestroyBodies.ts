export function buildMetrcPlantBatchDestroyBody(input: {
  plantBatchName: string;
  count: number;
  actualDate: string;
  wasteReasonName: string;
  reasonNote: string;
  wasteMethodName?: string | null;
  wasteWeight?: number | null;
  wasteUnitOfMeasureName?: string | null;
}): unknown[] {
  const plantBatch = String(input.plantBatchName || "").trim();
  const entry: Record<string, unknown> = {
    PlantBatch: plantBatch,
    Count: input.count,
    WasteReasonName: String(input.wasteReasonName || "").trim(),
    ReasonNote: String(input.reasonNote || "").trim(),
    ActualDate: input.actualDate,
  };
  const wasteMethodName = String(input.wasteMethodName || "").trim();
  if (wasteMethodName) {
    entry.WasteMethodName = wasteMethodName;
  }
  if (
    input.wasteWeight != null &&
    Number.isFinite(input.wasteWeight) &&
    input.wasteWeight > 0
  ) {
    entry.WasteWeight = input.wasteWeight;
  }
  const wasteUnitOfMeasureName = String(input.wasteUnitOfMeasureName || "").trim();
  if (wasteUnitOfMeasureName) {
    entry.WasteUnitOfMeasureName = wasteUnitOfMeasureName;
  }
  return [entry];
}
