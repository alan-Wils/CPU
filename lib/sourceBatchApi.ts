import { apiRequest } from "@/lib/api";

export async function loadSourceBatches() {
  return apiRequest("/api/source-batches");
}

export async function createSourceBatch(batch: any) {
  return apiRequest("/api/source-batches", {
    method: "POST",
    body: batch,
  });
}

export async function updateSourceBatch(batchId: string, batch: any) {
  return apiRequest(`/api/source-batches/${encodeURIComponent(batchId)}`, {
    method: "PUT",
    body: batch,
  });
}

export async function deleteSourceBatchRecord(batchId: string) {
  return apiRequest(`/api/source-batches/${encodeURIComponent(batchId)}`, {
    method: "DELETE",
  });
}