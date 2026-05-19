import { apiRequest } from "@/lib/api";

export async function loadSourceBatches(opts?: { summary?: boolean }) {
  const summary = opts?.summary !== false;
  const q = summary ? "?summary=1" : "?summary=0";
  return apiRequest(`/api/source-batches${q}`);
}

export async function loadSourceBatchDetail(batchId: string) {
  return apiRequest(`/api/source-batches/${encodeURIComponent(batchId)}`);
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

/** Prisma SourcePackage rows: update display name (canonicalName) only. */
export async function patchSourcePackageCanonicalName(
  sourcePackageId: string,
  canonicalName: string,
) {
  return apiRequest(
    `/api/workflow/source-packages/${encodeURIComponent(sourcePackageId)}`,
    {
      method: "PATCH",
      body: { canonicalName },
    },
  );
}