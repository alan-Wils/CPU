import { prisma } from "../config/prisma.js";

export type NexbatchCompanyUsageLogRow = {
    id: string;
    actorUserId: string | null;
    feature: string;
    category: string;
    provider: string;
    unitType: string;
    units: number;
    estimatedCost: number;
    metadata: unknown;
    createdAt: string;
};

export class NexbatchCompanyUsageLogService {
    async listForCompany(companyId: string, take = 50): Promise<{ companyId: string; items: NexbatchCompanyUsageLogRow[] }> {
        const id = String(companyId || "").trim();
        const limit = Math.min(Math.max(Number(take) || 50, 1), 200);
        const rows = await prisma.nexbatchCompanyUsageLog.findMany({
            where: { companyId: id },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: {
                id: true,
                actorUserId: true,
                feature: true,
                category: true,
                provider: true,
                unitType: true,
                units: true,
                estimatedCost: true,
                metadata: true,
                createdAt: true,
            },
        });
        return {
            companyId: id,
            items: rows.map((r) => ({
                id: r.id,
                actorUserId: r.actorUserId,
                feature: r.feature,
                category: r.category,
                provider: r.provider,
                unitType: r.unitType,
                units: r.units,
                estimatedCost: r.estimatedCost,
                metadata: r.metadata,
                createdAt: r.createdAt.toISOString(),
            })),
        };
    }
}
