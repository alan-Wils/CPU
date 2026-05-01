import { TenantRepository } from "./TenantRepository.js";
const STORE_KEY = "legacy_frontend_store";
export class StoreRepository extends TenantRepository {
    async getCompanyStore(companyId) {
        const row = await this.db.companyConfig.findUnique({
            where: { companyId_key: { companyId, key: STORE_KEY } }
        });
        return row;
    }
    async upsertCompanyStore(companyId, valueJson) {
        return this.db.companyConfig.upsert({
            where: { companyId_key: { companyId, key: STORE_KEY } },
            create: { companyId, key: STORE_KEY, valueJson },
            update: { valueJson }
        });
    }
}
