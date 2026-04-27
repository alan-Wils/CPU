import { LaborRepository } from "../repositories/laborRepository.js";
import { AuditService } from "./auditService.js";

export class LaborService {
  private readonly repo = new LaborRepository();
  private readonly auditService = new AuditService();

  async createEntry(input: {
    companyId: string;
    actorUserId: string;
    stage: "CULTIVATION" | "EXTRACTION" | "PACKAGING";
    taskType: string;
    hours: number;
    hourlyRate: number;
    referenceId?: string;
    cultivationBatchId?: string;
  }) {
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

  async listCpu(companyId: string, period?: string) {
    return this.repo.listCpu(companyId, period);
  }

  async aggregate(companyId: string) {
    return this.repo.aggregateLabor(companyId);
  }
}
