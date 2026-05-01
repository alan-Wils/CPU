import { TenantRepository } from "./TenantRepository.js";
export class WorkflowRepository extends TenantRepository {
    async createCultivationBatch(companyId, data) {
        return this.db.cultivationBatch.create({ data: { companyId, ...data } });
    }
    async findCultivationBatch(companyId, id) {
        return this.db.cultivationBatch.findFirst({ where: { companyId, id } });
    }
    async createExtractionRun(companyId, data) {
        return this.db.extractionRun.create({ data: { companyId, ...data } });
    }
    async findExtractionRun(companyId, id) {
        return this.db.extractionRun.findFirst({ where: { companyId, id } });
    }
    async createPackagingLot(companyId, data) {
        return this.db.packagingLot.create({ data: { companyId, ...data } });
    }
    async listActive(companyId) {
        const [cultivation, extraction, packaging] = await Promise.all([
            this.db.cultivationBatch.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 25 }),
            this.db.extractionRun.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 25 }),
            this.db.packagingLot.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 25 })
        ]);
        return { cultivation, extraction, packaging };
    }
}
