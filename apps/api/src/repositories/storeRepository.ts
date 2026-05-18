import { TenantRepository } from "./TenantRepository.js";
const STORE_KEY = "legacy_frontend_store";

export type AnalyticsStoreSliceArrays = {
    dryFlowerBatches: unknown[];
    sourceBatches: unknown[];
    productionBatches: unknown[];
    completedSourceBatches: unknown[];
};

function asJsonArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export class StoreRepository extends TenantRepository {
    async getCompanyStore(companyId) {
        const row = await this.db.companyConfig.findUnique({
            where: { companyId_key: { companyId, key: STORE_KEY } }
        });
        return row;
    }

    /**
     * Postgres-only: read only the JSON arrays needed for cultivation strain analytics from `CompanyConfig`,
     * avoiding loading the full company store blob into the API process (and smaller Neon result sets).
     */
    /** Postgres JSON slice: legacy `sourceBatches` array only (avoids full company store blob). */
    async getSourceBatchesStoreSlice(companyId: string): Promise<unknown[] | null> {
        const url = String(process.env.DATABASE_URL || "");
        if (url.startsWith("file:"))
            return null;
        try {
            const rows = await this.db.$queryRaw<Array<{ src: unknown }>>`
        SELECT COALESCE(("valueJson"::jsonb -> 'sourceBatches'), '[]'::jsonb) AS src
        FROM "CompanyConfig"
        WHERE "companyId" = ${companyId}::uuid AND "key" = ${STORE_KEY}
        LIMIT 1
      `;
            const row = rows[0];
            if (!row)
                return null;
            return asJsonArray(row.src);
        }
        catch {
            return null;
        }
    }

    async getAnalyticsStoreSliceArrays(companyId: string): Promise<AnalyticsStoreSliceArrays | null> {
        const url = String(process.env.DATABASE_URL || "");
        if (url.startsWith("file:"))
            return null;
        try {
            const rows = await this.db.$queryRaw<
                Array<{
                    dry: unknown;
                    src: unknown;
                    prod: unknown;
                    comp: unknown;
                }>
            >`
        SELECT
          COALESCE(("valueJson"::jsonb -> 'dryFlowerBatches'), '[]'::jsonb) AS dry,
          COALESCE(("valueJson"::jsonb -> 'sourceBatches'), '[]'::jsonb) AS src,
          COALESCE(("valueJson"::jsonb -> 'productionBatches'), '[]'::jsonb) AS prod,
          COALESCE(("valueJson"::jsonb -> 'completedSourceBatches'), '[]'::jsonb) AS comp
        FROM "CompanyConfig"
        WHERE "companyId" = ${companyId}::uuid AND "key" = ${STORE_KEY}
        LIMIT 1
      `;
            const row = rows[0];
            if (!row)
                return null;
            return {
                dryFlowerBatches: asJsonArray(row.dry),
                sourceBatches: asJsonArray(row.src),
                productionBatches: asJsonArray(row.prod),
                completedSourceBatches: asJsonArray(row.comp),
            };
        }
        catch {
            return null;
        }
    }
    async upsertCompanyStore(companyId, valueJson) {
        return this.db.companyConfig.upsert({
            where: { companyId_key: { companyId, key: STORE_KEY } },
            create: { companyId, key: STORE_KEY, valueJson },
            update: { valueJson }
        });
    }
}
