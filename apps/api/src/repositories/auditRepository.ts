import { TenantRepository } from "./TenantRepository.js";

export class AuditRepository extends TenantRepository {
  async createLog(input: {
    companyId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson?: string;
    afterJson?: string;
  }) {
    return this.db.auditLog.create({ data: input });
  }

  async listLogs(companyId: string, take = 200) {
    return this.db.auditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take
    });
  }
}
