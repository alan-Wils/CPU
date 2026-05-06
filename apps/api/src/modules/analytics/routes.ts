import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { AppError } from "../../errors/AppError.js";
import { parseYmdEndUtc, parseYmdStartUtc } from "../../lib/analyticsDateRange.js";

const analyticsReadRoles = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "FINANCIAL_ANALYST",
];

function asUiRecord(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined)
        return {};
    if (typeof value !== "object" || Array.isArray(value))
        return {};
    return value as Record<string, unknown>;
}

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

        const rows = await prisma.cultivationBatch.findMany({
            where: { companyId },
            /** Larger window so older harvested batches still appear once lab THC is written. */
            take: 3500,
            orderBy: { updatedAt: "desc" },
        });

        const points: Array<{
            batchId: string;
            strain: string;
            strainAcronym: string;
            date: string;
            potencyPct: number | null;
            dryYieldGPerSqFt: number | null;
        }> = [];

        for (const row of rows) {
            const ui = asUiRecord(row.cultivationUiState);
            const ac = String(row.strainAcronym || "").trim().toUpperCase();
            if (strainFilter && strainFilter.length > 0 && !strainFilter.includes(ac))
                continue;

            const potencyRaw = ui.finalLabPotencyPct;
            const yldRaw = ui.dryYieldGPerSqFt;
            const potency = potencyRaw != null && potencyRaw !== "" ? Number(potencyRaw) : null;
            const yld = yldRaw != null && yldRaw !== "" ? Number(yldRaw) : null;
            const hasPotency = potency != null && Number.isFinite(potency);
            const hasYield = yld != null && Number.isFinite(yld) && yld > 0;
            if (!hasPotency && !hasYield)
                continue;

            const atRaw = ui.finalLabPotencyAt;
            let metricDate: Date;
            if (typeof atRaw === "string" && atRaw.trim()) {
                const d = new Date(atRaw);
                metricDate = !Number.isNaN(d.getTime()) ? d : row.updatedAt;
            }
            else {
                metricDate = row.updatedAt;
            }
            const t = metricDate.getTime();
            if (t < fromMs || t > toMs)
                continue;

            points.push({
                batchId: row.id,
                strain: row.strain,
                strainAcronym: ac,
                date: metricDate.toISOString().slice(0, 10),
                potencyPct: hasPotency ? potency : null,
                dryYieldGPerSqFt: hasYield ? yld : null,
            });
        }

        res.json({ points });
    }),
);
