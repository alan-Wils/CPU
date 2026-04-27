import { TenantRepository } from "./TenantRepository.js";
export class DashboardRepository extends TenantRepository {
    async overview(companyId) {
        const [company, cultivationBatches, extractionRuns, packagingLots, laborAggregate, latestCpu, audits, users] = await Promise.all([
            this.db.company.findUnique({ where: { id: companyId } }),
            this.db.cultivationBatch.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 10 }),
            this.db.extractionRun.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 10 }),
            this.db.packagingLot.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 10 }),
            this.db.laborEntry.aggregate({ where: { companyId }, _sum: { hours: true, totalCost: true } }),
            this.db.cpuSnapshot.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } }),
            this.db.auditLog.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 20 }),
            this.db.user.count({ where: { companyId, isActive: true } })
        ]);
        return {
            company,
            cultivationBatches,
            extractionRuns,
            packagingLots,
            laborAggregate,
            latestCpu,
            audits,
            users
        };
    }
}
