import { TenantRepository } from "./TenantRepository.js";

export class ConfigRepository extends TenantRepository {
  async upsertConfig(companyId: string, key: string, valueJson: string) {
    return this.db.companyConfig.upsert({
      where: { companyId_key: { companyId, key } },
      update: { valueJson },
      create: { companyId, key, valueJson }
    });
  }

  async listConfigs(companyId: string) {
    return this.db.companyConfig.findMany({ where: { companyId }, orderBy: { key: "asc" } });
  }
}
