import { apiRequest } from "@/lib/api";

export async function createLog(payload: {
  area: string;
  batch?: string;
  task: string;
  output?: string;
  /** Source batch / cultivation id for filtering task history */
  source?: string;
  linkedBatch?: string;
  data?: any;
}) {
  return apiRequest("/api/logs", {
    method: "POST",
    body: payload,
  });
}

/** Batch purge / filter — needs `data` snapshots (not list DTO). */
export async function getLogsForBatchPurge() {
  const out = await apiRequest<{ items?: unknown[] } | unknown[]>(
    "/api/logs?take=500&compact=0&paginated=true",
  );
  return Array.isArray(out) ? out : out?.items ?? [];
}

export async function deleteLog(id: string) {
  return apiRequest(`/api/logs/${id}`, {
    method: "DELETE",
  });
}

export async function patchLog(
  id: string,
  body: {
    output?: string;
    data?: Record<string, unknown>;
    closeLaborPendingEnd?: boolean;
  },
) {
  return apiRequest(`/api/logs/${id}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteAllLogs() {
  return apiRequest("/api/logs/all/clear", {
    method: "DELETE",
  });
}