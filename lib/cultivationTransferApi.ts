import { apiRequest } from "@/lib/api";

export type CultivationTransferMaterialType = "FRESH_FROZEN" | "TRIM";
export type CultivationTransferStatus =
  | "READY_TO_TRANSFER"
  | "STORED"
  | "TRANSFERRED_TO_EXTRACTION";
export type CultivationTransferStorageType = "FREEZER" | "DRY_ROOM";

export type CultivationExtractionTransferRow = {
  id: string;
  materialType: CultivationTransferMaterialType;
  transferStatus: CultivationTransferStatus;
  sourceCultivationBatchId: string;
  sourceDryFlowerBatchId: string | null;
  sourceEventType: string | null;
  sourceEventAt: string | null;
  storageType: CultivationTransferStorageType | null;
  storageLocationId: string | null;
  storageLocationName: string | null;
  displayName: string;
  harvestCode: string | null;
  weightLbs: number | null;
  grams: number | null;
  bundles: number | null;
  materialPayload: Record<string, unknown> | null;
  extractionSourceBatchId: string | null;
  transferredAt: string | null;
  transferredByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListCultivationTransfersQuery = {
  status?: CultivationTransferStatus | "pending";
  materialType?: CultivationTransferMaterialType;
  batch?: string;
  storageLocationId?: string;
};

export async function listCultivationExtractionTransfers(
  query?: ListCultivationTransfersQuery,
): Promise<CultivationExtractionTransferRow[]> {
  const params = new URLSearchParams();
  if (query?.status) params.set("status", query.status);
  if (query?.materialType) params.set("materialType", query.materialType);
  if (query?.batch) params.set("batch", query.batch);
  if (query?.storageLocationId) params.set("storageLocationId", query.storageLocationId);
  const qs = params.toString();
  const data = await apiRequest(`/api/cultivation-extraction-transfers${qs ? `?${qs}` : ""}`);
  return Array.isArray(data?.rows) ? data.rows : [];
}

export async function createCultivationExtractionTransfer(body: Record<string, unknown>) {
  return apiRequest("/api/cultivation-extraction-transfers", {
    method: "POST",
    body,
  });
}

export async function patchCultivationExtractionTransfer(
  id: string,
  body: {
    storageLocationId?: string;
    storageLocationName?: string;
    transferStatus?: CultivationTransferStatus;
  },
) {
  return apiRequest(`/api/cultivation-extraction-transfers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}

export async function transferCultivationExtractionToExtraction(
  ids: string[],
): Promise<{ rows: CultivationExtractionTransferRow[]; sourceBatches: unknown[] }> {
  return apiRequest("/api/cultivation-extraction-transfers/transfer", {
    method: "POST",
    body: { ids },
  });
}
