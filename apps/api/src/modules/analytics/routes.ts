import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { AppError } from "../../errors/AppError.js";
import { parseYmdEndUtc, parseYmdStartUtc } from "../../lib/analyticsDateRange.js";
import { StoreService } from "../../services/storeService.js";
import {
    buildCultivationStrainMetricPoints,
    mergeFreshFrozenSourcesForAnalytics,
} from "./buildCultivationStrainMetricPoints.js";
import { buildAnalyticsOverview } from "./analyticsOverviewService.js";
import { buildLiveOperationsDetail } from "./liveOperationsDetailService.js";
import { memoizedRead, memoizedReadWithMeta, memoCacheRemainingMs } from "../../lib/requestMemoCache.js";
import { logSlowRequestIfNeeded } from "../../lib/slowRequestLog.js";

const storeService = new StoreService();

const analyticsReadRoles = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "FINANCIAL_ANALYST",
];

export const analyticsRouter = Router();

function addUtcDaysYmd(ymd: string, delta: number): string {
    const base = parseYmdStartUtc(ymd);
    if (!Number.isFinite(base)) return ymd;
    const d = new Date(base + delta * 86_400_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function inclusiveDayCount(fromYmd: string, toYmd: string): number {
    const a = parseYmdStartUtc(fromYmd);
    const b = parseYmdEndUtc(toYmd);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
    return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function buildOverviewCacheKey(parts: {
    companyId: string;
    dateFrom: string;
    dateTo: string;
    facility: string | null;
    department: string | null;
}): string {
    const facility = String(parts.facility ?? "").trim().toLowerCase();
    const department =
        !parts.department || parts.department === "all"
            ? "all"
            : String(parts.department).trim().toLowerCase();
    return `analytics:overview:v2:${parts.companyId}:${parts.dateFrom}:${parts.dateTo}:${facility}:${department}`;
}

function syntheticOverviewSubCacheHits(dateFrom: string, dateTo: string): Record<string, boolean> {
    const days = inclusiveDayCount(dateFrom, dateTo);
    const prevToYmd = addUtcDaysYmd(dateFrom, -1);
    const prevFromYmd = addUtcDaysYmd(dateFrom, -days);
    return {
        prismaCore: true,
        llInventoryValue: true,
        [`llOrders:${dateFrom}:${dateTo}`]: true,
        [`llOrders:${prevFromYmd}:${prevToYmd}`]: true,
    };
}

analyticsRouter.get(
    "/cultivation-strain-metrics",
    requireRoleOrAppPermission(analyticsReadRoles, "page.analytics"),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const from = String(req.query.from ?? "").trim();
        const to = String(req.query.to ?? "").trim();
        const strainsRaw = String(req.query.strains ?? "").trim();
        const strainFilter = strainsRaw
            ? strainsRaw.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)
            : null;

        const fromMs = parseYmdStartUtc(from);
        const toMs = parseYmdEndUtc(to);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
            throw new AppError("Query params from and to are required as YYYY-MM-DD", 400);
        }
        if (fromMs > toMs) {
            throw new AppError("from must be on or before to", 400);
        }

        const [rows, storeSlices] = await Promise.all([
            prisma.cultivationBatch.findMany({
                where: { companyId },
                /** Larger window so older harvested batches still appear once lab THC is written. */
                take: 2500,
                orderBy: { updatedAt: "desc" },
                select: {
                    id: true,
                    strain: true,
                    strainAcronym: true,
                    updatedAt: true,
                    cultivationUiState: true,
                    freshFrozenGrams: true,
                },
            }),
            storeService.loadAnalyticsDryFlowerSourceSlices(companyId).catch(() => ({
                dryFlowerBatches: [] as unknown[],
                sourceBatches: [] as unknown[],
                productionBatches: [] as unknown[],
                completedSourceBatches: [] as unknown[],
            })),
        ]);

        const dryFlowerBatches = Array.isArray(storeSlices.dryFlowerBatches) ? storeSlices.dryFlowerBatches : [];
        const sourceBatches = Array.isArray(storeSlices.sourceBatches) ? storeSlices.sourceBatches : [];
        const productionBatches = Array.isArray(storeSlices.productionBatches) ? storeSlices.productionBatches : [];
        const completedSourceBatches = Array.isArray(storeSlices.completedSourceBatches)
            ? storeSlices.completedSourceBatches
            : [];

        const mergedSourceBatches = mergeFreshFrozenSourcesForAnalytics(
            sourceBatches,
            productionBatches,
            completedSourceBatches,
        );

        const points = buildCultivationStrainMetricPoints({
            fromMs,
            toMs,
            strainFilter,
            cultivationRows: rows.map((row) => ({
                id: row.id,
                strain: row.strain,
                strainAcronym: row.strainAcronym,
                updatedAt: row.updatedAt,
                cultivationUiState: row.cultivationUiState,
                freshFrozenGrams: row.freshFrozenGrams,
            })),
            dryFlowerBatches,
            sourceBatches: mergedSourceBatches,
        });

        res.json({ points });
    }),
);

analyticsRouter.get(
    "/overview",
    requireRoleOrAppPermission(analyticsReadRoles, "page.analytics"),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const dateFrom = String(req.query.from ?? "").trim();
        const dateTo = String(req.query.to ?? "").trim();
        const facility = String(req.query.facility ?? "").trim() || null;
        const departmentRaw = String(req.query.department ?? "").trim().toLowerCase();
        const department = departmentRaw && departmentRaw !== "all" ? departmentRaw : null;
        const fromMs = parseYmdStartUtc(dateFrom);
        const toMs = parseYmdEndUtc(dateTo);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
            throw new AppError("Query params from and to are required as YYYY-MM-DD", 400);
        }
        if (fromMs > toMs) {
            throw new AppError("from must be on or before to", 400);
        }
        const auth = req.auth as { platformRole?: string | null } | undefined;
        const cacheKey = buildOverviewCacheKey({
            companyId,
            dateFrom,
            dateTo,
            facility,
            department,
        });
        const ttlMs = Number.parseInt(String(process.env.ANALYTICS_OVERVIEW_CACHE_TTL_MS ?? "180000"), 10);
        const cacheTtl = Number.isFinite(ttlMs) && ttlMs >= 30_000 ? ttlMs : 180_000;

        const dbStarted = Date.now();
        const { value: built, cacheHit, inflightJoined } = await memoizedReadWithMeta(cacheKey, cacheTtl, () =>
            buildAnalyticsOverview({
                companyId,
                dateFrom,
                dateTo,
                facility,
                department: department ?? "all",
                platformRole: auth?.platformRole ?? null,
            }),
        );
        const dbMs = cacheHit ? 0 : Date.now() - dbStarted;
        const out = built.overview;
        const subCacheHits = cacheHit
            ? syntheticOverviewSubCacheHits(dateFrom, dateTo)
            : built.subCacheHits;
        const ttlRemainingMs = memoCacheRemainingMs(cacheKey);
        const serStarted = Date.now();
        const body = JSON.stringify(out);
        const serializeMs = Date.now() - serStarted;
        logSlowRequestIfNeeded({
            label: "GET /api/analytics/overview",
            companyId,
            dbMs,
            serializeMs,
            payloadBytes: Buffer.byteLength(body, "utf8"),
            cacheHit,
            inflightJoined,
            extra: {
                cacheKey,
                subCacheHits,
                ttlRemainingMs,
            },
        });
        res.setHeader("Cache-Control", `private, max-age=${Math.min(120, Math.floor(cacheTtl / 1000))}`);
        res.type("json").send(body);
    }),
);

analyticsRouter.get(
    "/live-operations",
    requireRoleOrAppPermission(analyticsReadRoles, "page.analytics"),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const cacheKey = `analytics:live-ops:${companyId}`;
        const ttlMs = Number.parseInt(String(process.env.ANALYTICS_LIVE_OPS_CACHE_TTL_MS ?? "60000"), 10);
        const cacheTtl = Number.isFinite(ttlMs) && ttlMs >= 15_000 ? ttlMs : 60_000;
        const out = await memoizedRead(cacheKey, cacheTtl, () => buildLiveOperationsDetail(companyId));
        res.setHeader("Cache-Control", "private, max-age=20");
        res.json(out);
    }),
);
