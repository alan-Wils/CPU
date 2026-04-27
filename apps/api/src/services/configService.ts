import { ConfigRepository } from "../repositories/configRepository.js";
import { AuditService } from "./auditService.js";
export class ConfigService {
    repo = new ConfigRepository();
    auditService = new AuditService();
    async upsert(input) {
        const updated = await this.repo.upsertConfig(input.companyId, input.key, JSON.stringify(input.value));
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "config.upsert",
            entityType: "CompanyConfig",
            entityId: updated.id,
            after: { key: updated.key }
        });
        return {
            ...updated,
            value: JSON.parse(updated.valueJson)
        };
    }
    async list(companyId) {
        const rows = (await this.repo.listConfigs(companyId));
        return rows.map((row) => ({
            ...row,
            value: JSON.parse(row.valueJson)
        }));
    }
}
