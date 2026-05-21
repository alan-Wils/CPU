import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure, type MetrcUpstreamError } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  cacheMetrcEndpointPath,
  orderMetrcEndpointCandidates,
  shouldTryNextMetrcEndpoint,
  type MetrcEndpointResource,
} from "../lib/metrcEndpoints.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";

export type MetrcPullResource = MetrcEndpointResource;

const RESOURCE_META: Record<
  MetrcPullResource,
  { syncAtKey: string; countKey: string }
> = {
  facilities: {
    syncAtKey: "metrcSandboxLastFacilitiesSyncAt",
    countKey: "metrcSandboxLastFacilitiesCount",
  },
  strains: {
    syncAtKey: "metrcSandboxLastStrainsSyncAt",
    countKey: "metrcSandboxLastStrainsCount",
  },
  items: {
    syncAtKey: "metrcSandboxLastItemsSyncAt",
    countKey: "metrcSandboxLastItemsCount",
  },
  rooms: {
    syncAtKey: "metrcSandboxLastRoomsSyncAt",
    countKey: "metrcSandboxLastRoomsCount",
  },
  packages: {
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
  endpoint: string;
};

export type MetrcPullFailure = {
  ok: false;
  resource: MetrcPullResource;
  status: number;
  message: string;
  endpoint?: string;
  error?: MetrcUpstreamError;
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
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };
    const candidates = orderMetrcEndpointCandidates(endpointCtx, input.resource, license);
    const spec = RESOURCE_META[input.resource];

    let lastFailure: MetrcPullFailure | null = null;

    for (let i = 0; i < candidates.length; i += 1) {
      const pathname = candidates[i]!;
      const result = await client.get<unknown>(pathname);

      if (!isMetrcClientFailure(result)) {
        cacheMetrcEndpointPath(endpointCtx, input.resource, pathname);
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
          endpoint: pathname.split("?")[0],
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
          endpoint: pathname.split("?")[0] ?? pathname,
        };
      }

      lastFailure = {
        ok: false,
        resource: input.resource,
        status: result.status || 502,
        message: result.message,
        endpoint: result.endpoint ?? pathname.split("?")[0],
        error: result.upstreamError,
      };

      logWarn("[METRC] pull_endpoint_attempt_failed", {
        companyId: input.companyId,
        resource: input.resource,
        endpoint: lastFailure.endpoint,
        status: lastFailure.status,
        errorType: result.upstreamError?.type ?? null,
        attemptIndex: i,
      });

      if (
        shouldTryNextMetrcEndpoint(input.resource, i, candidates.length, {
          status: result.status,
          upstreamType: result.upstreamError?.type,
        })
      ) {
        logInfo("[METRC] pull_endpoint_fallback", {
          companyId: input.companyId,
          resource: input.resource,
          from: pathname.split("?")[0],
          next: candidates[i + 1]?.split("?")[0] ?? null,
        });
        continue;
      }
      break;
    }

    logWarn("[METRC] pull_failed", {
      companyId: input.companyId,
      resource: input.resource,
      status: lastFailure?.status,
      endpoint: lastFailure?.endpoint,
      errorType: lastFailure?.error?.type ?? null,
    });

    return (
      lastFailure ?? {
        ok: false,
        resource: input.resource,
        status: 502,
        message: "METRC pull failed.",
      }
    );
  }
}
