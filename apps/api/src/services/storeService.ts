import { AppError } from "../errors/AppError.js";
import { StoreRepository } from "../repositories/storeRepository.js";
import { AuditService } from "./auditService.js";

type StoreSnapshot = {
  cultivationBatches: any[];
  completedCultivationBatches: any[];
  dryFlowerBatches: any[];
  productionBatches: any[];
  sourceBatches: any[];
  extractionBatches: any[];
  packagingBatches: any[];
  logs: any[];
};

type StoreMeta = {
  updatedAt: string | null;
};

const DEFAULT_STORE: StoreSnapshot = {
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
  private readonly repo = new StoreRepository();
  private readonly audit = new AuditService();

  async load(companyId: string): Promise<StoreSnapshot & { _meta: StoreMeta }> {
    const row = await this.repo.getCompanyStore(companyId);
    if (!row?.valueJson) return { ...DEFAULT_STORE, _meta: { updatedAt: row?.updatedAt?.toISOString() ?? null } };
    try {
      const parsed = JSON.parse(row.valueJson) as Partial<StoreSnapshot>;
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
    } catch {
      throw new AppError("Stored company snapshot is invalid JSON", 500);
    }
  }

  async save(companyId: string, actorUserId: string, snapshot: unknown) {
    const payload = (snapshot || {}) as Partial<StoreSnapshot>;
    const normalized: StoreSnapshot = {
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

  async getVersion(companyId: string): Promise<StoreMeta> {
    const row = await this.repo.getCompanyStore(companyId);
    return { updatedAt: row?.updatedAt?.toISOString() ?? null };
  }
}
