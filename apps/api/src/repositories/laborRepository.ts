import { TenantRepository } from "./TenantRepository.js";

export class LaborRepository extends TenantRepository {
  async createLaborEntry(companyId: string, data: {
    userId: string;
    stage: "CULTIVATION" | "EXTRACTION" | "PACKAGING";
    taskType: string;
    hours: number;
    hourlyRate: number;
    totalCost: number;
    referenceId?: string;
    cultivationBatchId?: string;
  }) {
    return this.db.laborEntry.create({ data: { companyId, ...data } });
  }

  async listCpu(companyId: string, period?: string) {
    return this.db.cpuSnapshot.findMany({
      where: { companyId, period: period ?? undefined },
      orderBy: { createdAt: "desc" }
    });
  }

  async aggregateLabor(companyId: string) {
    return this.db.laborEntry.aggregate({
      where: { companyId },
      _sum: { hours: true, totalCost: true }
    });
  }
}
