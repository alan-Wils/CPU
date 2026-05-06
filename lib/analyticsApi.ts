import { apiRequest } from "@/lib/api";

export type CultivationStrainMetricPoint = {
  batchId: string;
  strain: string;
  strainAcronym: string;
  date: string;
  potencyPct: number | null;
  dryYieldGPerSqFt: number | null;
  freshFrozenYieldGPerSqFt: number | null;
};

export async function fetchCultivationStrainMetrics(params: {
  from: string;
  to: string;
  strains?: string[];
}): Promise<{ points: CultivationStrainMetricPoint[] }> {
  const sp = new URLSearchParams();
  sp.set("from", params.from);
  sp.set("to", params.to);
  if (params.strains && params.strains.length > 0) {
    sp.set("strains", params.strains.join(","));
  }
  return apiRequest(`/api/analytics/cultivation-strain-metrics?${sp.toString()}`);
}
