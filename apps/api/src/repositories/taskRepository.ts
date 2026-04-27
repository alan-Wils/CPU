import { TenantRepository } from "./TenantRepository.js";

export class TaskRepository extends TenantRepository {
  async createTaskLog(companyId: string, data: {
    actorUserId: string;
    stage: "CULTIVATION" | "EXTRACTION" | "PACKAGING";
    note: string;
    minutes: number;
    referenceId?: string;
  }) {
    return this.db.taskLog.create({ data: { companyId, ...data } });
  }

  async listRecent(companyId: string, take = 200) {
    return this.db.taskLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take
    });
  }

  async deleteById(companyId: string, id: string) {
    return this.db.taskLog.deleteMany({
      where: { companyId, id }
    });
  }

  async deleteAll(companyId: string) {
    return this.db.taskLog.deleteMany({
      where: { companyId }
    });
  }
}
