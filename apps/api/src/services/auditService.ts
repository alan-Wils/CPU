import { AuditRepository } from "../repositories/auditRepository.js";

export class AuditService {
  private readonly repo = new AuditRepository();

  async logAction(input: {
    companyId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  }) {
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

  async list(companyId: string) {
    return this.repo.listLogs(companyId);
  }
}
