import { AppError } from "../errors/AppError.js";
import { StoreRepository } from "../repositories/storeRepository.js";
import { AuditService } from "./auditService.js";
const DEFAULT_STORE = {
    cultivationBatches: [],
    completedCultivationBatches: [],
    dryFlowerBatches: [],
    productionBatches: [],
    sourceBatches: [],
    extractionBatches: [],
    packagingBatches: [],
    logs: []
};
export class StoreService {
    repo = new StoreRepository();
    audit = new AuditService();
    async load(companyId) {
        const row = await this.repo.getCompanyStore(companyId);
        if (!row?.valueJson)
            return { ...DEFAULT_STORE, _meta: { updatedAt: row?.updatedAt?.toISOString() ?? null } };
        try {
            const parsed = JSON.parse(row.valueJson);
            return {
                cultivationBatches: parsed.cultivationBatches ?? [],
                completedCultivationBatches: parsed.completedCultivationBatches ?? [],
                dryFlowerBatches: parsed.dryFlowerBatches ?? [],
                productionBatches: parsed.productionBatches ?? [],
                sourceBatches: parsed.sourceBatches ?? [],
                extractionBatches: parsed.extractionBatches ?? [],
                packagingBatches: parsed.packagingBatches ?? [],
                logs: parsed.logs ?? [],
                _meta: { updatedAt: row.updatedAt.toISOString() }
            };
        }
        catch {
            throw new AppError("Stored company snapshot is invalid JSON", 500);
        }
    }
    async save(companyId, actorUserId, snapshot) {
        const payload = (snapshot || {});
        const normalized = {
            cultivationBatches: Array.isArray(payload.cultivationBatches) ? payload.cultivationBatches : [],
            completedCultivationBatches: Array.isArray(payload.completedCultivationBatches) ? payload.completedCultivationBatches : [],
            dryFlowerBatches: Array.isArray(payload.dryFlowerBatches) ? payload.dryFlowerBatches : [],
            productionBatches: Array.isArray(payload.productionBatches) ? payload.productionBatches : [],
            sourceBatches: Array.isArray(payload.sourceBatches) ? payload.sourceBatches : [],
            extractionBatches: Array.isArray(payload.extractionBatches) ? payload.extractionBatches : [],
            packagingBatches: Array.isArray(payload.packagingBatches) ? payload.packagingBatches : [],
            logs: Array.isArray(payload.logs) ? payload.logs : []
        };
        const row = await this.repo.upsertCompanyStore(companyId, JSON.stringify(normalized));
        await this.audit.logAction({
            companyId,
            actorUserId,
            action: "store.snapshot.save",
            entityType: "CompanyStore",
            entityId: row.id,
            after: { updatedAt: row.updatedAt }
        });
        return { ...normalized, _meta: { updatedAt: row.updatedAt.toISOString() } };
    }
    async getVersion(companyId) {
        const row = await this.repo.getCompanyStore(companyId);
        return { updatedAt: row?.updatedAt?.toISOString() ?? null };
    }
}
