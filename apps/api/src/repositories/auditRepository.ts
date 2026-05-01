import { TenantRepository } from "./TenantRepository.js";
export class AuditRepository extends TenantRepository {
    async createLog(input) {
        return this.db.auditLog.create({ data: input });
    }
    async listLogs(companyId, take = 200) {
        return this.db.auditLog.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            take
        });
    }
}
