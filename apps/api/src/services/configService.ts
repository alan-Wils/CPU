import { ConfigRepository } from "../repositories/configRepository.js";
import { AuditService } from "./auditService.js";

type ConfigRow = {
  id: string;
  companyId: string;
  key: string;
  valueJson: string;
  createdAt: Date;
  updatedAt: Date;
};

export class ConfigService {
  private readonly repo = new ConfigRepository();
  private readonly auditService = new AuditService();

  async upsert(input: { companyId: string; actorUserId: string; key: string; value: Record<string, unknown> | unknown[] }) {
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

  async list(companyId: string) {
    const rows = (await this.repo.listConfigs(companyId)) as ConfigRow[];
    return rows.map((row) => ({
      ...row,
      value: JSON.parse(row.valueJson)
    }));
  }
}
