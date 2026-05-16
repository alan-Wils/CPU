import { apiRequest } from "@/lib/api";

export async function loadExtractionBatches() {
  return apiRequest("/api/extraction");
}

export async function createExtractionBatch(batch: any) {
  return apiRequest("/api/extraction", {
    method: "POST",
    body: batch,
  });
}

export async function updateExtractionBatch(batchId: string, batch: any) {
  return apiRequest(`/api/extraction/${encodeURIComponent(batchId)}`, {
    method: "PUT",
    body: batch,
  });
}

export async function deleteExtractionBatchRecord(batchId: string) {
  return apiRequest(`/api/extraction/${encodeURIComponent(batchId)}`, {
    method: "DELETE",
  });
}

/** Register oil produced outside NexBatch as a completed extraction run (packaging + edibles pool). */
export async function registerLegacyOilIntake(body: {
  cultivationBatchId?: string;
  strain?: string;
  strainAcronym?: string;
  plantedAt?: string;
  outputGrams: number;
  inputGrams?: number;
  productType?: string;
  productCategory?: "LIVE" | "CURED_WAX";
  externalReference?: string | null;
  notes?: string | null;
}) {
  return apiRequest<{ extractionRun: { id: string; cultivationBatchId?: string; outputGrams?: number } }>(
    "/api/workflow/extraction-runs/legacy-oil-intake",
    { method: "POST", body },
  );
}

