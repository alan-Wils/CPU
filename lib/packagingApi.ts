import { apiRequest } from "@/lib/api";

export async function loadPackagingBatches() {
  return apiRequest("/api/packaging");
}

export async function createPackagingBatch(batch: any) {
  return apiRequest("/api/packaging", {
    method: "POST",
    body: batch,
  });
}

export async function updatePackagingBatch(batchId: string, batch: any) {
  return apiRequest(`/api/packaging/${encodeURIComponent(batchId)}`, {
    method: "PUT",
    body: batch,
  });
}

export async function deletePackagingBatchRecord(batchId: string) {
  return apiRequest(`/api/packaging/${encodeURIComponent(batchId)}`, {
    method: "DELETE",
  });
}