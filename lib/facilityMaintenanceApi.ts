import { apiRequest } from "./api";

export type FacilityDashboardJson = {
  profile: {
    facilityName: string;
    addressLine1: string;
    cityStateZip: string;
    licenseNumber: string;
    facilitySizeSqFt: number;
    builtYear: number;
    roomCounts: Record<string, number>;
    mtdTotalCost: number;
    mtdCostSeries: Array<{ day: number; amount: number }>;
  };
  kpis: Record<string, string | number>;
  kpiMeta: {
    statusChart: Array<{ label: string; value: number; pct: string }>;
    statusChartCenterTotal: number;
    priorityChart: Array<{ label: string; value: number }>;
    maintenanceCostSubtext: string;
  };
  workOrders: Array<{
    id: string;
    externalId: string;
    title: string;
    location: string;
    category: string;
    priority: string;
    status: string;
    assignedTo: string;
    dueDate: string;
    dueMeta: string | null;
    description: string | null;
  }>;
  alerts: Array<{
    id: string;
    title: string;
    locationLabel: string;
    valueLabel: string | null;
    statusLabel: string | null;
    timeLabel: string;
  }>;
  systems: Array<{ id: string; name: string; status: string }>;
  environment: Array<{
    id: string;
    metricKey: string;
    label: string;
    valueDisplay: string;
    idealRangeDisplay: string;
    sparkline: number[];
    statusLabel: string;
  }>;
  calendar: { yearMonth: string; events: Array<{ day: number; kind: string }> };
  pmTasks: Array<{
    id: string;
    taskName: string;
    assetSystem: string;
    frequency: string;
    assignedTo: string;
    nextDueDate: string;
    notes: string | null;
  }>;
  assets: Array<{ id: string; assetName: string; category: string; location: string }>;
  partRequests: Array<{ id: string; partName: string; quantity: number; neededFor: string; priority: string }>;
  locations: Array<{ id: string; locationName: string; locationType: string; parentArea: string }>;
};

export async function fetchFacilityMaintenanceDashboard(): Promise<FacilityDashboardJson> {
  return apiRequest<FacilityDashboardJson>("/api/facility-maintenance/dashboard");
}

export async function postFacilityWorkOrder(body: Record<string, unknown>) {
  return apiRequest("/api/facility-maintenance/work-orders", { method: "POST", body });
}

export async function postFacilityPmTask(body: Record<string, unknown>) {
  return apiRequest("/api/facility-maintenance/pm-tasks", { method: "POST", body });
}

export async function postFacilityAsset(body: Record<string, unknown>) {
  return apiRequest("/api/facility-maintenance/assets", { method: "POST", body });
}

export async function postFacilityPartRequest(body: Record<string, unknown>) {
  return apiRequest("/api/facility-maintenance/part-requests", { method: "POST", body });
}

export async function postFacilityLocation(body: Record<string, unknown>) {
  return apiRequest("/api/facility-maintenance/locations", { method: "POST", body });
}

export async function patchFacilityWorkOrder(workOrderId: string, body: Record<string, unknown>) {
  return apiRequest(`/api/facility-maintenance/work-orders/${encodeURIComponent(workOrderId)}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteFacilityWorkOrder(workOrderId: string) {
  return apiRequest(`/api/facility-maintenance/work-orders/${encodeURIComponent(workOrderId)}`, {
    method: "DELETE",
  });
}
