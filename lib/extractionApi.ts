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