import { TenantRepository } from "./TenantRepository.js";

/** Company JSON snapshot belongs on `GET /api/store` — never merge into HTTP config payloads. */
export const LEGACY_COMPANY_STORE_CONFIG_KEY = "legacy_frontend_store";

export class ConfigRepository extends TenantRepository {
    async upsertConfig(companyId, key, valueJson) {
        return this.db.companyConfig.upsert({
            where: { companyId_key: { companyId, key } },
            update: { valueJson },
            create: { companyId, key, valueJson }
        });
    }
    async listConfigs(companyId, additionalExcludeKeys: string[] = []) {
        const exclude = [LEGACY_COMPANY_STORE_CONFIG_KEY, ...additionalExcludeKeys];
        return this.db.companyConfig.findMany({
            where: {
                companyId,
                key: { notIn: exclude },
            },
            orderBy: { key: "asc" },
        });
    }
    async getConfigRowMeta(companyId: string) {
        return this.db.companyConfig.findMany({
            where: {
                companyId,
                key: { notIn: [LEGACY_COMPANY_STORE_CONFIG_KEY] },
            },
            select: { key: true, updatedAt: true },
            orderBy: { key: "asc" },
        });
    }
    async getConfigRaw(companyId: string, key: string) {
        return this.db.companyConfig.findUnique({
            where: { companyId_key: { companyId, key } },
        });
    }
}
