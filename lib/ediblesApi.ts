import { apiRequest } from "./api";

export type EdibleOilOption = {
  extractionRunId: string;
  availableGrams: number;
  outputGrams: number;
  /** Grams recorded on extraction packaging lots for this run (shared pool with edibles). */
  packagingGrams: number;
  /** Grams allocated to non-cancelled edible batches from this run. */
  ediblesGrams: number;
  productType: string;
  marketBatchCode?: string | null;
  strainLabel: string;
  finishedAt: string | null;
};

export type EdibleDashboardBatch = {
  id: string;
  batchNumber: string;
  sku: string;
  flavor: string;
  productType: string;
  status: string;
  stage: string;
  targetMgPerPiece: number;
  targetPieces: number;
  expectedYield: number | null;
  actualYield: number | null;
  oilInputGrams: number;
  totalMgInput: number;
  wasteGrams: number;
  extractionRunId: string;
  /** Live Resin oil source label (e.g. BLUE.051526). */
  extractionRunLabel?: string | null;
  notes: string | null;
  startDate: string | null;
  completedDate: string | null;
  createdAt: string;
  updatedAt: string;
  taskLogCount: number;
  ingredientCount: number;
  latestQa: {
    id: string;
    potencyStatus: string;
    homogeneityStatus: string;
    microbialStatus: string;
    passedAt: string | null;
  } | null;
  packagingLotId: string | null;
  lastTaskEmployees: string | null;
  lastTaskType: string | null;
  yieldPct: number | null;
};

export type EdibleDashboardJson = {
  kpis: {
    activeBatches: number;
    gummiesInProduction: number;
    totalMgScheduled: number;
    pendingQa: number;
    readyForPackaging: number;
  };
  batches: EdibleDashboardBatch[];
};

export async function fetchEdiblesDashboard(): Promise<EdibleDashboardJson> {
  return apiRequest<EdibleDashboardJson>("/api/edibles/dashboard");
}

export async function fetchEdiblesOilOptions(): Promise<{ options: EdibleOilOption[] }> {
  return apiRequest<{ options: EdibleOilOption[] }>("/api/edibles/extraction-oil-options");
}

export async function fetchEdibleOilOptionByRunId(extractionRunId: string): Promise<{ option: EdibleOilOption }> {
  return apiRequest<{ option: EdibleOilOption }>(
    `/api/edibles/extraction-oil-options/by-run/${encodeURIComponent(extractionRunId)}`,
  );
}

export async function fetchEdiblesAnalytics(): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>("/api/edibles/analytics");
}

export type EdibleBatchCreated = {
  id: string;
  batchNumber?: string;
  [k: string]: unknown;
};

export async function createEdibleBatch(body: {
  sku: string;
  flavor: string;
  productType: string;
  targetMgPerPiece: number;
  targetPieces: number;
  extractionRunId: string;
  oilInputGrams: number;
  potencyMgPerGram?: number | null;
  notes?: string | null;
  expectedYield?: number | null;
}): Promise<EdibleBatchCreated> {
  return apiRequest<EdibleBatchCreated>("/api/edibles/batches", { method: "POST", body });
}

export async function patchEdibleBatch(
  batchId: string,
  body: {
    stage?: string;
    status?: string;
    notes?: string | null;
    actualYield?: number | null;
    wasteGrams?: number;
  },
) {
  return apiRequest(`/api/edibles/batches/${encodeURIComponent(batchId)}`, { method: "PATCH", body });
}

export async function deleteEdibleBatch(batchId: string) {
  return apiRequest(`/api/edibles/batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
}

export async function postEdibleTaskLog(
  batchId: string,
  body: {
    taskType: string;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMinutes?: number | null;
    employees?: string | null;
    notes?: string | null;
    temperature?: number | null;
    weight?: number | null;
  },
) {
  return apiRequest(`/api/edibles/batches/${encodeURIComponent(batchId)}/task-logs`, {
    method: "POST",
    body,
  });
}

export async function postEdibleIngredient(
  batchId: string,
  body: { ingredientName: string; lotNumber?: string | null; weight: number; unit?: string },
) {
  return apiRequest(`/api/edibles/batches/${encodeURIComponent(batchId)}/ingredients`, {
    method: "POST",
    body,
  });
}

export async function postEdibleQa(
  batchId: string,
  body: {
    potencyStatus: "PENDING" | "PASSED" | "FAILED";
    homogeneityStatus: "PENDING" | "PASSED" | "FAILED";
    microbialStatus: "PENDING" | "PASSED" | "FAILED";
    failedReason?: string | null;
    notes?: string | null;
  },
) {
  return apiRequest(`/api/edibles/batches/${encodeURIComponent(batchId)}/qa`, { method: "POST", body });
}

export async function postEdibleQaManagerReview(
  batchId: string,
  body: {
    qaTestId: string;
    approve: boolean;
    notes?: string | null;
    failedReason?: string | null;
  },
) {
  return apiRequest(`/api/edibles/batches/${encodeURIComponent(batchId)}/qa/manager-review`, {
    method: "POST",
    body,
  });
}

export async function postEdibleTransferPackaging(
  batchId: string,
  body: { gramsPerUnit: number; defaultTemplate?: string | null },
) {
  return apiRequest(`/api/edibles/batches/${encodeURIComponent(batchId)}/transfer-packaging`, {
    method: "POST",
    body,
  });
}
