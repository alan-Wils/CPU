import { apiRequest } from "@/lib/api";

/** Turn Express/HTML 404 bodies into an actionable message for operators. */
export function formatCultivationTransferApiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (
    raw.includes("Cannot GET") &&
    raw.includes("cultivation-extraction-transfers")
  ) {
    return "The production API has not been updated yet. Redeploy the Railway CPU service (apps/api) from main (commit ffd4367 or later), then confirm the release step runs the database migration.";
  }
  if (raw.includes("<!DOCTYPE") || raw.includes("<html")) {
    return "The API returned an error page instead of JSON. Check NEXT_PUBLIC_API_URL on Vercel and redeploy the Railway API (apps/api).";
  }
  return raw.trim() || "Could not load transfer queue";
}

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
  metrcTag: string | null;
  parentGroupId: string | null;
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

export type FreshFrozenBundleHarvestInput = {
  metrcTag: string;
  grams: number;
  storageLocationId?: string;
  storageLocationName?: string;
};

export async function createFreshFrozenBundleTransfers(body: {
  sourceCultivationBatchId: string;
  strainName: string;
  parentGroupId?: string;
  sourceEventAt?: string;
  harvestDate?: string;
  plantsHarvested?: number;
  materialPayload?: Record<string, unknown>;
  bundles: FreshFrozenBundleHarvestInput[];
}): Promise<{ rows: CultivationExtractionTransferRow[]; parentGroupId: string | null }> {
  return apiRequest("/api/cultivation-extraction-transfers/fresh-frozen-bundles", {
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
    displayName?: string;
    grams?: number;
    bundles?: number;
    weightLbs?: number;
  },
) {
  return apiRequest(`/api/cultivation-extraction-transfers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}

export async function splitTransferIntoBundles(
  id: string,
  body?: { bundleCount?: number },
): Promise<{ rows: CultivationExtractionTransferRow[] }> {
  return apiRequest(
    `/api/cultivation-extraction-transfers/${encodeURIComponent(id)}/split-bundles`,
    {
      method: "POST",
      body: body ?? {},
    },
  );
}

export async function transferCultivationExtractionToExtraction(
  ids: string[],
): Promise<{ rows: CultivationExtractionTransferRow[]; sourceBatches: unknown[] }> {
  return apiRequest("/api/cultivation-extraction-transfers/transfer", {
    method: "POST",
    body: { ids },
  });
}

/** True for legacy store packages that came from cultivation Ready to Transfer. */
export function sourceBatchCanReturnToCultivation(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const id = String(r.id || "").trim();
  if (!id || /^c[a-z0-9]{20,}$/i.test(id)) return false;
  if (/^(FF|TRIM)-/i.test(id)) return true;
  if (r.manualTransferToExtraction === true) return true;
  if (String(r.cultivationTransferId || "").trim()) return true;
  const t = String(r.type || r.name || "").toLowerCase();
  return t.includes("fresh frozen") || t.includes("dry trim");
}

export async function returnSourceBatchToCultivation(
  sourceBatchId: string,
  storePackage?: Record<string, unknown>,
): Promise<{
  row: CultivationExtractionTransferRow;
}> {
  return apiRequest("/api/cultivation-extraction-transfers/return-to-cultivation", {
    method: "POST",
    body: { sourceBatchId, storePackage },
  });
}

export async function returnSourceBatchesToCultivationBulk(
  packages: Array<{ sourceBatchId: string; storePackage?: Record<string, unknown> }>,
): Promise<{
  rows: CultivationExtractionTransferRow[];
  returnedIds: string[];
  failed: Array<{ sourceBatchId: string; message: string }>;
}> {
  return apiRequest("/api/cultivation-extraction-transfers/return-to-cultivation/bulk", {
    method: "POST",
    body: { packages },
  });
}
