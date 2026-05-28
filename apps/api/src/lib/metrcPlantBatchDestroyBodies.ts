export function buildMetrcPlantBatchDestroyBody(input: {
  plantBatchName: string;
  count: number;
  actualDate: string;
  note?: string | null;
}): unknown[] {
  const name = String(input.plantBatchName || "").trim();
  const entry: Record<string, unknown> = {
    PlantBatch: name,
    Count: input.count,
    ActualDate: input.actualDate,
  };
  const note = String(input.note || "").trim();
  if (note) {
    entry.Note = note;
  }
  return [entry];
}
