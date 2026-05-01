import { AuditRepository } from "../repositories/auditRepository.js";
export class AuditService {
    repo = new AuditRepository();
    async logAction(input) {
        return this.repo.createLog({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId,
            beforeJson: input.before ? JSON.stringify(input.before) : undefined,
            afterJson: input.after ? JSON.stringify(input.after) : undefined
        });
    }
    async list(companyId) {
        return this.repo.listLogs(companyId);
    }
}
