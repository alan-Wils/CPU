import { Router } from "express";
import type { Response } from "express";
import { getScopedCompanyId, type JwtAuthPayload } from "../../middleware/companyScope.js";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { checkUploadSchema, companyTenantLeafLinkSyncSchema, configUpsertSchema } from "../../validation/schemas.js";
import { ConfigService } from "../../services/configService.js";
import { CompanyServiceSettingsService } from "../../services/companyServiceSettingsService.js";
import { CompanyLogoUploadService } from "../../services/companyLogoUploadService.js";
import { LeafLinkService } from "../../services/leaflinkService.js";
import { requireRole } from "../../middleware/rbac.js";
import { AppError } from "../../errors/AppError.js";
import { requestPublicOrigin } from "../../lib/requestPublicOrigin.js";
import { prisma } from "../../config/prisma.js";
import { memoizedReadWithMeta } from "../../lib/requestMemoCache.js";
import { logSlowRequestIfNeeded } from "../../lib/slowRequestLog.js";
import {
    mergeConfigRowsToMap,
    scrubMergedConfigForHttp,
    logConfigTopLevelSizesDev,
    buildConfigChecksum,
    buildBasicConfigView,
    buildPermissionsView,
    buildCultivationConfigView,
    buildExtractionConfigView,
    buildPackagingConfigView,
    buildEdiblesConfigView,
    buildIntegrationsMetaView,
    mergeCompanyValuePreserveMaskedSecrets,
    buildRewardsPageConfigView,
    type MergedCompanyConfig,
} from "../../lib/configHttpPayload.js";

export const configRouter = Router();
const configService = new ConfigService();
const companyLogoUploadService = new CompanyLogoUploadService();
const companyServiceSettingsService = new CompanyServiceSettingsService();
const leafLinkService = new LeafLinkService();

function sendJson(res: Response, body: unknown, cacheControl: string): void {
    res.setHeader("Cache-Control", cacheControl);
    res.json(body);
}

async function readMergedConfig(companyId: string): Promise<MergedCompanyConfig> {
    const rows = await configService.list(companyId);
    return mergeConfigRowsToMap(rows.map((row) => ({ key: row.key, value: row.value })));
}

configRouter.patch(
    "/company-services",
    requireRole(["OWNER", "ADMIN"]),
    validate({ body: companyTenantLeafLinkSyncSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const body = req.body as { leafLinkInventorySyncEnabled: boolean };
        const services = await companyServiceSettingsService.updateLeafLinkInventorySyncForTenant(
            companyId,
            body.leafLinkInventorySyncEnabled,
        );
        res.json({ services });
    }),
);

/** Aggregate checksum for client-side ETag-style skips (excludes legacy JSON store snapshot row). */
configRouter.get("/version", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const meta = await configService.repo.getConfigRowMeta(companyId);
    const checksum = buildConfigChecksum(meta);
    const maxUpdated = meta.reduce<Date | null>((best, r) => {
        if (!best || r.updatedAt > best) return r.updatedAt;
        return best;
    }, null);
    sendJson(
        res,
        {
            companyId,
            checksum,
            updatedAt: maxUpdated?.toISOString() ?? null,
            keyCount: meta.length,
        },
        "private, max-age=5",
    );
}));

configRouter.get("/permissions", asyncHandler(async (req, res) => {
    const auth = req.auth as JwtAuthPayload;
    sendJson(res, buildPermissionsView(auth), "private, max-age=15");
}));

configRouter.get("/basic", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const cacheKey = `config:basic:${companyId}`;
    const dbStarted = Date.now();
    const { value: body, cacheHit, inflightJoined } = await memoizedReadWithMeta(cacheKey, 20_000, async () => {
        const merged = await readMergedConfig(companyId);
        const [co, svc] = await Promise.all([
            prisma.company.findUnique({
                where: { id: companyId },
                select: { id: true, name: true, slug: true },
            }),
            prisma.companyServiceSettings.findUnique({ where: { companyId } }),
        ]);
        if (!co) {
            throw new AppError("Company not found", 404);
        }
        const services = svc
            ? {
                productionEnabled: svc.productionEnabled,
                salesSellerEnabled: svc.salesSellerEnabled,
                salesBuyerEnabled: svc.salesBuyerEnabled,
                leafLinkInventorySyncEnabled: svc.leafLinkInventorySyncEnabled,
            }
            : null;
        const view = buildBasicConfigView(merged, co, services);
        logConfigTopLevelSizesDev(view as MergedCompanyConfig, "GET /api/config/basic");
        return view;
    });
    const dbMs = Date.now() - dbStarted;
    const serialized = JSON.stringify(body);
    logSlowRequestIfNeeded({
        label: "GET /api/config/basic",
        companyId,
        dbMs,
        payloadBytes: Buffer.byteLength(serialized, "utf8"),
        cacheHit,
        inflightJoined,
    });
    res.setHeader("Cache-Control", "private, max-age=15");
    res.type("json").send(serialized);
}));

configRouter.get("/cultivation", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = await readMergedConfig(companyId);
    const body = buildCultivationConfigView(merged);
    logConfigTopLevelSizesDev(body as MergedCompanyConfig, "GET /api/config/cultivation");
    sendJson(res, body, "private, max-age=15");
}));

configRouter.get("/extraction", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = await readMergedConfig(companyId);
    const body = buildExtractionConfigView(merged);
    logConfigTopLevelSizesDev(body as MergedCompanyConfig, "GET /api/config/extraction");
    sendJson(res, body, "private, max-age=15");
}));

configRouter.get("/packaging", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = await readMergedConfig(companyId);
    const body = buildPackagingConfigView(merged);
    logConfigTopLevelSizesDev(body as MergedCompanyConfig, "GET /api/config/packaging");
    sendJson(res, body, "private, max-age=15");
}));

configRouter.get("/edibles", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = await readMergedConfig(companyId);
    const body = buildEdiblesConfigView(merged);
    logConfigTopLevelSizesDev(body as MergedCompanyConfig, "GET /api/config/edibles");
    sendJson(res, body, "private, max-age=15");
}));

configRouter.get("/rewards", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = await readMergedConfig(companyId);
    const body = buildRewardsPageConfigView(merged);
    logConfigTopLevelSizesDev(body as MergedCompanyConfig, "GET /api/config/rewards");
    sendJson(res, body, "private, max-age=15");
}));

configRouter.get("/integrations", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = await readMergedConfig(companyId);
    const leaf = await leafLinkService.getSafeConfig(companyId);
    sendJson(
        res,
        {
            ...buildIntegrationsMetaView(merged),
            leafLinkIntegrationEnabled: leaf.integrationEnabled,
            hasLeafLinkApiKey: leaf.hasApiKey,
        },
        "private, no-store",
    );
}));

/**
 * Full tenant config for Admin → Company Config only (large). Omits `legacy_frontend_store` JSON snapshot row;
 * workflow UIs must use `GET /api/store` for that snapshot.
 */
configRouter.get("/full", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = scrubMergedConfigForHttp(await readMergedConfig(companyId));
    logConfigTopLevelSizesDev(merged, "GET /api/config/full");
    sendJson(res, merged, "private, no-store");
}));

/**
 * @deprecated Prefer `GET /api/config/full` (admin) or sliced routes (`/basic`, `/cultivation`, …) for SPA pages.
 * Same payload as `/full` — kept for backward compatibility during client migration.
 */
configRouter.get("/", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const merged = scrubMergedConfigForHttp(await readMergedConfig(companyId));
    logConfigTopLevelSizesDev(merged, "GET /api/config (legacy)");
    sendJson(res, merged, "private, no-store");
}));

configRouter.put("/", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]), validate({ body: z.record(z.string(), z.unknown()) }), asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const payload = req.body as Record<string, unknown>;
    const mergedBefore = await readMergedConfig(companyId);
    const responseShape: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        let toWrite = value;
        if (key === "company" && value && typeof value === "object" && !Array.isArray(value)) {
            toWrite = mergeCompanyValuePreserveMaskedSecrets(mergedBefore.company, value);
        }
        await configService.upsert({
            companyId,
            actorUserId: req.auth.userId,
            key,
            value: toWrite,
        });
        responseShape[key] = toWrite;
    }
    /** Echo persisted keys with secrets scrubbed (same rules as GET /full). */
    sendJson(res, scrubMergedConfigForHttp(responseShape as MergedCompanyConfig), "private, no-store");
}));
configRouter.post("/", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]), validate({ body: configUpsertSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const row = await configService.upsert({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        key: payload.key,
        value: payload.value
    });
    res.status(201).json(row);
}));

configRouter.post(
    "/upload-company-logo",
    requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]),
    validate({ body: checkUploadSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId) {
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        }
        const origin = requestPublicOrigin(req);
        const uploaded = await companyLogoUploadService.uploadLogo({
            companyId,
            mimeType: req.body.mimeType,
            dataBase64: req.body.dataBase64,
            origin,
        });
        res.status(201).json(uploaded);
    }),
);
