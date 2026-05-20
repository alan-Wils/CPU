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

    async updateStorage(params: {
        companyId: string;
        id: string;
        storageLocationId: string;
        storageLocationName?: string;
    }): Promise<CultivationTransferDto> {
        const existing = await prisma.cultivationExtractionTransfer.findFirst({
            where: { id: params.id, companyId: params.companyId },
        });
        if (!existing)
            throw new AppError("Transfer record not found", 404);
        if (existing.transferStatus === CultivationTransferStatus.TRANSFERRED_TO_EXTRACTION)
            throw new AppError("Cannot change storage after transfer to extraction", 400);

        const config = await this.loadStorageConfig(params.companyId);
        const storage = this.resolveStorageLocation(
            config,
            existing.materialType,
            params.storageLocationId,
            params.storageLocationName,
        );

        const row = await prisma.cultivationExtractionTransfer.update({
            where: { id: existing.id },
            data: {
                storageType: storage.storageType,
                storageLocationId: storage.storageLocationId,
                storageLocationName: storage.storageLocationName,
                transferStatus: CultivationTransferStatus.STORED,
            },
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
        const base: Record<string, unknown> = {
            id: sourceBatchId,
            name: transfer.displayName,
            type,
            source: transfer.sourceCultivationBatchId,
            status: "Available for Extraction",
            createdAt: new Date().toISOString(),
            cultivationTransferId: transfer.id,
            manualTransferToExtraction: true,
            storageType: transfer.storageType,
            storageLocationId: transfer.storageLocationId,
            storageLocationName: transfer.storageLocationName,
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
            base.amount = `${bundles} bundles / ${grams} grams`;
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
        return { ...payload, ...base };
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

        const sourceBatches: Record<string, unknown>[] = [];
        const updated: CultivationTransferDto[] = [];

        for (const row of rows) {
            const sourceBatchId =
                String(row.harvestCode || "").trim() ||
                `xfer-${row.id.slice(0, 8)}-${Date.now()}`;
            const legacyBatch = this.buildLegacySourceBatchFromTransfer(row, sourceBatchId);

            const snap = await this.storeService.load(params.companyId);
            const list = Array.isArray(snap.sourceBatches) ? [...snap.sourceBatches] : [];
            const existingIdx = list.findIndex(
                (b) => String((b as { id?: string })?.id || "") === sourceBatchId,
            );
            if (existingIdx >= 0)
                list[existingIdx] = legacyBatch;
            else
                list.unshift(legacyBatch);
            await this.storeService.save(params.companyId, params.actorUserId, { ...snap, sourceBatches: list });

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

        return { rows: updated, sourceBatches };
    }
}
