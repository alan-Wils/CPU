import {
    CultivationTransferMaterialType,
    CultivationTransferStatus,
    CultivationTransferStorageType,
    Prisma,
} from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ConfigService } from "./configService.js";
import {
    normalizeCultivationStorageLocationsConfig,
    storageTypeForMaterialType,
    type CultivationStorageLocationsConfig,
} from "../lib/cultivationStorageConfig.js";
import { pruneLegacyMonolithicFreshFrozenFromStore } from "../lib/extractionSourceAvailability.js";
import {
    parseFreshFrozenGramsPerBundle,
    splitGramsAcrossFixedBundleCount,
    splitGramsEvenly,
} from "../lib/freshFrozenBundleSplit.js";
import { isPlaceholderFreshFrozenMetrcTag } from "../lib/freshFrozenMetrcTag.js";
import { repairMisclassifiedSourceBatchRow } from "../lib/repairMisclassifiedSourceBatch.js";
import { StoreService } from "./storeService.js";

const PENDING_STATUSES: CultivationTransferStatus[] = [
    CultivationTransferStatus.READY_TO_TRANSFER,
    CultivationTransferStatus.STORED,
];

function mergeConfigRowsToMap(rows: Array<{ key: string; value: unknown }>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of rows) {
        if (row.key && row.value !== undefined)
            out[row.key] = row.value;
    }
    return out;
}

export type CultivationTransferDto = {
    id: string;
    materialType: CultivationTransferMaterialType;
    transferStatus: CultivationTransferStatus;
    sourceCultivationBatchId: string;
    sourceDryFlowerBatchId: string | null;
    sourceEventType: string | null;
    sourceEventAt: string | null;
    storageType: CultivationTransferStorageType | null;
    storageLocationId: string | null;
    storageLocationName: string | null;
    displayName: string;
    harvestCode: string | null;
    metrcTag: string | null;
    parentGroupId: string | null;
    weightLbs: number | null;
    grams: number | null;
    bundles: number | null;
    materialPayload: Record<string, unknown> | null;
    extractionSourceBatchId: string | null;
    transferredAt: string | null;
    transferredByUserId: string | null;
    createdAt: string;
    updatedAt: string;
};

function toDto(row: {
    id: string;
    materialType: CultivationTransferMaterialType;
    transferStatus: CultivationTransferStatus;
    sourceCultivationBatchId: string;
    sourceDryFlowerBatchId: string | null;
    sourceEventType: string | null;
    sourceEventAt: Date | null;
    storageType: CultivationTransferStorageType | null;
    storageLocationId: string | null;
    storageLocationName: string | null;
    displayName: string;
    harvestCode: string | null;
    metrcTag: string | null;
    parentGroupId: string | null;
    weightLbs: number | null;
    grams: number | null;
    bundles: number | null;
    materialPayload: unknown;
    extractionSourceBatchId: string | null;
    transferredAt: Date | null;
    transferredByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
}): CultivationTransferDto {
    return {
        id: row.id,
        materialType: row.materialType,
        transferStatus: row.transferStatus,
        sourceCultivationBatchId: row.sourceCultivationBatchId,
        sourceDryFlowerBatchId: row.sourceDryFlowerBatchId,
        sourceEventType: row.sourceEventType,
        sourceEventAt: row.sourceEventAt?.toISOString() ?? null,
        storageType: row.storageType,
        storageLocationId: row.storageLocationId,
        storageLocationName: row.storageLocationName,
        displayName: row.displayName,
        harvestCode: row.harvestCode,
        metrcTag: row.metrcTag,
        parentGroupId: row.parentGroupId,
        weightLbs: row.weightLbs,
        grams: row.grams,
        bundles: row.bundles,
        materialPayload:
            row.materialPayload && typeof row.materialPayload === "object" && !Array.isArray(row.materialPayload)
                ? (row.materialPayload as Record<string, unknown>)
                : null,
        extractionSourceBatchId: row.extractionSourceBatchId,
        transferredAt: row.transferredAt?.toISOString() ?? null,
        transferredByUserId: row.transferredByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export class CultivationTransferService {
    private configService = new ConfigService();
    private storeService = new StoreService();

    async loadStorageConfig(companyId: string): Promise<CultivationStorageLocationsConfig> {
        const rows = await this.configService.list(companyId);
        const merged = mergeConfigRowsToMap(rows.map((r) => ({ key: r.key, value: r.value })));
        const cult = merged.cultivation;
        const storageRaw =
            cult && typeof cult === "object" && !Array.isArray(cult)
                ? (cult as Record<string, unknown>).storageLocations
                : undefined;
        return normalizeCultivationStorageLocationsConfig(storageRaw);
    }

    private async loadFreshFrozenGramsPerBundle(companyId: string): Promise<number> {
        const rows = await this.configService.list(companyId);
        const merged = mergeConfigRowsToMap(rows.map((r) => ({ key: r.key, value: r.value })));
        const cult = merged.cultivation;
        if (!cult || typeof cult !== "object" || Array.isArray(cult))
            return 0;
        return parseFreshFrozenGramsPerBundle(
            (cult as Record<string, unknown>).freshFrozenGramsPerBundle,
        );
    }

    private resolveStorageLocation(
        config: CultivationStorageLocationsConfig,
        materialType: CultivationTransferMaterialType,
        storageLocationId?: string | null,
        storageLocationName?: string | null,
    ): {
        storageType: CultivationTransferStorageType;
        storageLocationId: string;
        storageLocationName: string;
        transferStatus: CultivationTransferStatus;
    } {
        const storageType = storageTypeForMaterialType(materialType) as CultivationTransferStorageType;
        const list =
            materialType === CultivationTransferMaterialType.FRESH_FROZEN
                ? config.freezers
                : config.dryRooms;
        const id = String(storageLocationId ?? "").trim();
        const byId = id ? list.find((l) => l.id === id) : undefined;
        const byName = list.find(
            (l) => l.name.toLowerCase() === String(storageLocationName ?? "").trim().toLowerCase(),
        );
        const hit = byId ?? byName ?? list[0];
        if (!hit)
            throw new AppError("No storage location configured for this material type", 400);
        return {
            storageType,
            storageLocationId: hit.id,
            storageLocationName: hit.name,
            transferStatus: CultivationTransferStatus.STORED,
        };
    }

    async list(params: {
        companyId: string;
        status?: string;
        materialType?: CultivationTransferMaterialType;
        batch?: string;
        storageLocationId?: string;
    }): Promise<CultivationTransferDto[]> {
        const where: Prisma.CultivationExtractionTransferWhereInput = {
            companyId: params.companyId,
        };
        const statusFilter = String(params.status ?? "pending").trim().toLowerCase();
        if (statusFilter === "pending" || !statusFilter) {
            where.transferStatus = { in: PENDING_STATUSES };
        }
        else if (statusFilter !== "all") {
            where.transferStatus = statusFilter.toUpperCase() as CultivationTransferStatus;
        }
        if (params.materialType)
            where.materialType = params.materialType;
        const batchQ = String(params.batch ?? "").trim();
        if (batchQ) {
            where.OR = [
                { sourceCultivationBatchId: { contains: batchQ } },
                { sourceDryFlowerBatchId: { contains: batchQ } },
                { displayName: { contains: batchQ } },
                { harvestCode: { contains: batchQ } },
                { metrcTag: { contains: batchQ } },
                { parentGroupId: { contains: batchQ } },
            ];
        }
        const locId = String(params.storageLocationId ?? "").trim();
        if (locId)
            where.storageLocationId = locId;

        const rows = await prisma.cultivationExtractionTransfer.findMany({
            where,
            orderBy: [{ createdAt: "desc" }],
            take: 500,
        });
        return rows.map(toDto);
    }

    async create(params: {
        companyId: string;
        materialType: CultivationTransferMaterialType;
        sourceCultivationBatchId: string;
        sourceDryFlowerBatchId?: string | null;
        sourceEventType?: string | null;
        sourceEventAt?: Date | string | null;
        displayName: string;
        harvestCode?: string | null;
        metrcTag?: string | null;
        parentGroupId?: string | null;
        weightLbs?: number | null;
        grams?: number | null;
        bundles?: number | null;
        materialPayload?: Record<string, unknown> | null;
        storageLocationId?: string | null;
        storageLocationName?: string | null;
    }): Promise<CultivationTransferDto> {
        const sourceCultivationBatchId = String(params.sourceCultivationBatchId || "").trim();
        if (!sourceCultivationBatchId)
            throw new AppError("sourceCultivationBatchId is required", 400);
        const displayName = String(params.displayName || "").trim();
        if (!displayName)
            throw new AppError("displayName is required", 400);

        const config = await this.loadStorageConfig(params.companyId);
        const storage =
            params.storageLocationId || params.storageLocationName
                ? this.resolveStorageLocation(
                    config,
                    params.materialType,
                    params.storageLocationId,
                    params.storageLocationName,
                )
                : {
                    storageType: storageTypeForMaterialType(
                        params.materialType,
                    ) as CultivationTransferStorageType,
                    storageLocationId: null as unknown as string,
                    storageLocationName: null as unknown as string,
                    transferStatus: CultivationTransferStatus.READY_TO_TRANSFER,
                };

        const hasStorage = Boolean(params.storageLocationId || params.storageLocationName);

        const row = await prisma.cultivationExtractionTransfer.create({
            data: {
                companyId: params.companyId,
                materialType: params.materialType,
                transferStatus: hasStorage
                    ? CultivationTransferStatus.STORED
                    : CultivationTransferStatus.READY_TO_TRANSFER,
                sourceCultivationBatchId,
                sourceDryFlowerBatchId: params.sourceDryFlowerBatchId
                    ? String(params.sourceDryFlowerBatchId).trim()
                    : null,
                sourceEventType: params.sourceEventType ? String(params.sourceEventType).trim() : null,
                sourceEventAt: params.sourceEventAt
                    ? new Date(params.sourceEventAt)
                    : new Date(),
                storageType: hasStorage ? storage.storageType : null,
                storageLocationId: hasStorage ? storage.storageLocationId : null,
                storageLocationName: hasStorage ? storage.storageLocationName : null,
                displayName,
                harvestCode: params.harvestCode ? String(params.harvestCode).trim() : null,
                metrcTag: params.metrcTag ? String(params.metrcTag).trim() : null,
                parentGroupId: params.parentGroupId ? String(params.parentGroupId).trim() : null,
                weightLbs: params.weightLbs ?? null,
                grams: params.grams ?? null,
                bundles: params.bundles != null ? Math.trunc(Number(params.bundles) || 0) : null,
                materialPayload: params.materialPayload
                    ? (params.materialPayload as Prisma.InputJsonValue)
                    : undefined,
            },
        });
        return toDto(row);
    }

    async createFreshFrozenBundles(params: {
        companyId: string;
        sourceCultivationBatchId: string;
        strainName: string;
        parentGroupId?: string | null;
        sourceEventAt?: Date | string | null;
        harvestDate?: string | null;
        plantsHarvested?: number | null;
        sharedPayload?: Record<string, unknown> | null;
        bundles: Array<{
            metrcTag: string;
            grams: number;
            storageLocationId?: string | null;
            storageLocationName?: string | null;
        }>;
    }): Promise<CultivationTransferDto[]> {
        const parentGroupId =
            String(params.parentGroupId || "").trim() ||
            `ff-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const harvestYmd =
            String(params.harvestDate || "").trim() ||
            new Date().toISOString().slice(0, 10);
        const out: CultivationTransferDto[] = [];
        for (let i = 0; i < params.bundles.length; i++) {
            const b = params.bundles[i];
            const tag = String(b.metrcTag || "").trim();
            const grams = Number(b.grams);
            if (!tag)
                throw new AppError(`Bundle ${i + 1}: METRC tag is required`, 400);
            if (!Number.isFinite(grams) || grams <= 0)
                throw new AppError(`Bundle ${i + 1}: grams must be greater than zero`, 400);
            const weightLbs = +(grams / 453.592).toFixed(4);
            const harvestCode = `${parentGroupId}-${tag.replace(/\s+/g, "")}`;
            const row = await this.create({
                companyId: params.companyId,
                materialType: CultivationTransferMaterialType.FRESH_FROZEN,
                sourceCultivationBatchId: params.sourceCultivationBatchId,
                sourceEventType: "HARVEST_FRESH_FROZEN_BUNDLE",
                sourceEventAt: params.sourceEventAt,
                displayName: `${params.strainName} FF · ${tag}`,
                harvestCode,
                metrcTag: tag,
                parentGroupId,
                weightLbs,
                grams,
                bundles: 1,
                materialPayload: {
                    ...(params.sharedPayload || {}),
                    harvestDate: harvestYmd,
                    bundleIndex: i + 1,
                    bundleCount: params.bundles.length,
                    ...(params.plantsHarvested != null
                        ? { plantsHarvested: params.plantsHarvested }
                        : {}),
                },
                storageLocationId: b.storageLocationId,
                storageLocationName: b.storageLocationName,
            });
            out.push(row);
        }
        return out;
    }

    async updateStorage(params: {
        companyId: string;
        id: string;
        storageLocationId: string;
        storageLocationName?: string;
    }): Promise<CultivationTransferDto> {
        return this.patchTransfer({
            companyId: params.companyId,
            id: params.id,
            storageLocationId: params.storageLocationId,
            storageLocationName: params.storageLocationName,
        });
    }

    /** Split one aggregated FF row (bundles > 1) into separate one-bundle transfer rows. */
    async splitIntoIndividualBundles(params: {
        companyId: string;
        id: string;
        bundleCount?: number;
    }): Promise<CultivationTransferDto[]> {
        const existing = await prisma.cultivationExtractionTransfer.findFirst({
            where: { id: params.id, companyId: params.companyId },
        });
        if (!existing)
            throw new AppError("Transfer record not found", 404);
        if (existing.materialType !== CultivationTransferMaterialType.FRESH_FROZEN)
            throw new AppError("Only Fresh Frozen packages can be split into bundles", 400);
        if (existing.transferStatus === CultivationTransferStatus.TRANSFERRED_TO_EXTRACTION)
            throw new AppError("Cannot split after transfer to extraction", 400);

        const storedBundles = Math.max(0, Math.floor(Number(existing.bundles) || 0));
        const bundleCount = Math.max(
            2,
            Math.floor(Number(params.bundleCount) || storedBundles || 0),
        );
        if (storedBundles <= 1 && bundleCount < 2)
            throw new AppError("This package is already a single bundle", 400);

        const totalGrams = Math.max(0, Number(existing.grams ?? 0));
        if (totalGrams <= 0)
            throw new AppError("Cannot split: total grams must be greater than zero", 400);

        const gramsPerBundle = await this.loadFreshFrozenGramsPerBundle(params.companyId);
        let gramsEach: number[];
        if (gramsPerBundle > 0) {
            if (bundleCount > 1 && totalGrams < gramsPerBundle * (bundleCount - 1)) {
                throw new AppError(
                    `Total ${totalGrams} g is too low for ${bundleCount} bundles at ${gramsPerBundle} g each. Adjust total weight or bundle count.`,
                    400,
                );
            }
            gramsEach = splitGramsAcrossFixedBundleCount(
                totalGrams,
                gramsPerBundle,
                bundleCount,
            );
            if (gramsEach.length !== bundleCount)
                throw new AppError("Could not split bundles with configured bundle weight", 400);
        } else {
            gramsEach = splitGramsEvenly(totalGrams, bundleCount);
        }
        const parentGroupId =
            String(existing.parentGroupId || "").trim()
            || `ff-${existing.sourceCultivationBatchId}-${Date.now()}`;
        const basePayload =
            existing.materialPayload && typeof existing.materialPayload === "object"
                ? (existing.materialPayload as Record<string, unknown>)
                : {};
        const baseTag = String(existing.metrcTag || "BUNDLE").trim();
        const nameBase = String(existing.displayName || "Fresh Frozen")
            .replace(/\s*FF\s*·.*$/i, "")
            .trim();

        const out: CultivationTransferDto[] = [];

        for (let i = 0; i < bundleCount; i++) {
            const grams = gramsEach[i];
            const weightLbs = +(grams / 453.592).toFixed(4);
            const tag = `${baseTag}-${i + 1}`;
            const harvestCode = `${parentGroupId}-${tag.replace(/\s+/g, "")}`;
            const displayName = nameBase ? `${nameBase} FF · ${tag}` : `${existing.displayName} · ${tag}`;
            const payload = {
                ...basePayload,
                splitFromTransferId: existing.id,
                bundleIndex: i + 1,
                bundleCount,
                splitAt: new Date().toISOString(),
            };

            if (i === 0) {
                const row = await prisma.cultivationExtractionTransfer.update({
                    where: { id: existing.id },
                    data: {
                        grams,
                        weightLbs,
                        bundles: 1,
                        metrcTag: tag,
                        harvestCode,
                        displayName,
                        parentGroupId,
                        materialPayload: payload as Prisma.InputJsonValue,
                    },
                });
                out.push(toDto(row));
                continue;
            }

            const row = await prisma.cultivationExtractionTransfer.create({
                data: {
                    companyId: params.companyId,
                    materialType: CultivationTransferMaterialType.FRESH_FROZEN,
                    transferStatus: existing.transferStatus,
                    sourceCultivationBatchId: existing.sourceCultivationBatchId,
                    sourceDryFlowerBatchId: existing.sourceDryFlowerBatchId,
                    sourceEventType: existing.sourceEventType,
                    sourceEventAt: existing.sourceEventAt,
                    storageType: existing.storageType,
                    storageLocationId: existing.storageLocationId,
                    storageLocationName: existing.storageLocationName,
                    displayName,
                    harvestCode,
                    metrcTag: tag,
                    parentGroupId,
                    weightLbs,
                    grams,
                    bundles: 1,
                    materialPayload: payload as Prisma.InputJsonValue,
                },
            });
            out.push(toDto(row));
        }

        return out;
    }

    async patchTransfer(params: {
        companyId: string;
        id: string;
        storageLocationId?: string;
        storageLocationName?: string;
        displayName?: string;
        metrcTag?: string;
        grams?: number;
        bundles?: number;
        weightLbs?: number;
    }): Promise<CultivationTransferDto> {
        const existing = await prisma.cultivationExtractionTransfer.findFirst({
            where: { id: params.id, companyId: params.companyId },
        });
        if (!existing)
            throw new AppError("Transfer record not found", 404);
        if (existing.transferStatus === CultivationTransferStatus.TRANSFERRED_TO_EXTRACTION)
            throw new AppError("Cannot edit after transfer to extraction", 400);

        const data: Prisma.CultivationExtractionTransferUpdateInput = {};

        const storageLocationId = String(params.storageLocationId ?? "").trim();
        if (storageLocationId) {
            const config = await this.loadStorageConfig(params.companyId);
            const storage = this.resolveStorageLocation(
                config,
                existing.materialType,
                storageLocationId,
                params.storageLocationName,
            );
            data.storageType = storage.storageType;
            data.storageLocationId = storage.storageLocationId;
            data.storageLocationName = storage.storageLocationName;
            data.transferStatus = CultivationTransferStatus.STORED;
        }

        const displayName = String(params.displayName ?? "").trim();
        if (displayName)
            data.displayName = displayName;

        if (params.metrcTag !== undefined) {
            const metrcTag = String(params.metrcTag).trim();
            if (!metrcTag)
                throw new AppError("METRC tag is required", 400);
            data.metrcTag = metrcTag;
            const parentGroupId =
                String(existing.parentGroupId || "").trim()
                || `ff-${existing.sourceCultivationBatchId}`;
            data.harvestCode = `${parentGroupId}-${metrcTag.replace(/\s+/g, "")}`;
            const currentDisplay = String(existing.displayName || "");
            if (/\s+FF\s*·/i.test(currentDisplay)) {
                const nameBase = currentDisplay.replace(/\s*FF\s*·.*$/i, "").trim();
                if (nameBase)
                    data.displayName = `${nameBase} FF · ${metrcTag}`;
            }
        }

        if (existing.materialType === CultivationTransferMaterialType.FRESH_FROZEN) {
            if (params.grams !== undefined) {
                const grams = Math.max(0, Number(params.grams));
                data.grams = grams;
                data.weightLbs = +(grams / 453.592).toFixed(4);
            }
            if (params.bundles !== undefined)
                data.bundles = Math.max(0, Math.floor(Number(params.bundles)));
        }
        else if (params.weightLbs !== undefined) {
            data.weightLbs = Math.max(0, Number(params.weightLbs));
        }

        const row = await prisma.cultivationExtractionTransfer.update({
            where: { id: existing.id },
            data,
        });
        return toDto(row);
    }

    private buildLegacySourceBatchFromTransfer(
        transfer: NonNullable<Awaited<ReturnType<typeof prisma.cultivationExtractionTransfer.findFirst>>>,
        sourceBatchId: string,
    ): Record<string, unknown> {
        const payload =
            transfer.materialPayload && typeof transfer.materialPayload === "object"
                ? (transfer.materialPayload as Record<string, unknown>)
                : {};
        const type =
            transfer.materialType === CultivationTransferMaterialType.FRESH_FROZEN
                ? "Fresh Frozen"
                : "Dry Trim";
        const tag = String(transfer.metrcTag || "").trim();
        const base: Record<string, unknown> = {
            id: sourceBatchId,
            name: tag ? `${transfer.displayName}` : transfer.displayName,
            type,
            source: transfer.sourceCultivationBatchId,
            status: "Available for Extraction",
            createdAt: new Date().toISOString(),
            cultivationTransferId: transfer.id,
            manualTransferToExtraction: true,
            storageType: transfer.storageType,
            storageLocationId: transfer.storageLocationId,
            storageLocationName: transfer.storageLocationName,
            ...(tag ? { metrcTag: tag, plantTag: tag } : {}),
            ...(transfer.parentGroupId ? { parentGroupId: transfer.parentGroupId } : {}),
        };
        if (transfer.harvestCode) {
            base.harvestCode = transfer.harvestCode;
            base.harvestDate =
                typeof payload.harvestDate === "string"
                    ? payload.harvestDate
                    : transfer.sourceEventAt?.toISOString().slice(0, 10);
        }
        if (transfer.materialType === CultivationTransferMaterialType.FRESH_FROZEN) {
            const grams = Number(transfer.grams ?? 0);
            const bundles = Number(transfer.bundles ?? 0);
            const weightLbs =
                transfer.weightLbs != null
                    ? Number(transfer.weightLbs)
                    : +(grams / 453.592).toFixed(4);
            base.grams = grams;
            base.bundles = bundles;
            base.weightLbs = weightLbs;
            base.amount =
                bundles <= 1 && tag
                    ? `1 bundle (${tag}) / ${grams} g`
                    : `${bundles} bundles / ${grams} grams`;
            if (payload.plantsHarvested != null)
                base.plantsHarvested = payload.plantsHarvested;
            if (payload.harvestSheetSnapshot)
                base.harvestSheetSnapshot = payload.harvestSheetSnapshot;
            if (payload.freshFrozenStemWasteGrams != null)
                base.freshFrozenStemWasteGrams = payload.freshFrozenStemWasteGrams;
            if (payload.harvestSheetAiTotalGrams != null)
                base.harvestSheetAiTotalGrams = payload.harvestSheetAiTotalGrams;
        }
        else {
            const weightLbs = Number(transfer.weightLbs ?? 0);
            base.weightLbs = weightLbs;
            base.amount = `${weightLbs} lbs`;
            if (transfer.sourceDryFlowerBatchId)
                base.parentCultivationBatch = transfer.sourceCultivationBatchId;
        }
        return { ...base, ...payload, ...base };
    }

    async transferToExtraction(params: {
        companyId: string;
        actorUserId: string;
        ids: string[];
    }): Promise<{ rows: CultivationTransferDto[]; sourceBatches: Record<string, unknown>[] }> {
        const ids = [...new Set(params.ids.map((id) => String(id).trim()).filter(Boolean))];
        if (ids.length === 0)
            throw new AppError("At least one transfer id is required", 400);

        const rows = await prisma.cultivationExtractionTransfer.findMany({
            where: {
                companyId: params.companyId,
                id: { in: ids },
                transferStatus: { in: PENDING_STATUSES },
            },
        });
        if (rows.length !== ids.length)
            throw new AppError("One or more transfer records were not found or already transferred", 404);

        const missingMetrc = rows.filter(
            (r) =>
                r.materialType === CultivationTransferMaterialType.FRESH_FROZEN
                && isPlaceholderFreshFrozenMetrcTag(r.metrcTag),
        );
        if (missingMetrc.length > 0) {
            const labels = missingMetrc
                .slice(0, 3)
                .map((r) => String(r.displayName || r.id).trim())
                .join(", ");
            throw new AppError(
                `Each Fresh Frozen bundle needs a METRC tag before transfer${labels ? `: ${labels}` : ""}`,
                400,
            );
        }

        const sourceBatches: Record<string, unknown>[] = [];
        const updated: CultivationTransferDto[] = [];
        const affectedCultivationBatchIds = new Set<string>();
        const affectedParentGroupIds = new Set<string>();

        const snap = await this.storeService.load(params.companyId);
        let list = Array.isArray(snap.sourceBatches) ? [...snap.sourceBatches] : [];

        for (const row of rows) {
            const sourceBatchId =
                String(row.harvestCode || "").trim() ||
                `xfer-${row.id.slice(0, 8)}-${Date.now()}`;
            const legacyBatch = this.buildLegacySourceBatchFromTransfer(row, sourceBatchId);

            const existingIdx = list.findIndex(
                (b) => String((b as { id?: string })?.id || "") === sourceBatchId,
            );
            if (existingIdx >= 0)
                list[existingIdx] = legacyBatch;
            else
                list.unshift(legacyBatch);

            const cultivationId = String(row.sourceCultivationBatchId || "").trim();
            if (cultivationId)
                affectedCultivationBatchIds.add(cultivationId);
            const parentGroupId = String(row.parentGroupId || "").trim();
            if (parentGroupId)
                affectedParentGroupIds.add(parentGroupId);

            const updatedRow = await prisma.cultivationExtractionTransfer.update({
                where: { id: row.id },
                data: {
                    transferStatus: CultivationTransferStatus.TRANSFERRED_TO_EXTRACTION,
                    extractionSourceBatchId: sourceBatchId,
                    transferredAt: new Date(),
                    transferredByUserId: params.actorUserId,
                },
            });
            sourceBatches.push(legacyBatch);
            updated.push(toDto(updatedRow));
        }

        list = pruneLegacyMonolithicFreshFrozenFromStore(
            list,
            affectedCultivationBatchIds,
            affectedParentGroupIds,
        );
        await this.storeService.save(params.companyId, params.actorUserId, { ...snap, sourceBatches: list });

        return { rows: updated, sourceBatches };
    }

    /**
     * Rebuild store `sourceBatches` rows for transfers already marked TRANSFERRED_TO_EXTRACTION
     * when a stale client PUT /api/store overwrote the server snapshot (trim/FF missing on Extraction).
     */
    async reconcileMissingExtractionSourceBatches(params: {
        companyId: string;
        actorUserId: string;
    }): Promise<number> {
        const transferred = await prisma.cultivationExtractionTransfer.findMany({
            where: {
                companyId: params.companyId,
                transferStatus: CultivationTransferStatus.TRANSFERRED_TO_EXTRACTION,
                extractionSourceBatchId: { not: null },
            },
            orderBy: { transferredAt: "desc" },
            take: 500,
        });
        if (transferred.length === 0)
            return 0;

        const snap = await this.storeService.load(params.companyId);
        const list = Array.isArray(snap.sourceBatches) ? [...snap.sourceBatches] : [];
        const ids = new Set(
            list.map((b) =>
                String(b && typeof b === "object" ? (b as { id?: string }).id || "" : "").trim(),
            ),
        );

        let added = 0;
        for (const row of transferred) {
            const sourceBatchId = String(row.extractionSourceBatchId || "").trim();
            if (!sourceBatchId || ids.has(sourceBatchId))
                continue;
            const legacyBatch = this.buildLegacySourceBatchFromTransfer(row, sourceBatchId);
            list.unshift(legacyBatch);
            ids.add(sourceBatchId);
            added++;
        }

        if (added > 0) {
            await this.storeService.save(params.companyId, params.actorUserId, {
                ...snap,
                sourceBatches: list,
            });
        }

        return added;
    }

    /**
     * Fix store rows marked Complete while still holding transferred weight (never used in extraction).
     */
    async reconcileMisclassifiedTransferredSources(params: {
        companyId: string;
        actorUserId: string;
    }): Promise<number> {
        const transferred = await prisma.cultivationExtractionTransfer.findMany({
            where: {
                companyId: params.companyId,
                transferStatus: CultivationTransferStatus.TRANSFERRED_TO_EXTRACTION,
                extractionSourceBatchId: { not: null },
            },
            take: 500,
        });
        if (transferred.length === 0)
            return 0;

        const snap = await this.storeService.load(params.companyId);
        const snapRecord = snap as Record<string, unknown>;
        const extractionLists = [
            ...(Array.isArray(snap.extractionBatches) ? snap.extractionBatches : []),
            ...(Array.isArray(snapRecord.completedExtractionBatches)
                ? snapRecord.completedExtractionBatches
                : []),
        ];
        const usedOnExtractionBatch = new Set<string>();
        for (const raw of extractionLists) {
            const batch = raw && typeof raw === "object" ? (raw as { sources?: unknown }) : null;
            if (!batch)
                continue;
            const sources = Array.isArray(batch.sources) ? batch.sources : [];
            for (const s of sources) {
                const sourceId = String(
                    (s as { sourceId?: string })?.sourceId || "",
                ).trim();
                if (sourceId)
                    usedOnExtractionBatch.add(sourceId);
            }
        }

        let list = Array.isArray(snap.sourceBatches) ? [...snap.sourceBatches] : [];
        let completed = Array.isArray(snap.completedSourceBatches)
            ? [...snap.completedSourceBatches]
            : [];
        let fixed = 0;

        const repairId = (sourceBatchId: string) => {
            const id = sourceBatchId.trim();
            if (!id || usedOnExtractionBatch.has(id))
                return;

            const inListIdx = list.findIndex(
                (b) => String((b as { id?: string })?.id || "").trim() === id,
            );
            const inCompletedIdx = completed.findIndex(
                (b) => String((b as { id?: string })?.id || "").trim() === id,
            );
            const row =
                inListIdx >= 0
                    ? list[inListIdx]
                    : inCompletedIdx >= 0
                      ? completed[inCompletedIdx]
                      : null;
            if (!row)
                return;

            const repaired = repairMisclassifiedSourceBatchRow(row);
            if (!repaired)
                return;

            if (inListIdx >= 0)
                list[inListIdx] = repaired;
            else
                list.unshift(repaired);

            if (inCompletedIdx >= 0)
                completed.splice(inCompletedIdx, 1);

            fixed++;
        };

        for (const row of transferred) {
            const sourceBatchId = String(row.extractionSourceBatchId || "").trim();
            if (sourceBatchId)
                repairId(sourceBatchId);
        }

        for (let i = completed.length - 1; i >= 0; i--) {
            const row = completed[i];
            const repaired = repairMisclassifiedSourceBatchRow(row);
            if (!repaired)
                continue;
            const id = String((repaired as { id?: string }).id || "").trim();
            if (!id || usedOnExtractionBatch.has(id))
                continue;
            completed.splice(i, 1);
            const inListIdx = list.findIndex(
                (b) => String((b as { id?: string })?.id || "").trim() === id,
            );
            if (inListIdx >= 0)
                list[inListIdx] = repaired;
            else
                list.unshift(repaired);
            fixed++;
        }

        if (fixed > 0) {
            await this.storeService.save(params.companyId, params.actorUserId, {
                ...snap,
                sourceBatches: list,
                completedSourceBatches: completed,
            });
        }

        return fixed;
    }

    /**
     * Move a package from Extraction back to cultivation storage (freezer / dry room).
     * Appears again in Cultivation → Ready to Transfer.
     */
    private findStoreSourceRow(
        snap: Awaited<ReturnType<StoreService["load"]>>,
        sourceBatchId: string,
    ): Record<string, unknown> | null {
        const id = sourceBatchId.trim();
        if (!id)
            return null;
        const pools = [
            ...(Array.isArray(snap.sourceBatches) ? snap.sourceBatches : []),
            ...(Array.isArray(snap.completedSourceBatches) ? snap.completedSourceBatches : []),
        ];
        for (const raw of pools) {
            if (!raw || typeof raw !== "object")
                continue;
            const row = raw as Record<string, unknown>;
            if (String(row.id || "").trim() === id)
                return row;
        }
        return null;
    }

    /** e.g. FF-GUAV.012026-1 → GUAV.012026 */
    private inferSourceCultivationBatchIdFromFfId(sourceBatchId: string): string {
        const m = String(sourceBatchId || "").trim().match(/^FF-(.+)-\d+$/i);
        return m?.[1]?.trim() || "";
    }

    private materialTypeFromStoreRow(storeRow: Record<string, unknown>): CultivationTransferMaterialType {
        const t = String(storeRow.type || storeRow.name || "").toLowerCase();
        return t.includes("dry trim") || t.includes("trim")
            ? CultivationTransferMaterialType.TRIM
            : CultivationTransferMaterialType.FRESH_FROZEN;
    }

    private minimalStoreRowFromSourceBatchId(sourceBatchId: string): Record<string, unknown> | null {
        const id = String(sourceBatchId || "").trim();
        if (!/^FF-/i.test(id) && !/^TRIM-/i.test(id))
            return null;
        const source = this.inferSourceCultivationBatchIdFromFfId(id)
            || (/^TRIM-/i.test(id) ? id.replace(/^TRIM-/i, "").split("-")[0] : "");
        const type = /^TRIM-/i.test(id) ? "Dry Trim" : "Fresh Frozen";
        const name = id.replace(/^(FF|TRIM)-/i, "").replace(/-/g, " ") || id;
        return {
            id,
            type,
            name,
            source: source || undefined,
            status: "Complete",
            manualTransferToExtraction: true,
        };
    }

    private resolveStoreRowForReturn(
        snap: Awaited<ReturnType<StoreService["load"]>>,
        sourceBatchId: string,
        clientPackage?: Record<string, unknown> | null,
    ): Record<string, unknown> | null {
        const fromSnap = this.findStoreSourceRow(snap, sourceBatchId);
        if (fromSnap && clientPackage)
            return { ...fromSnap, ...clientPackage, id: sourceBatchId };
        if (fromSnap)
            return fromSnap;
        if (clientPackage && typeof clientPackage === "object")
            return { ...clientPackage, id: sourceBatchId };
        return this.minimalStoreRowFromSourceBatchId(sourceBatchId);
    }

    private async resolveStorageLocationForReturn(
        companyId: string,
        materialType: CultivationTransferMaterialType,
        storeRow: Record<string, unknown>,
    ): Promise<{
        storageType: CultivationTransferStorageType;
        storageLocationId: string;
        storageLocationName: string;
    }> {
        const rowId = String(storeRow.storageLocationId || "").trim();
        const rowName = String(storeRow.storageLocationName || "").trim();
        if (rowId && rowName) {
            const storageType =
                materialType === CultivationTransferMaterialType.TRIM
                    ? CultivationTransferStorageType.DRY_ROOM
                    : CultivationTransferStorageType.FREEZER;
            return {
                storageType,
                storageLocationId: rowId,
                storageLocationName: rowName,
            };
        }
        try {
            const config = await this.loadStorageConfig(companyId);
            const resolved = this.resolveStorageLocation(
                config,
                materialType,
                rowId,
                rowName,
            );
            return {
                storageType: resolved.storageType,
                storageLocationId: resolved.storageLocationId,
                storageLocationName: resolved.storageLocationName,
            };
        }
        catch {
            const storageType =
                materialType === CultivationTransferMaterialType.TRIM
                    ? CultivationTransferStorageType.DRY_ROOM
                    : CultivationTransferStorageType.FREEZER;
            return {
                storageType,
                storageLocationId: rowId || "unassigned",
                storageLocationName: rowName || "Unassigned",
            };
        }
    }

    private async findTransferForReturn(
        companyId: string,
        sourceBatchId: string,
        storeRow: Record<string, unknown> | null,
    ) {
        const cultivationTransferId = String(storeRow?.cultivationTransferId || "").trim();
        const metrcTag = String(storeRow?.metrcTag || storeRow?.plantTag || "").trim();
        const sourceCultivationBatchId =
            String(storeRow?.source || "").trim()
            || this.inferSourceCultivationBatchIdFromFfId(sourceBatchId);
        const parentGroupId = String(storeRow?.parentGroupId || "").trim();

        const or: Prisma.CultivationExtractionTransferWhereInput[] = [
            { extractionSourceBatchId: sourceBatchId },
            { harvestCode: sourceBatchId },
        ];
        if (cultivationTransferId)
            or.push({ id: cultivationTransferId });
        if (metrcTag)
            or.push({ metrcTag });
        if (sourceCultivationBatchId && metrcTag) {
            or.push({
                sourceCultivationBatchId,
                metrcTag,
            });
        }
        if (parentGroupId)
            or.push({ parentGroupId });

        const transferred = await prisma.cultivationExtractionTransfer.findFirst({
            where: {
                companyId,
                transferStatus: CultivationTransferStatus.TRANSFERRED_TO_EXTRACTION,
                OR: or,
            },
            orderBy: { updatedAt: "desc" },
        });
        if (transferred)
            return transferred;

        return prisma.cultivationExtractionTransfer.findFirst({
            where: { companyId, OR: or },
            orderBy: { updatedAt: "desc" },
        });
    }

    private async restoreStoredTransferFromStoreRow(params: {
        companyId: string;
        sourceBatchId: string;
        storeRow: Record<string, unknown>;
    }) {
        const sourceCultivationBatchId =
            String(params.storeRow.source || "").trim()
            || this.inferSourceCultivationBatchIdFromFfId(params.sourceBatchId);
        if (!sourceCultivationBatchId)
            throw new AppError(
                "Cannot return this package: missing cultivation batch link. Re-harvest Fresh Frozen on the cultivation lot or contact support.",
                404,
            );

        const materialType = this.materialTypeFromStoreRow(params.storeRow);
        const storage = await this.resolveStorageLocationForReturn(
            params.companyId,
            materialType,
            params.storeRow,
        );

        const metrcTag = String(params.storeRow.metrcTag || params.storeRow.plantTag || "").trim();
        const grams = Number(params.storeRow.grams ?? 0);
        const bundles = Math.max(0, Math.floor(Number(params.storeRow.bundles ?? 0)));
        const weightLbs =
            params.storeRow.weightLbs != null
                ? Number(params.storeRow.weightLbs)
                : grams > 0
                  ? +(grams / 453.592).toFixed(4)
                  : 0;
        const displayName = String(params.storeRow.name || params.sourceBatchId).trim()
            || params.sourceBatchId;
        const harvestCode = String(params.storeRow.harvestCode || params.sourceBatchId).trim();
        const parentGroupId = String(params.storeRow.parentGroupId || "").trim() || null;

        const payload =
            params.storeRow.materialPayload && typeof params.storeRow.materialPayload === "object"
                ? (params.storeRow.materialPayload as Prisma.InputJsonValue)
                : undefined;

        const existing = await prisma.cultivationExtractionTransfer.findFirst({
            where: {
                companyId: params.companyId,
                sourceCultivationBatchId,
                ...(metrcTag ? { metrcTag } : { harvestCode: harvestCode || params.sourceBatchId }),
            },
            orderBy: { updatedAt: "desc" },
        });
        if (existing) {
            return prisma.cultivationExtractionTransfer.update({
                where: { id: existing.id },
                data: {
                    transferStatus: CultivationTransferStatus.STORED,
                    extractionSourceBatchId: null,
                    transferredAt: null,
                    transferredByUserId: null,
                    displayName,
                    harvestCode: harvestCode || null,
                    grams: grams > 0 ? grams : existing.grams,
                    bundles: bundles > 0 ? bundles : existing.bundles,
                    weightLbs: weightLbs > 0 ? weightLbs : existing.weightLbs,
                    storageType: storage.storageType,
                    storageLocationId: storage.storageLocationId,
                    storageLocationName: storage.storageLocationName,
                },
            });
        }

        return prisma.cultivationExtractionTransfer.create({
            data: {
                companyId: params.companyId,
                materialType,
                transferStatus: CultivationTransferStatus.STORED,
                sourceCultivationBatchId,
                displayName,
                harvestCode: harvestCode || null,
                metrcTag: metrcTag || null,
                parentGroupId,
                grams: grams > 0 ? grams : null,
                bundles: bundles > 0 ? bundles : null,
                weightLbs: weightLbs > 0 ? weightLbs : null,
                materialPayload: payload,
                storageType: storage.storageType,
                storageLocationId: storage.storageLocationId,
                storageLocationName: storage.storageLocationName,
                extractionSourceBatchId: null,
                transferredAt: null,
                transferredByUserId: null,
            },
        });
    }

    private async resolveOrRestoreTransferForReturn(
        companyId: string,
        sourceBatchId: string,
        storeRow: Record<string, unknown> | null,
    ) {
        const existing = await this.findTransferForReturn(companyId, sourceBatchId, storeRow);
        if (existing)
            return existing;

        const effectiveRow =
            storeRow ?? this.minimalStoreRowFromSourceBatchId(sourceBatchId);
        if (effectiveRow)
            return this.restoreStoredTransferFromStoreRow({
                companyId,
                sourceBatchId,
                storeRow: effectiveRow,
            });

        return null;
    }

    async returnToCultivationStorage(params: {
        companyId: string;
        actorUserId: string;
        sourceBatchId: string;
        storePackage?: Record<string, unknown> | null;
    }): Promise<CultivationTransferDto> {
        const sourceBatchId = String(params.sourceBatchId || "").trim();
        if (!sourceBatchId)
            throw new AppError("sourceBatchId is required", 400);

        const snap = await this.storeService.load(params.companyId);
        const snapRecord = snap as Record<string, unknown>;
        const extractionLists = [
            ...(Array.isArray(snap.extractionBatches) ? snap.extractionBatches : []),
            ...(Array.isArray(snapRecord.completedExtractionBatches)
                ? snapRecord.completedExtractionBatches
                : []),
        ];
        for (const raw of extractionLists) {
            const batch = raw && typeof raw === "object" ? (raw as { id?: string; sources?: unknown }) : null;
            if (!batch)
                continue;
            const sources = Array.isArray(batch.sources) ? batch.sources : [];
            const hit = sources.some(
                (s) => String((s as { sourceId?: string })?.sourceId || "").trim() === sourceBatchId,
            );
            if (hit) {
                throw new AppError(
                    `This package is on extraction batch ${String(batch.id || "").trim()}. Remove it from that batch before sending back to cultivation.`,
                    409,
                );
            }
        }

        const storeRow = this.resolveStoreRowForReturn(
            snap,
            sourceBatchId,
            params.storePackage,
        );
        const transfer = await this.resolveOrRestoreTransferForReturn(
            params.companyId,
            sourceBatchId,
            storeRow,
        );
        if (!transfer)
            throw new AppError(
                `Could not restore Ready to Transfer for ${sourceBatchId}. Open Cultivation, find the harvest lot, and confirm Fresh Frozen bundles exist.`,
                404,
            );

        const alreadyInStorage =
            transfer.transferStatus === CultivationTransferStatus.STORED
            || transfer.transferStatus === CultivationTransferStatus.READY_TO_TRANSFER;

        const updatedRow = alreadyInStorage
            ? transfer
            : await prisma.cultivationExtractionTransfer.update({
                where: { id: transfer.id },
                data: {
                    transferStatus: CultivationTransferStatus.STORED,
                    extractionSourceBatchId: null,
                    transferredAt: null,
                    transferredByUserId: null,
                },
            });

        const sourceBatches = Array.isArray(snap.sourceBatches) ? snap.sourceBatches : [];
        const completedSourceBatches = Array.isArray(snap.completedSourceBatches)
            ? snap.completedSourceBatches
            : [];
        const productionBatches = Array.isArray(snap.productionBatches) ? snap.productionBatches : [];

        await this.storeService.save(params.companyId, params.actorUserId, {
            ...snap,
            sourceBatches: sourceBatches.filter(
                (b) => String((b as { id?: string })?.id || "").trim() !== sourceBatchId,
            ),
            completedSourceBatches: completedSourceBatches.filter(
                (b) => String((b as { id?: string })?.id || "").trim() !== sourceBatchId,
            ),
            productionBatches: productionBatches.filter(
                (b) => String((b as { id?: string })?.id || "").trim() !== sourceBatchId,
            ),
        });

        return toDto(updatedRow);
    }

    /** Return many packages from Extraction back to Cultivation Ready to Transfer. */
    async returnManyToCultivationStorage(params: {
        companyId: string;
        actorUserId: string;
        sourceBatchIds?: string[];
        packages?: Array<{ sourceBatchId: string; storePackage?: Record<string, unknown> }>;
    }): Promise<{
        rows: CultivationTransferDto[];
        returnedIds: string[];
        failed: Array<{ sourceBatchId: string; message: string }>;
    }> {
        const work: Array<{ sourceBatchId: string; storePackage?: Record<string, unknown> }> = [];
        const seen = new Set<string>();
        for (const pkg of params.packages || []) {
            const sourceBatchId = String(pkg.sourceBatchId || "").trim();
            if (!sourceBatchId || seen.has(sourceBatchId))
                continue;
            seen.add(sourceBatchId);
            work.push({
                sourceBatchId,
                storePackage: pkg.storePackage,
            });
        }
        for (const id of params.sourceBatchIds || []) {
            const sourceBatchId = String(id || "").trim();
            if (!sourceBatchId || seen.has(sourceBatchId))
                continue;
            seen.add(sourceBatchId);
            work.push({ sourceBatchId });
        }

        const rows: CultivationTransferDto[] = [];
        const returnedIds: string[] = [];
        const failed: Array<{ sourceBatchId: string; message: string }> = [];

        for (const item of work) {
            const sourceBatchId = item.sourceBatchId;
            try {
                const row = await this.returnToCultivationStorage({
                    companyId: params.companyId,
                    actorUserId: params.actorUserId,
                    sourceBatchId,
                    storePackage: item.storePackage,
                });
                rows.push(row);
                returnedIds.push(sourceBatchId);
            }
            catch (error) {
                const message =
                    error instanceof AppError
                        ? error.message
                        : error instanceof Error
                          ? error.message
                          : "Return failed";
                failed.push({ sourceBatchId, message });
            }
        }

        return { rows, returnedIds, failed };
    }
}
