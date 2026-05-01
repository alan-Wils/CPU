import { LaborRepository } from "../repositories/laborRepository.js";
import { AuditService } from "./auditService.js";
export class LaborService {
    repo = new LaborRepository();
    auditService = new AuditService();
    async createEntry(input) {
        const labor = await this.repo.createLaborEntry(input.companyId, {
            userId: input.actorUserId,
            stage: input.stage,
            taskType: input.taskType,
            hours: input.hours,
            hourlyRate: input.hourlyRate,
            totalCost: Number((input.hours * input.hourlyRate).toFixed(2)),
            referenceId: input.referenceId,
            cultivationBatchId: input.cultivationBatchId
        });
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "labor.entry.create",
            entityType: "LaborEntry",
            entityId: labor.id,
            after: labor
        });
        return labor;
    }
    async listCpu(companyId, period) {
        return this.repo.listCpu(companyId, period);
    }
    async aggregate(companyId) {
        return this.repo.aggregateLabor(companyId);
    }
}
