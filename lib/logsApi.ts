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

export async function getAllLogs() {
  return apiRequest("/api/logs");
}

export async function deleteLog(id: string) {
  return apiRequest(`/api/logs/${id}`, {
    method: "DELETE",
  });
}

export async function deleteAllLogs() {
  return apiRequest("/api/logs/all/clear", {
    method: "DELETE",
  });
}