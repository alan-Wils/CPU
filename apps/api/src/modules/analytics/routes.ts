import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { AppError } from "../../errors/AppError.js";
import { parseYmdEndUtc, parseYmdStartUtc } from "../../lib/analyticsDateRange.js";
import { StoreService } from "../../services/storeService.js";
import { buildCultivationStrainMetricPoints } from "./buildCultivationStrainMetricPoints.js";

const storeService = new StoreService();

const analyticsReadRoles = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "FINANCIAL_ANALYST",
];

export const analyticsRouter = Router();

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

        const [rows, storeSnap] = await Promise.all([
            prisma.cultivationBatch.findMany({
                where: { companyId },
                /** Larger window so older harvested batches still appear once lab THC is written. */
                take: 3500,
                orderBy: { updatedAt: "desc" },
            }),
            storeService.load(companyId).catch(() => ({ dryFlowerBatches: [] as unknown[] })),
        ]);

        const dryFlowerBatches = Array.isArray((storeSnap as { dryFlowerBatches?: unknown }).dryFlowerBatches)
            ? (storeSnap as { dryFlowerBatches: unknown[] }).dryFlowerBatches
            : [];

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
            })),
            dryFlowerBatches,
        });

        res.json({ points });
    }),
);
