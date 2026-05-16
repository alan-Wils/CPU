import { apiRequest } from "@/lib/api";

export async function loadCultivationBatches() {
  return apiRequest("/api/cultivation");
}

export async function createCultivationBatch(batch: any) {
  return apiRequest("/api/cultivation", {
    method: "POST",
    body: batch,
  });
}

export async function updateCultivationBatch(batchId: string, batch: any) {
  return apiRequest(`/api/cultivation/${encodeURIComponent(batchId)}`, {
    method: "PUT",
    body: batch,
  });
}

export async function deleteCultivationBatch(batchId: string) {
  return apiRequest(`/api/cultivation/${encodeURIComponent(batchId)}`, {
    method: "DELETE",
  });
}

export async function loadMotherPlants(): Promise<{ motherPlants: unknown[] }> {
  return apiRequest("/api/cultivation/mothers");
}

export async function saveMotherPlants(motherPlants: unknown[]) {
  return apiRequest("/api/cultivation/mothers", {
    method: "PUT",
    body: { motherPlants },
  });
}