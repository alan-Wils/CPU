import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import {
  buildMetrcCredentialHintFromLoaded,
  logMetrcCredentialDiagnostics,
} from "../lib/metrcCredentialDiagnostics.js";
import {
  cacheMetrcEndpointPath,
  metrcEndpointPathKey,
  metrcPullFailureMessage,
  orderMetrcEndpointCandidates,
  shouldTryNextMetrcEndpoint,
} from "../lib/metrcEndpoints.js";
import { parseMetrcItemsPayload, type ParsedMetrcItem } from "../lib/metrcItemsParse.js";
import {
  buildMetrcItemsActivePathForPage,
  type MetrcItemsActiveQueryParams,
} from "../lib/metrcItemsActiveQuery.js";
import {
  buildMetrcLocationsActiveParams,
  logMetrcLocationsActiveRequest,
  parseMetrcFacilityLicenseRows,
  resolveMetrcLocationsActiveRequest,
} from "../lib/metrcLocationsActiveQuery.js";
import {
  applyMetrcOperationalSuccess,
  isMetrcSandboxPlaceholderLicense,
} from "../lib/metrcOperationalStatus.js";
import {
  applyMetrcSuccessStatus,
  formatMetrcSuccessMessage,
} from "../lib/metrcStatusPersistence.js";
import type { MetrcEnvironment } from "../lib/metrcResolveBaseUrl.js";
import {
  listMetrcItemsForCompany,
  upsertMetrcItemsForCompany,
} from "../repositories/metrcItemRepository.js";
import { listMetrcFacilitiesForCompany } from "../repositories/metrcFacilityRepository.js";

const MAX_ITEM_PAGES = 50;

export type MetrcItemDto = {
  metrcItemId: string;
  itemName: string;
  categoryName: string;
  unitOfMeasureName: string;
  quantityType: string;
  licenseNumber: string;
  lastSyncedAt: string;
};

export type MetrcItemsSyncDiagnostics = {
  licenseNumber: string;
  endpoint: string;
  resolvedUrl: string;
  params: MetrcItemsActiveQueryParams;
  httpStatus: number;
  totalReturned: number;
  firstRawItem: Record<string, unknown> | null;
  facilitySource?: string;
  pagesFetched?: number;
  triedLicenses?: string[];
};

export type MetrcItemsSyncSuccess = {
  ok: true;
  syncedAt: string;
  count: number;
  totalItemsSynced: number;
  lastItemsSync: string;
  items: MetrcItemDto[];
  durationMs: number;
  retries: number;
  rateLimitWarning: string | null;
  endpoint: string;
  diagnostics: MetrcItemsSyncDiagnostics;
  noItemsForFacility?: boolean;
  message?: string;
};

export type MetrcItemsSyncFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  diagnostics?: MetrcItemsSyncDiagnostics;
};

export type MetrcItemsSyncResponse = MetrcItemsSyncSuccess | MetrcItemsSyncFailure;

function dbRowToDto(row: Awaited<ReturnType<typeof listMetrcItemsForCompany>>[number]): MetrcItemDto {
  return {
    metrcItemId: row.metrcItemId,
    itemName: row.itemName,
    categoryName: row.categoryName,
    unitOfMeasureName: row.unitOfMeasureName,
    quantityType: row.quantityType,
    licenseNumber: row.licenseNumber,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}

function mergeParsedPages(pages: ParsedMetrcItem[][]): ParsedMetrcItem[] {
  const byId = new Map<string, ParsedMetrcItem>();
  for (const page of pages) {
    for (const row of page) {
      byId.set(row.metrcItemId, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
}

function buildResolvedUrl(baseUrl: string | null, pathnameAndQuery: string): string {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const path = pathnameAndQuery.startsWith("/") ? pathnameAndQuery : `/${pathnameAndQuery}`;
  return base ? `${base}${path}` : path;
}

function firstRawItemFromParsed(parsed: ParsedMetrcItem[]): Record<string, unknown> | null {
  if (!parsed.length) return null;
  const raw = parsed[0]!.raw;
  return raw && typeof raw === "object" ? raw : null;
}

export class MetrcItemsSyncService {
  configService = new ConfigService();

  async listSyncedItems(companyId: string): Promise<MetrcItemDto[]> {
    const rows = await listMetrcItemsForCompany(companyId);
    return rows.map(dbRowToDto);
  }

  private async resolveLicenseCandidates(input: {
    companyId: string;
    client: MetrcClient;
    loaded: Awaited<ReturnType<typeof loadCompanyMetrcConfig>>;
    licenseOverride?: string;
    tryAllFacilities: boolean;
  }): Promise<string[]> {
    const override = String(input.licenseOverride || "").trim();
    if (override) return [override];

    let license = String(input.loaded?.licenseNumber || "").trim();
    if (isMetrcSandboxPlaceholderLicense(license)) {
      const locationsRequest = await resolveMetrcLocationsActiveRequest({
        client: input.client,
        loaded: input.loaded!,
        companyId: input.companyId,
        purpose: "items_sync",
      });
      license = locationsRequest.params.licenseNumber;
    }

    if (!input.tryAllFacilities) {
      return license ? [license] : [];
    }

    const fromDb = await listMetrcFacilitiesForCompany(input.companyId);
    const dbLicenses = fromDb
      .map((f) => String(f.licenseNumber || "").trim())
      .filter(Boolean);
    if (dbLicenses.length > 0) {
      const unique = [...new Set(dbLicenses)];
      if (license && !unique.includes(license)) {
        return [license, ...unique];
      }
      return unique;
    }

    const facilitiesResult = await input.client.get<unknown>("/facilities/v2/");
    if (!isMetrcClientFailure(facilitiesResult)) {
      const rows = parseMetrcFacilityLicenseRows(facilitiesResult.data);
      const apiLicenses = [...new Set(rows.map((r) => r.licenseNumber).filter(Boolean))];
      if (apiLicenses.length > 0) {
        if (license && !apiLicenses.includes(license)) {
          return [license, ...apiLicenses];
        }
        return apiLicenses;
      }
    }

    return license ? [license] : [];
  }

  private async fetchItemsForLicense(input: {
    client: MetrcClient;
    loaded: NonNullable<Awaited<ReturnType<typeof loadCompanyMetrcConfig>>>;
    companyId: string;
    licenseNumber: string;
    endpointCtx: MetrcEndpointContext;
    purpose: string;
  }): Promise<
    | {
        ok: true;
        parsed: ParsedMetrcItem[];
        httpStatus: number;
        endpoint: string;
        resolvedUrl: string;
        params: MetrcItemsActiveQueryParams;
        facilitySource: string;
        pagesFetched: number;
        retries: number;
        rateLimitWaitedMs: number;
      }
    | {
        ok: false;
        status: number;
        message: string;
        endpoint?: string;
        resolvedUrl?: string;
        params?: MetrcItemsActiveQueryParams;
        httpStatus?: number;
        retries: number;
      }
  > {
    const locationsRequest = await resolveMetrcLocationsActiveRequest({
      client: input.client,
      loaded: { ...input.loaded, licenseNumber: input.licenseNumber },
      companyId: input.companyId,
      purpose: input.purpose,
    });

    const pageResults: ParsedMetrcItem[][] = [];
    let pagesFetched = 0;
    let totalRetries = 0;
    let totalRateLimitWaitedMs = 0;
    let lastStatus = 502;
    let lastMessage = "METRC items sync failed.";
    let lastEndpoint: string | undefined;
    let lastResolvedUrl = buildResolvedUrl(
      input.client.baseUrl,
      locationsRequest.pathnameAndQuery,
    );
    let lastParams = locationsRequest.params;

    for (let pageNumber = 1; pageNumber <= MAX_ITEM_PAGES; pageNumber += 1) {
      const pageParams: MetrcItemsActiveQueryParams = { ...locationsRequest.params, pageNumber };
      const candidates = orderMetrcEndpointCandidates(input.endpointCtx, "items", pageParams);
      let pageParsed: ParsedMetrcItem[] | null = null;

      for (let i = 0; i < candidates.length; i += 1) {
        const candidatePath = candidates[i]!;
        lastResolvedUrl = buildResolvedUrl(input.client.baseUrl, candidatePath);
        lastParams = pageParams;

        logMetrcLocationsActiveRequest({
          companyId: input.companyId,
          purpose: `${input.purpose}_page_${pageNumber}`,
          baseUrl: input.client.baseUrl,
          pathnameAndQuery: candidatePath,
          params: pageParams,
          facilitySource: locationsRequest.facilitySource,
        });

        const result = await input.client.get<unknown>(candidatePath);

        if (!isMetrcClientFailure(result)) {
          cacheMetrcEndpointPath(input.endpointCtx, "items", candidatePath);
          pageParsed = parseMetrcItemsPayload(result.data);
          totalRetries += result.retries;
          totalRateLimitWaitedMs += result.rateLimitWaitedMs;
          lastStatus = result.status;
          lastEndpoint = metrcEndpointPathKey(candidatePath);
          break;
        }

        lastStatus = result.status || 502;
        lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
        lastEndpoint = result.endpoint ?? metrcEndpointPathKey(candidatePath);

        if (
          shouldTryNextMetrcEndpoint("items", i, candidates.length, {
            status: result.status,
            upstreamType: result.upstreamError?.type,
          })
        ) {
          continue;
        }
        break;
      }

      if (!pageParsed) {
        return {
          ok: false,
          status: lastStatus,
          message: lastMessage,
          endpoint: lastEndpoint,
          resolvedUrl: lastResolvedUrl,
          params: lastParams,
          httpStatus: lastStatus,
          retries: totalRetries,
        };
      }

      pagesFetched += 1;
      pageResults.push(pageParsed);
      if (pageParsed.length < pageParams.pageSize) break;
    }

    const parsed = mergeParsedPages(pageResults);
    const endpoint =
      lastEndpoint ?? metrcEndpointPathKey(buildMetrcItemsActivePathForPage(lastParams, 1));

    return {
      ok: true,
      parsed,
      httpStatus: lastStatus,
      endpoint,
      resolvedUrl: lastResolvedUrl,
      params: lastParams,
      facilitySource: locationsRequest.facilitySource,
      pagesFetched,
      retries: totalRetries,
      rateLimitWaitedMs: totalRateLimitWaitedMs,
    };
  }

  async syncMetrcItems(input: {
    companyId: string;
    actorUserId: string;
    licenseNumber?: string;
    tryAllFacilities?: boolean;
  }): Promise<MetrcItemsSyncResponse> {
    logInfo("[METRC] items_sync_start", {
      companyId: input.companyId,
      licenseOverride: input.licenseNumber ?? null,
      tryAllFacilities: Boolean(input.tryAllFacilities),
    });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const endpointCtx = {
      stateCode: loaded.stateCode || "CO",
      environment: loaded.environment as MetrcEnvironment,
    };

    const licenseCandidates = await this.resolveLicenseCandidates({
      companyId: input.companyId,
      client,
      loaded,
      licenseOverride: input.licenseNumber,
      tryAllFacilities: Boolean(input.tryAllFacilities),
    });

    if (!licenseCandidates.length) {
      return {
        ok: false,
        status: 400,
        message: "Facility license number is required for METRC items sync.",
      };
    }

    const startedAt = Date.now();
    const triedLicenses: string[] = [];
    let lastFailure: MetrcItemsSyncFailure | null = null;
    let lastEmptyDiagnostics: MetrcItemsSyncDiagnostics | null = null;

    for (const licenseNumber of licenseCandidates) {
      triedLicenses.push(licenseNumber);
      const fetchResult = await this.fetchItemsForLicense({
        client,
        loaded,
        companyId: input.companyId,
        licenseNumber,
        endpointCtx,
        purpose: "items_sync",
      });

      if (fetchResult.ok === false) {
        const failure = fetchResult;
        lastFailure = {
          ok: false,
          status: failure.status,
          message: failure.message,
          endpoint: failure.endpoint,
          diagnostics: failure.params
            ? {
                licenseNumber,
                endpoint: failure.endpoint ?? "/items/v2/active",
                resolvedUrl: failure.resolvedUrl ?? "",
                params: failure.params,
                httpStatus: failure.httpStatus ?? failure.status,
                totalReturned: 0,
                firstRawItem: null,
                triedLicenses: [...triedLicenses],
              }
            : undefined,
        };
        if (failure.status === 401 || failure.status === 403) {
          logMetrcCredentialDiagnostics({
            companyId: input.companyId,
            purpose: "items_sync",
            userKeyLength: loaded.userApiKey.length,
            vendorKeyLength: loaded.vendorApiKey.length,
            licensePresent: Boolean(licenseNumber),
          });
          return {
            ...lastFailure,
            credentialHint: buildMetrcCredentialHintFromLoaded(loaded),
          };
        }
        if (!input.tryAllFacilities) {
          return lastFailure;
        }
        continue;
      }

      const diagnostics: MetrcItemsSyncDiagnostics = {
        licenseNumber,
        endpoint: fetchResult.endpoint,
        resolvedUrl: fetchResult.resolvedUrl,
        params: fetchResult.params,
        httpStatus: fetchResult.httpStatus,
        totalReturned: fetchResult.parsed.length,
        firstRawItem: firstRawItemFromParsed(fetchResult.parsed),
        facilitySource: fetchResult.facilitySource,
        pagesFetched: fetchResult.pagesFetched,
        triedLicenses: input.tryAllFacilities ? [...triedLicenses] : undefined,
      };

      logInfo("[METRC] items_sync_diagnostics", diagnostics);

      if (fetchResult.parsed.length === 0) {
        lastEmptyDiagnostics = diagnostics;
        if (input.tryAllFacilities) {
          continue;
        }
        const syncedAt = new Date();
        const syncedAtIso = syncedAt.toISOString();
        const items = (await listMetrcItemsForCompany(input.companyId)).map(dbRowToDto);
        return {
          ok: true,
          syncedAt: syncedAtIso,
          count: 0,
          totalItemsSynced: items.length,
          lastItemsSync: syncedAtIso,
          items,
          durationMs: Date.now() - startedAt,
          retries: fetchResult.retries,
          rateLimitWarning: null,
          endpoint: fetchResult.endpoint,
          diagnostics,
          noItemsForFacility: true,
          message: "No items found for selected facility.",
        };
      }

      const syncedAt = new Date();
      const syncedAtIso = syncedAt.toISOString();
      const operationalLicense = licenseNumber;
      const rateLimitWarning =
        fetchResult.rateLimitWaitedMs > 0
          ? `Rate limiter delayed this request by ${fetchResult.rateLimitWaitedMs}ms.`
          : fetchResult.retries > 0
            ? `Completed after ${fetchResult.retries} retries.`
            : null;

      await upsertMetrcItemsForCompany(
        input.companyId,
        fetchResult.parsed.map((row) => ({
          metrcItemId: row.metrcItemId,
          licenseNumber: operationalLicense,
          itemName: row.itemName,
          categoryName: row.categoryName,
          unitOfMeasureName: row.unitOfMeasureName,
          quantityType: row.quantityType,
          rawPayloadJson: JSON.stringify(row.raw),
          lastSyncedAt: syncedAt,
        })),
      );

      const totalItemsSynced = fetchResult.parsed.length;
      const items = (await listMetrcItemsForCompany(input.companyId)).map(dbRowToDto);
      const durationMs = Date.now() - startedAt;

      let nextMetrc = applyMetrcOperationalSuccess(
        {
          ...loaded.metrc,
          metrcSandboxLastItemsSyncAt: syncedAtIso,
          metrcSandboxLastItemsCount: totalItemsSynced,
          metrcSandboxLastRateLimitWarning: rateLimitWarning ?? "",
        },
        { operationalLicense, facilityName: null },
      );
      nextMetrc = applyMetrcSuccessStatus(nextMetrc, {
        httpStatus: fetchResult.httpStatus,
        message: formatMetrcSuccessMessage({ kind: "items_sync", count: totalItemsSynced }),
        checkedAt: syncedAtIso,
        totalItemsSynced,
      });

      await this.configService.upsert({
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        key: "company",
        value: { ...loaded.company, metrc: nextMetrc },
      });

      logInfo("[METRC] items_sync_success", {
        companyId: input.companyId,
        count: items.length,
        endpoint: fetchResult.endpoint,
        durationMs,
        licenseNumber: operationalLicense,
      });

      return {
        ok: true,
        syncedAt: syncedAtIso,
        count: totalItemsSynced,
        totalItemsSynced: items.length,
        lastItemsSync: syncedAtIso,
        items,
        durationMs,
        retries: fetchResult.retries,
        rateLimitWarning,
        endpoint: fetchResult.endpoint,
        diagnostics,
        message:
          input.tryAllFacilities && triedLicenses.length > 1
            ? `Found ${totalItemsSynced} item(s) under license ${operationalLicense}.`
            : undefined,
      };
    }

    if (lastFailure) {
      return lastFailure;
    }

    const syncedAt = new Date();
    const syncedAtIso = syncedAt.toISOString();
    const items = (await listMetrcItemsForCompany(input.companyId)).map(dbRowToDto);
    const diagnostics: MetrcItemsSyncDiagnostics = lastEmptyDiagnostics ?? {
      licenseNumber: licenseCandidates[licenseCandidates.length - 1] ?? "",
      endpoint: "/items/v2/active",
      resolvedUrl: "",
      params: buildMetrcLocationsActiveParams({
        facility: null,
        configLicense: loaded.licenseNumber,
      }),
      httpStatus: 200,
      totalReturned: 0,
      firstRawItem: null,
      triedLicenses,
    };

    return {
      ok: true,
      syncedAt: syncedAtIso,
      count: 0,
      totalItemsSynced: items.length,
      lastItemsSync: syncedAtIso,
      items,
      durationMs: Date.now() - startedAt,
      retries: 0,
      rateLimitWarning: null,
      endpoint: diagnostics.endpoint,
      diagnostics,
      noItemsForFacility: true,
      message: `No items found for selected facility. Tried ${triedLicenses.length} license(s): ${triedLicenses.join(", ")}.`,
    };
  }
}

type MetrcEndpointContext = {
  stateCode: string;
  environment: MetrcEnvironment;
};
