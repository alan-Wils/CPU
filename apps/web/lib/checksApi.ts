import { apiGet, apiPost } from "./api";

export type CheckExtractedFields = {
  checkDate?: string;
  amount?: number;
  checkNumber?: string;
  payerName?: string;
  routingNumber?: string;
  accountNumber?: string;
  bankName?: string;
  memo?: string;
  writtenAmount?: string;
  drawerName?: string;
  payeeName?: string;
};

export type CheckCaptureRecord = CheckExtractedFields & {
  id: string;
  imageUrl: string;
  createdAt: string;
};

export type ExtractCheckResponse = {
  provider: string;
  parsed: CheckExtractedFields;
  raw: unknown;
  confidenceByField?: Partial<Record<string, number>>;
  parseQuality?: "strong" | "weak" | "empty";
  warnings?: string[];
};

export async function uploadCheckImage(payload: {
  fileName?: string;
  mimeType: "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
  dataBase64: string;
}) {
  return apiPost<{ imageUrl: string; bytes: number }>("/checks/upload", payload, localStorage.getItem("token"));
}

export async function extractCheckFields(payload: {
  imageUrl?: string;
  dataBase64?: string;
  mimeType?: "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
}) {
  return apiPost<ExtractCheckResponse>("/checks/extract", payload, localStorage.getItem("token"));
}

export async function saveCheckCapture(payload: CheckExtractedFields & { imageUrl: string; rawOcrJson?: unknown }) {
  return apiPost<CheckCaptureRecord>("/checks", payload, localStorage.getItem("token"));
}

export async function listCheckCaptures() {
  const result = await apiGet<{ rows: CheckCaptureRecord[] }>("/checks", localStorage.getItem("token"));
  return Array.isArray(result?.rows) ? result.rows : [];
}
