import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";

export type MetrcPullResource =
  | "facilities"
  | "strains"
  | "items"
  | "rooms"
  | "packages";

const RESOURCE_PATHS: Record<
  MetrcPullResource,
  { path: (license: string) => string; syncAtKey: string; countKey: string }
> = {
  facilities: {
    path: () => "/facilities/v2/",
    syncAtKey: "metrcSandboxLastFacilitiesSyncAt",
    countKey: "metrcSandboxLastFacilitiesCount",
  },
  strains: {
    path: (license) => `/strains/v2/active?licenseNumber=${encodeURIComponent(license)}`,
    syncAtKey: "metrcSandboxLastStrainsSyncAt",
    countKey: "metrcSandboxLastStrainsCount",
  },
  items: {
    path: (license) => `/items/v2/active?licenseNumber=${encodeURIComponent(license)}`,
    syncAtKey: "metrcSandboxLastItemsSyncAt",
    countKey: "metrcSandboxLastItemsCount",
  },
  rooms: {
    path: (license) => `/locations/v2/active?licenseNumber=${encodeURIComponent(license)}`,
    syncAtKey: "metrcSandboxLastRoomsSyncAt",
    countKey: "metrcSandboxLastRoomsCount",
  },
  packages: {
    path: (license) => `/packages/v2/active?licenseNumber=${encodeURIComponent(license)}`,
    syncAtKey: "metrcSandboxLastPackagesSyncAt",
    countKey: "metrcSandboxLastPackagesCount",
  },
};

function normalizeMetrcArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const r = payload as Record<string, unknown>;
  if (Array.isArray(r.Data)) return r.Data;
  if (Array.isArray(r.data)) return r.data;
  return [];
}

function summarizeRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const r = row as Record<string, unknown>;
  return {
    id: r.Id ?? r.id ?? null,
    name: r.Name ?? r.name ?? r.Label ?? r.label ?? null,
    label: r.Label ?? r.label ?? null,
    licenseNumber: r.LicenseNumber ?? r.licenseNumber ?? null,
    type: r.LocationTypeName ?? r.locationTypeName ?? r.ItemCategory ?? r.itemCategory ?? null,
  };
}

export type MetrcPullSuccess = {
  ok: true;
  resource: MetrcPullResource;
  syncedAt: string;
  count: number;
  sample: Record<string, unknown>[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
};

export type MetrcPullFailure = {
  ok: false;
  resource: MetrcPullResource;
  status: number;
  message: string;
};

export type MetrcPullResponse = MetrcPullSuccess | MetrcPullFailure;

export class MetrcPullService {
  configService = new ConfigService();

  async pull(input: {
    companyId: string;
    actorUserId: string;
    resource: MetrcPullResource;
  }): Promise<MetrcPullResponse> {
    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return {
        ok: false,
        resource: input.resource,
        status: 404,
        message: "Company configuration not found.",
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        resource: input.resource,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const license = loaded.licenseNumber;
    if (input.resource !== "facilities" && !license) {
      return {
        ok: false,
        resource: input.resource,
        status: 400,
        message: "Facility license number is required for this METRC resource.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const spec = RESOURCE_PATHS[input.resource];
    const pathname = spec.path(license);

    const result = await client.get<unknown>(pathname);

    if (isMetrcClientFailure(result)) {
      logWarn("[METRC] pull_failed", {
        companyId: input.companyId,
        resource: input.resource,
        status: result.status,
        retries: result.retries,
      });
      return {
        ok: false,
        resource: input.resource,
        status: result.status || 502,
        message: result.message,
      };
    }

    const rows = normalizeMetrcArray(result.data);
    const syncedAt = new Date().toISOString();
    const rateLimitWarning =
      result.rateLimitWaitedMs > 0
        ? `Rate limiter delayed this request by ${result.rateLimitWaitedMs}ms.`
        : result.retries > 0
          ? `Completed after ${result.retries} retries.`
          : null;

    const nextMetrc: Record<string, unknown> = {
      ...loaded.metrc,
      [spec.syncAtKey]: syncedAt,
      [spec.countKey]: rows.length,
      metrcSandboxLastRateLimitWarning: rateLimitWarning ?? "",
    };

    await this.configService.upsert({
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      key: "company",
      value: { ...loaded.company, metrc: nextMetrc },
    });

    logInfo("[METRC] pull_ok", {
      companyId: input.companyId,
      resource: input.resource,
      count: rows.length,
      durationMs: result.durationMs,
      retries: result.retries,
      rateLimitWaitedMs: result.rateLimitWaitedMs,
    });

    return {
      ok: true,
      resource: input.resource,
      syncedAt,
      count: rows.length,
      sample: rows.slice(0, 25).map(summarizeRow),
      durationMs: result.durationMs,
      retries: result.retries,
      rateLimitWarning,
    };
  }
}
