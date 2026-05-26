export type MetrcSuccessMessageContext =
  | { kind: "connection_test" }
  | { kind: "facilities_sync"; count: number }
  | { kind: "locations_sync"; count: number }
  | { kind: "strains_sync"; count: number }
  | { kind: "packages_sync"; count: number }
  | { kind: "plant_batches_sync"; count: number };

export function formatMetrcSuccessMessage(context: MetrcSuccessMessageContext): string {
  switch (context.kind) {
    case "connection_test":
      return "Connection successful.";
    case "facilities_sync": {
      const n = context.count;
      return `Synced ${n} facilit${n === 1 ? "y" : "ies"}.`;
    }
    case "locations_sync": {
      const n = context.count;
      return `Synced ${n} location${n === 1 ? "" : "s"}.`;
    }
    case "strains_sync": {
      const n = context.count;
      return `Synced ${n} strain${n === 1 ? "" : "s"}.`;
    }
    case "packages_sync": {
      const n = context.count;
      return `Synced ${n} package${n === 1 ? "" : "s"}.`;
    }
    case "plant_batches_sync": {
      const n = context.count;
      return `Synced ${n} plant batch${n === 1 ? "" : "es"}.`;
    }
    default:
      return "Connection successful.";
  }
}

export function formatMetrcFailureMessage(status: number, _detail?: string | null): string {
  if (status === 401) return "Authentication failed.";
  if (status === 403) return "Operational access denied.";
  if (status === 500 || status === 502 || status === 503) return "METRC service error.";
  if (status === 400) return "Bad request.";
  if (status === 404) return "METRC endpoint not found.";
  return `METRC request failed (HTTP ${status}).`;
}

export type MetrcSuccessStatusPatch = {
  httpStatus: number;
  message: string;
  checkedAt?: string;
  totalFacilitiesSynced?: number;
  totalLocationsSynced?: number;
  totalStrainsSynced?: number;
  totalPackagesSynced?: number;
  totalPlantBatchesSynced?: number;
};

/** Clear stale failure fields and persist latest successful METRC call status. */
export function applyMetrcSuccessStatus(
  metrc: Record<string, unknown>,
  patch: MetrcSuccessStatusPatch,
): Record<string, unknown> {
  const checkedAt = patch.checkedAt ?? new Date().toISOString();
  const next: Record<string, unknown> = {
    ...metrc,
    metrcLastConnectionHttpStatus: patch.httpStatus,
    metrcHttpStatus: patch.httpStatus,
    metrcLastMetrcResponseMessage: patch.message,
    metrcMessage: patch.message,
    metrcLastConnectionMessage: patch.message,
    metrcLastConnectionStatus: "connected",
    metrcLastConnectionCheckedAt: checkedAt,
    lastError: null,
    lastFailureReason: null,
    sandboxProvisioningLastError: "",
  };

  if (typeof patch.totalFacilitiesSynced === "number") {
    next.metrcSandboxLastFacilitiesCount = patch.totalFacilitiesSynced;
    next.totalFacilitiesSynced = patch.totalFacilitiesSynced;
  }
  if (typeof patch.totalLocationsSynced === "number") {
    next.metrcTotalLocationsSynced = patch.totalLocationsSynced;
    next.totalLocationsSynced = patch.totalLocationsSynced;
    next.metrcSandboxLastRoomsCount = patch.totalLocationsSynced;
  }
  if (typeof patch.totalStrainsSynced === "number") {
    next.metrcSandboxLastStrainsCount = patch.totalStrainsSynced;
    next.totalStrainsSynced = patch.totalStrainsSynced;
  }
  if (typeof patch.totalPackagesSynced === "number") {
    next.metrcSandboxLastPackagesCount = patch.totalPackagesSynced;
    next.totalPackagesSynced = patch.totalPackagesSynced;
  }
  if (typeof patch.totalPlantBatchesSynced === "number") {
    next.metrcSandboxLastPlantBatchesCount = patch.totalPlantBatchesSynced;
    next.totalPlantBatchesSynced = patch.totalPlantBatchesSynced;
    next.metrcLastPlantBatchesSyncAt = checkedAt;
    next.metrcSandboxLastPlantBatchesSyncAt = checkedAt;
    next.lastPlantBatchesSync = checkedAt;
  }

  return next;
}

export type MetrcFailureStatusPatch = {
  httpStatus: number;
  message: string;
  checkedAt?: string;
};

export function applyMetrcFailureStatus(
  metrc: Record<string, unknown>,
  patch: MetrcFailureStatusPatch,
): Record<string, unknown> {
  const checkedAt = patch.checkedAt ?? new Date().toISOString();
  return {
    ...metrc,
    metrcLastConnectionHttpStatus: patch.httpStatus,
    metrcHttpStatus: patch.httpStatus,
    metrcLastMetrcResponseMessage: patch.message,
    metrcMessage: patch.message,
    metrcLastConnectionMessage: patch.message,
    metrcLastConnectionStatus: "not_connected",
    metrcLastConnectionCheckedAt: checkedAt,
    lastError: patch.message,
    lastFailureReason: patch.message,
  };
}
