import { createHash } from "node:crypto";
import { logInfo } from "./logger.js";
import { env } from "../config/env.js";

export type MergedCompanyConfig = Record<string, unknown>;

function deepCloneJson<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

function nonEmptyString(v: unknown): boolean {
    return typeof v === "string" && v.trim().length > 0;
}

/** Treat UI placeholder copy as empty so saves do not overwrite stored METRC keys. */
function isEmptyOrMaskedMetrcSecret(value: unknown): boolean {
    if (!nonEmptyString(value)) return true;
    const s = String(value).trim();
    return s.includes("configured — enter a new key");
}

/**
 * Strip METRC / Autogrow secrets from `company` for any HTTP response.
 * Adds `hasMetrcVendorApiKey`, `hasMetrcUserApiKey`, `hasAutogrowApiKey` for admin UI placeholders.
 */
export function scrubCompanySecretsForHttp(company: unknown): unknown {
    if (!company || typeof company !== "object" || Array.isArray(company))
        return company;
    const c = deepCloneJson(company) as Record<string, unknown>;

    const metrc = c.metrc && typeof c.metrc === "object" && !Array.isArray(c.metrc)
        ? (c.metrc as Record<string, unknown>)
        : null;
    if (metrc) {
        const hasVendor = nonEmptyString(metrc.apiKey) || nonEmptyString(metrc.vendorApiKey);
        const hasUser = nonEmptyString(metrc.userKey) || nonEmptyString(metrc.userApiKey);
        metrc.apiKey = "";
        metrc.userKey = "";
        if ("vendorApiKey" in metrc) metrc.vendorApiKey = "";
        if ("userApiKey" in metrc) metrc.userApiKey = "";
        metrc.hasMetrcVendorApiKey = hasVendor;
        metrc.hasMetrcUserApiKey = hasUser;
        c.metrc = metrc;
    }

    const cc = c.climateControl && typeof c.climateControl === "object" && !Array.isArray(c.climateControl)
        ? (c.climateControl as Record<string, unknown>)
        : null;
    if (cc) {
        const ag = cc.autogrow && typeof cc.autogrow === "object" && !Array.isArray(cc.autogrow)
            ? (cc.autogrow as Record<string, unknown>)
            : null;
        if (ag) {
            const hasAg = nonEmptyString(ag.apiKey);
            ag.apiKey = "";
            ag.hasAutogrowApiKey = hasAg;
            cc.autogrow = ag;
        }
        c.climateControl = cc;
    }

    return c;
}

export function scrubMergedConfigForHttp(merged: MergedCompanyConfig): MergedCompanyConfig {
    const out = deepCloneJson(merged) as MergedCompanyConfig;
    if (out.company)
        out.company = scrubCompanySecretsForHttp(out.company) as unknown;
    return out;
}

/**
 * When PUT `company` arrives with blank METRC / Autogrow keys (masked in GET responses),
 * carry forward secrets from the existing stored company value so saves do not wipe credentials.
 */
export function mergeCompanyValuePreserveMaskedSecrets(prevCompany: unknown, incoming: unknown): unknown {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
        return incoming;
    const out = deepCloneJson(incoming) as Record<string, unknown>;
    const prev = prevCompany && typeof prevCompany === "object" && !Array.isArray(prevCompany)
        ? (prevCompany as Record<string, unknown>)
        : {};
    const prevMet = prev.metrc && typeof prev.metrc === "object" && !Array.isArray(prev.metrc)
        ? (prev.metrc as Record<string, unknown>)
        : null;
    const nextMet = out.metrc && typeof out.metrc === "object" && !Array.isArray(out.metrc)
        ? (out.metrc as Record<string, unknown>)
        : null;
    if (nextMet && prevMet) {
        if (isEmptyOrMaskedMetrcSecret(nextMet.apiKey) && nonEmptyString(prevMet.apiKey))
            nextMet.apiKey = prevMet.apiKey;
        if (isEmptyOrMaskedMetrcSecret(nextMet.apiKey) && nonEmptyString(prevMet.vendorApiKey))
            nextMet.apiKey = prevMet.vendorApiKey;
        if (isEmptyOrMaskedMetrcSecret(nextMet.userKey) && nonEmptyString(prevMet.userKey))
            nextMet.userKey = prevMet.userKey;
        if (isEmptyOrMaskedMetrcSecret(nextMet.userKey) && nonEmptyString(prevMet.userApiKey))
            nextMet.userKey = prevMet.userApiKey;
        delete nextMet.hasMetrcVendorApiKey;
        delete nextMet.hasMetrcUserApiKey;
        delete nextMet.vendorApiKey;
        delete nextMet.userApiKey;
    }
    const prevCc = prev.climateControl && typeof prev.climateControl === "object" && !Array.isArray(prev.climateControl)
        ? (prev.climateControl as Record<string, unknown>)
        : null;
    const prevAg = prevCc?.autogrow && typeof prevCc.autogrow === "object" && !Array.isArray(prevCc.autogrow)
        ? (prevCc.autogrow as Record<string, unknown>)
        : null;
    const nextCc = out.climateControl && typeof out.climateControl === "object" && !Array.isArray(out.climateControl)
        ? (out.climateControl as Record<string, unknown>)
        : null;
    const nextAg = nextCc?.autogrow && typeof nextCc.autogrow === "object" && !Array.isArray(nextCc.autogrow)
        ? (nextCc.autogrow as Record<string, unknown>)
        : null;
    if (nextAg && prevAg) {
        if (!nonEmptyString(nextAg.apiKey) && nonEmptyString(prevAg.apiKey))
            nextAg.apiKey = prevAg.apiKey;
        delete nextAg.hasAutogrowApiKey;
    }
    return out;
}

export function mergeConfigRowsToMap(rows: Array<{ key: string; value: unknown }>): MergedCompanyConfig {
    return rows.reduce<MergedCompanyConfig>((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
}

export function logConfigTopLevelSizesDev(merged: MergedCompanyConfig, label: string): void {
    if (env.NODE_ENV !== "development")
        return;
    const parts: { key: string; bytes: number }[] = [];
    let total = 0;
    for (const key of Object.keys(merged).sort()) {
        let bytes = 0;
        try {
            bytes = Buffer.byteLength(JSON.stringify(merged[key]), "utf8");
        }
        catch {
            bytes = 0;
        }
        parts.push({ key, bytes });
        total += bytes;
    }
    logInfo("config_http_top_level_sizes_dev", {
        label,
        totalBytes: total,
        keys: parts.map((p) => ({ key: p.key, bytes: p.bytes })),
    });
}

export function buildConfigChecksum(rows: Array<{ key: string; updatedAt: Date }>): string {
    const body = rows
        .map((r) => `${r.key}:${r.updatedAt.toISOString()}`)
        .sort()
        .join("|");
    return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

export function pickSalesForNavAndInventory(sales: unknown): Record<string, unknown> {
    if (!sales || typeof sales !== "object" || Array.isArray(sales))
        return {};
    const s = sales as Record<string, unknown>;
    return {
        leafLinkCategoryLabels: Array.isArray(s.leafLinkCategoryLabels) ? s.leafLinkCategoryLabels : [],
        inventoryPrintLogoUrl: s.inventoryPrintLogoUrl ?? "",
        inventoryPrintLogoMaxWidthPx: s.inventoryPrintLogoMaxWidthPx ?? 0,
        inventoryPrintLogoMaxHeightPx: s.inventoryPrintLogoMaxHeightPx ?? 0,
        companyHeaderLogoMaxHeightPx: s.companyHeaderLogoMaxHeightPx ?? 0,
        companyHeaderLogoMaxWidthPx: s.companyHeaderLogoMaxWidthPx ?? 0,
        marketplaceBuyerCardLogoMaxHeightPx: s.marketplaceBuyerCardLogoMaxHeightPx ?? 0,
        marketplaceBuyerChipLogoMaxHeightPx: s.marketplaceBuyerChipLogoMaxHeightPx ?? 0,
    };
}

export function buildBasicConfigView(
    merged: MergedCompanyConfig,
    companyMeta: { id: string; name: string; slug: string },
    services: Record<string, unknown> | null,
): MergedCompanyConfig {
    const companyRaw = merged.company;
    const settings =
        companyRaw && typeof companyRaw === "object" && !Array.isArray(companyRaw)
            ? ((companyRaw as Record<string, unknown>).settings &&
                typeof (companyRaw as Record<string, unknown>).settings === "object" &&
                !Array.isArray((companyRaw as Record<string, unknown>).settings)
                ? ((companyRaw as Record<string, unknown>).settings as Record<string, unknown>)
                : {})
            : {};
    return {
        companyId: companyMeta.id,
        companyName: companyMeta.name,
        companySlug: companyMeta.slug,
        services: services ?? {},
        company: {
            settings: {
                displayTimezone: settings.displayTimezone,
                liveTaskNotifications: settings.liveTaskNotifications,
                liveOrderNotifications: settings.liveOrderNotifications,
                rewards: settings.rewards ?? {},
            },
        },
        sales: pickSalesForNavAndInventory(merged.sales),
        products:
            merged.products && typeof merged.products === "object" && !Array.isArray(merged.products)
                ? { notes: String((merged.products as Record<string, unknown>).notes ?? "") }
                : { notes: "" },
    };
}

export function buildPermissionsView(auth: {
    userId: string;
    companyId?: string;
    role?: string;
    permissions?: unknown;
    platformRole?: string | null;
    sessionKind?: string;
}): Record<string, unknown> {
    return {
        companyId: String(auth.companyId ?? "").trim() || null,
        userId: auth.userId,
        role: String(auth.role ?? ""),
        permissions: Array.isArray(auth.permissions) ? auth.permissions : [],
        platformRole: auth.platformRole ?? null,
        sessionKind: auth.sessionKind ?? "company",
    };
}

export function buildCultivationConfigView(merged: MergedCompanyConfig): MergedCompanyConfig {
    const companyRaw = merged.company;
    const ext = merged.extraction && typeof merged.extraction === "object" && !Array.isArray(merged.extraction)
        ? { customTasks: (merged.extraction as Record<string, unknown>).customTasks }
        : {};
    const pkg = merged.packaging && typeof merged.packaging === "object" && !Array.isArray(merged.packaging)
        ? { customTasks: (merged.packaging as Record<string, unknown>).customTasks }
        : {};
    if (!companyRaw || typeof companyRaw !== "object" || Array.isArray(companyRaw)) {
        return {
            cultivation: merged.cultivation ?? {},
            strains: merged.strains,
            extraction: ext,
            packaging: pkg,
            company: {},
        };
    }
    const cr = companyRaw as Record<string, unknown>;
    const settings = cr.settings && typeof cr.settings === "object" && !Array.isArray(cr.settings)
        ? cr.settings
        : {};
    const metFull = cr.metrc && typeof cr.metrc === "object" && !Array.isArray(cr.metrc)
        ? (cr.metrc as Record<string, unknown>)
        : {};
    return {
        cultivation: merged.cultivation ?? {},
        strains: merged.strains,
        extraction: ext,
        packaging: pkg,
        company: {
            settings: {
                laborBreaks: (settings as Record<string, unknown>).laborBreaks,
                displayTimezone: (settings as Record<string, unknown>).displayTimezone,
                rewards: (settings as Record<string, unknown>).rewards,
            },
            metrc: {
                integrationEnabled: Boolean(metFull.integrationEnabled),
            },
        },
    };
}

function pickCompanySettingsForWorkflowSlices(companyRaw: unknown): Record<string, unknown> {
    if (!companyRaw || typeof companyRaw !== "object" || Array.isArray(companyRaw))
        return {};
    const cr = companyRaw as Record<string, unknown>;
    const settings = cr.settings && typeof cr.settings === "object" && !Array.isArray(cr.settings)
        ? (cr.settings as Record<string, unknown>)
        : {};
    return {
        displayTimezone: settings.displayTimezone,
        rewards: settings.rewards ?? {},
    };
}

export function buildExtractionConfigView(merged: MergedCompanyConfig): MergedCompanyConfig {
    const cult = merged.cultivation && typeof merged.cultivation === "object" && !Array.isArray(merged.cultivation)
        ? { customTasks: (merged.cultivation as Record<string, unknown>).customTasks }
        : {};
    const pkg = merged.packaging && typeof merged.packaging === "object" && !Array.isArray(merged.packaging)
        ? { customTasks: (merged.packaging as Record<string, unknown>).customTasks }
        : {};
    return {
        extraction: merged.extraction ?? {},
        cultivation: cult,
        packaging: pkg,
        company: {
            settings: pickCompanySettingsForWorkflowSlices(merged.company),
        },
    };
}

export function buildPackagingConfigView(merged: MergedCompanyConfig): MergedCompanyConfig {
    const cult = merged.cultivation && typeof merged.cultivation === "object" && !Array.isArray(merged.cultivation)
        ? { customTasks: (merged.cultivation as Record<string, unknown>).customTasks }
        : {};
    const ext = merged.extraction && typeof merged.extraction === "object" && !Array.isArray(merged.extraction)
        ? { customTasks: (merged.extraction as Record<string, unknown>).customTasks }
        : {};
    return {
        packaging: merged.packaging ?? {},
        cultivation: cult,
        extraction: ext,
        company: {
            settings: pickCompanySettingsForWorkflowSlices(merged.company),
        },
    };
}

export function buildRewardsPageConfigView(merged: MergedCompanyConfig): MergedCompanyConfig {
    const cult = merged.cultivation && typeof merged.cultivation === "object" && !Array.isArray(merged.cultivation)
        ? { customTasks: (merged.cultivation as Record<string, unknown>).customTasks }
        : {};
    const ext = merged.extraction && typeof merged.extraction === "object" && !Array.isArray(merged.extraction)
        ? { customTasks: (merged.extraction as Record<string, unknown>).customTasks }
        : {};
    const pkg = merged.packaging && typeof merged.packaging === "object" && !Array.isArray(merged.packaging)
        ? { customTasks: (merged.packaging as Record<string, unknown>).customTasks }
        : {};
    return {
        company: {
            settings: {
                rewards: pickCompanySettingsForWorkflowSlices(merged.company).rewards ?? {},
            },
        },
        cultivation: cult,
        extraction: ext,
        packaging: pkg,
    };
}

export function buildEdiblesConfigView(merged: MergedCompanyConfig): MergedCompanyConfig {
    const ed = merged.edibles;
    return {
        edibles: ed && typeof ed === "object" && !Array.isArray(ed) ? ed : {},
    };
}

export function buildIntegrationsMetaView(merged: MergedCompanyConfig): Record<string, unknown> {
    const company = merged.company && typeof merged.company === "object" && !Array.isArray(merged.company)
        ? (merged.company as Record<string, unknown>)
        : {};
    const metrc = company.metrc && typeof company.metrc === "object" && !Array.isArray(company.metrc)
        ? (company.metrc as Record<string, unknown>)
        : {};
    const cc = company.climateControl && typeof company.climateControl === "object" && !Array.isArray(company.climateControl)
        ? (company.climateControl as Record<string, unknown>)
        : {};
    const ag = cc.autogrow && typeof cc.autogrow === "object" && !Array.isArray(cc.autogrow)
        ? (cc.autogrow as Record<string, unknown>)
        : {};
    return {
        metrcIntegrationEnabled: Boolean(metrc.integrationEnabled),
        metrcStateCode: String(metrc.stateCode ?? "").trim(),
        metrcEnvironment: String(metrc.environment ?? ""),
        metrcLicenseNumberDisplay: String(metrc.licenseNumber ?? "").trim(),
        metrcFacilityName: String(metrc.facilityName ?? "").trim(),
        metrcUsernameDisplay: String(metrc.username ?? "").trim(),
        hasMetrcVendorApiKey: nonEmptyString(metrc.apiKey) || nonEmptyString(metrc.vendorApiKey),
        hasMetrcUserApiKey: nonEmptyString(metrc.userKey) || nonEmptyString(metrc.userApiKey),
        metrcLastConnectionStatus: String(metrc.metrcLastConnectionStatus ?? "").trim(),
        metrcLastConnectionCheckedAt: String(metrc.metrcLastConnectionCheckedAt ?? "").trim() || null,
        metrcSandboxLastFacilitiesSyncAt: String(metrc.metrcSandboxLastFacilitiesSyncAt ?? "").trim() || null,
        metrcSandboxLastStrainsSyncAt: String(metrc.metrcSandboxLastStrainsSyncAt ?? "").trim() || null,
        metrcSandboxLastItemsSyncAt: String(metrc.metrcSandboxLastItemsSyncAt ?? "").trim() || null,
        metrcSandboxLastRoomsSyncAt: String(metrc.metrcSandboxLastRoomsSyncAt ?? "").trim() || null,
        metrcSandboxLastPackagesSyncAt: String(metrc.metrcSandboxLastPackagesSyncAt ?? "").trim() || null,
        metrcSandboxLastFacilitiesCount: metrc.metrcSandboxLastFacilitiesCount ?? null,
        metrcSandboxLastStrainsCount: metrc.metrcSandboxLastStrainsCount ?? null,
        metrcSandboxLastItemsCount: metrc.metrcSandboxLastItemsCount ?? null,
        metrcSandboxLastRoomsCount: metrc.metrcSandboxLastRoomsCount ?? null,
        metrcSandboxLastPackagesCount: metrc.metrcSandboxLastPackagesCount ?? null,
        metrcSandboxLastRateLimitWarning: String(metrc.metrcSandboxLastRateLimitWarning ?? "").trim() || null,
        autogrowIntegrationEnabled: Boolean(ag.integrationEnabled),
        hasAutogrowApiKey: nonEmptyString(ag.apiKey),
    };
}
