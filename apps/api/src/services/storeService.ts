import { AppError } from "../errors/AppError.js";
import { StoreRepository } from "../repositories/storeRepository.js";
import { AuditService } from "./auditService.js";
const DEFAULT_STORE = {
    cultivationBatches: [],
    completedCultivationBatches: [],
    dryFlowerBatches: [],
    productionBatches: [],
    sourceBatches: [],
    completedSourceBatches: [],
    extractionBatches: [],
    packagingBatches: [],
    inProgressPackagingBatches: [],
    completedPackagingBatches: [],
    logs: []
};
export class StoreService {
    repo = new StoreRepository();
    audit = new AuditService();
    async load(companyId, opts?: { includeLogs?: boolean }) {
        const includeLogs = Boolean(opts?.includeLogs);
        const row = await this.repo.getCompanyStore(companyId);
        if (!row?.valueJson) {
            return {
                ...DEFAULT_STORE,
                logs: includeLogs ? [] : [],
                _meta: { updatedAt: row?.updatedAt?.toISOString() ?? null, logsOmitted: !includeLogs },
            };
        }
        try {
            const parsed = JSON.parse(row.valueJson);
            return {
                cultivationBatches: parsed.cultivationBatches ?? [],
                completedCultivationBatches: parsed.completedCultivationBatches ?? [],
                dryFlowerBatches: parsed.dryFlowerBatches ?? [],
                productionBatches: parsed.productionBatches ?? [],
                sourceBatches: parsed.sourceBatches ?? [],
                completedSourceBatches: parsed.completedSourceBatches ?? [],
                extractionBatches: parsed.extractionBatches ?? [],
                packagingBatches: parsed.packagingBatches ?? [],
                inProgressPackagingBatches: parsed.inProgressPackagingBatches ?? [],
                completedPackagingBatches: parsed.completedPackagingBatches ?? [],
                logs: includeLogs ? (parsed.logs ?? []) : [],
                _meta: {
                    updatedAt: row.updatedAt.toISOString(),
                    logsOmitted: !includeLogs,
                },
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
            completedSourceBatches: Array.isArray(payload.completedSourceBatches) ? payload.completedSourceBatches : [],
            extractionBatches: Array.isArray(payload.extractionBatches) ? payload.extractionBatches : [],
            packagingBatches: Array.isArray(payload.packagingBatches) ? payload.packagingBatches : [],
            inProgressPackagingBatches: Array.isArray(payload.inProgressPackagingBatches) ? payload.inProgressPackagingBatches : [],
            completedPackagingBatches: Array.isArray(payload.completedPackagingBatches) ? payload.completedPackagingBatches : [],
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

    /**
     * Subset of the company store for analytics (dry flower + source-related arrays only).
     * Falls back to `load()` on SQLite or if the JSON slice query fails.
     */
    async loadAnalyticsDryFlowerSourceSlices(companyId: string) {
        const sliced = await this.repo.getAnalyticsStoreSliceArrays(companyId);
        if (sliced)
            return sliced;
        const full = await this.load(companyId);
        return {
            dryFlowerBatches: full.dryFlowerBatches ?? [],
            sourceBatches: full.sourceBatches ?? [],
            productionBatches: full.productionBatches ?? [],
            completedSourceBatches: full.completedSourceBatches ?? [],
        };
    }
}
