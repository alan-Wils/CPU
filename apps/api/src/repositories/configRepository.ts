import { TenantRepository } from "./TenantRepository.js";
export class ConfigRepository extends TenantRepository {
    async upsertConfig(companyId, key, valueJson) {
        return this.db.companyConfig.upsert({
            where: { companyId_key: { companyId, key } },
            update: { valueJson },
            create: { companyId, key, valueJson }
        });
    }
    async listConfigs(companyId) {
        return this.db.companyConfig.findMany({ where: { companyId }, orderBy: { key: "asc" } });
    }
    async getConfigRaw(companyId: string, key: string) {
        return this.db.companyConfig.findUnique({
            where: { companyId_key: { companyId, key } },
        });
    }
}
