import { TenantRepository } from "./TenantRepository.js";
export class LaborRepository extends TenantRepository {
    async createLaborEntry(companyId, data) {
        return this.db.laborEntry.create({ data: { companyId, ...data } });
    }
    async listCpu(companyId, period) {
        return this.db.cpuSnapshot.findMany({
            where: { companyId, period: period ?? undefined },
            orderBy: { createdAt: "desc" }
        });
    }
    async aggregateLabor(companyId) {
        return this.db.laborEntry.aggregate({
            where: { companyId },
            _sum: { hours: true, totalCost: true }
        });
    }
}
