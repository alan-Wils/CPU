import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { MetrcConnectionService } from "../../services/metrcConnectionService.js";
import { MetrcAvailablePlantTagsService } from "../../services/metrcAvailablePlantTagsService.js";
import { MetrcSandboxService } from "../../services/metrcSandboxService.js";
import { MetrcPullService } from "../../services/metrcPullService.js";
import { MetrcFacilitiesSyncService } from "../../services/metrcFacilitiesSyncService.js";
import { MetrcLocationsSyncService } from "../../services/metrcLocationsSyncService.js";
import { MetrcLocationMappingService } from "../../services/metrcLocationMappingService.js";
import { MetrcStrainsSyncService } from "../../services/metrcStrainsSyncService.js";
import { MetrcPackagesSyncService } from "../../services/metrcPackagesSyncService.js";
import { MetrcPlantBatchesSyncService } from "../../services/metrcPlantBatchesSyncService.js";
import { MetrcPlantBatchCreateService } from "../../services/metrcPlantBatchCreateService.js";
import { MetrcHarvestsSyncService } from "../../services/metrcHarvestsSyncService.js";
import {
  METRC_DEFAULT_TEST_HARVEST_NAME,
  METRC_HARVEST_TYPES,
  MetrcHarvestCreateService,
} from "../../services/metrcHarvestCreateService.js";
import { MetrcStrainCreateService } from "../../services/metrcStrainCreateService.js";
import { MetrcDebugAuthService } from "../../services/metrcDebugAuthService.js";
import { env } from "../../config/env.js";
import { logInfo } from "../../lib/logger.js";
import { nexbatchRoomTypeLabel } from "../../lib/metrcNexbatchRooms.js";

const cultivationMetrcReadRoles = [
  "OWNER",
  "ADMIN",
  "OPERATIONS_MANAGER",
  "CULTIVATION_SPECIALIST",
];

const metrcAdminRoles = ["OWNER", "ADMIN", "OPERATIONS_MANAGER"] as const;

const availablePlantTagsQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const metrcRouter = Router();
const metrcConnectionService = new MetrcConnectionService();
const metrcAvailablePlantTagsService = new MetrcAvailablePlantTagsService();
const metrcSandboxService = new MetrcSandboxService();
const metrcPullService = new MetrcPullService();
const metrcFacilitiesSyncService = new MetrcFacilitiesSyncService();
const metrcLocationsSyncService = new MetrcLocationsSyncService();
const metrcLocationMappingService = new MetrcLocationMappingService();
const metrcStrainsSyncService = new MetrcStrainsSyncService();
const metrcPackagesSyncService = new MetrcPackagesSyncService();
const metrcPlantBatchesSyncService = new MetrcPlantBatchesSyncService();
const metrcPlantBatchCreateService = new MetrcPlantBatchCreateService();
const metrcHarvestsSyncService = new MetrcHarvestsSyncService();
const metrcHarvestCreateService = new MetrcHarvestCreateService();
const metrcStrainCreateService = new MetrcStrainCreateService();

const metrcLocationMappingBody = z.object({
  metrcLocationId: z.string().min(1),
  nexbatchRoomSuite: z.enum(["vegRooms", "flowerRooms", "dryRooms", "freezers"]).nullable(),
  nexbatchRoomId: z.string().nullable(),
});

const metrcCreateTestStrainBody = z.object({
  name: z.string().min(1),
  testingStatus: z.string().optional().nullable(),
  indicaPercentage: z.coerce.number().min(0).max(100).optional(),
  sativaPercentage: z.coerce.number().min(0).max(100).optional(),
});

const metrcCreateTestPlantBatchBody = z.object({
  name: z.string().min(1),
  strain: z.string().min(1),
  count: z.coerce.number().int().positive(),
  plantingDate: z.string().min(1),
  batchType: z.enum(["Clone", "Seed"]).optional(),
  metrcLocationId: z.string().optional().nullable(),
  nexbatchRoomSuite: z.enum(["vegRooms", "flowerRooms", "dryRooms", "freezers"]).optional().nullable(),
  nexbatchRoomId: z.string().optional().nullable(),
});

const metrcCreateTestHarvestBody = z.object({
  metrcPlantBatchId: z.string().min(1),
  harvestName: z.string().min(1).optional(),
  harvestType: z.enum(METRC_HARVEST_TYPES).optional(),
  wetWeight: z.coerce.number().positive().optional(),
  unitOfWeight: z.string().optional(),
  actualDate: z.string().optional(),
  plantCount: z.coerce.number().int().positive().optional(),
  notes: z.string().optional().nullable(),
});
const metrcDebugAuthService = new MetrcDebugAuthService();

function httpStatusForMetrcAction(result: { ok: boolean; status?: number }): number {
  if (result.ok) return 200;
  const s = result.status;
  if (typeof s === "number" && s >= 400 && s < 600) return s;
  return 502;
}

function httpStatusForSandboxSetup(result: {
  ok: boolean;
  status?: string;
  httpStatus?: number;
}): number {
  if (!result.ok) {
    const s = result.httpStatus;
    if (typeof s === "number" && s >= 400 && s < 600) return s;
    return 502;
  }
  if (result.status === "provisioning") return 202;
  return 200;
}

/** Developer-only: probe sandbox operational auth modes against locations endpoint. */
metrcRouter.get(
  "/debug-auth",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    if (env.NODE_ENV === "production") {
      res.status(404).json({ ok: false, message: "Not found." });
      return;
    }
    const companyId = getScopedCompanyId(req);
    const result = await metrcDebugAuthService.runDebugAuth({ companyId });
    res.status(result.ok ? 200 : 400).json(result);
  }),
);

/** Safe read-only probe: GET METRC active locations (no writes). */
metrcRouter.get(
  "/test-connection",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcConnectionService.runTestConnection({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(200).json(result);
  }),
);

/** Provision sandbox facility credentials via METRC integrator setup (CO-style sandbox host). */
metrcRouter.post(
  "/sandbox/setup",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcSandboxService.runSandboxSetup({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(httpStatusForSandboxSetup(result)).json(result);
  }),
);

/** Poll async sandbox provisioning; discovers credentials when METRC finishes user creation. */
metrcRouter.get(
  "/sandbox/status",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcSandboxService.pollSandboxStatus({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(200).json(result);
  }),
);

/** Safe read-only: GET METRC available plant tags (premium endpoint on METRC side in many states). */
metrcRouter.get(
  "/available-plant-tags",
  requireRole(cultivationMetrcReadRoles),
  validate({ query: availablePlantTagsQuery }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const q = req.query as { limit?: number };
    const lim = typeof q.limit === "number" && Number.isFinite(q.limit) ? q.limit : 120;
    const result = await metrcAvailablePlantTagsService.fetchLabels({
      companyId,
      limit: lim,
    });
    res.status(200).json(result);
  }),
);

metrcRouter.get(
  "/facilities",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcFacilitiesSyncService.syncMetrcFacilities({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/strains/persisted",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const strains = await metrcStrainsSyncService.listSyncedStrains(companyId);
    res.status(200).json({ ok: true, strains });
  }),
);

metrcRouter.get(
  "/strains",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcStrainsSyncService.syncMetrcStrains({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/strains/request-logs",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const { listMetrcStrainRequestLogs } = await import(
      "../../repositories/metrcStrainRepository.js"
    );
    const logs = await listMetrcStrainRequestLogs(companyId, 50);
    res.status(200).json({ ok: true, logs });
  }),
);

metrcRouter.post(
  "/strains/create-test",
  requireRole([...metrcAdminRoles]),
  validate({ body: metrcCreateTestStrainBody }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body as z.infer<typeof metrcCreateTestStrainBody>;
    const result = await metrcStrainCreateService.createTestStrain({
      companyId,
      actorUserId: req.auth.userId,
      name: body.name,
      testingStatus: body.testingStatus ?? null,
      indicaPercentage: body.indicaPercentage ?? null,
      sativaPercentage: body.sativaPercentage ?? null,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/items",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcPullService.pull({
      companyId,
      actorUserId: req.auth.userId,
      resource: "items",
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/locations/nexbatch-rooms",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const rooms = await metrcLocationsSyncService.loadNexbatchRoomOptions(companyId);
    logInfo("[METRC] nexbatch_rooms_loaded", {
      companyId,
      total: rooms.length,
      rooms: rooms.map((r) => ({
        roomId: r.roomId,
        name: r.name,
        suite: r.suite,
        type: nexbatchRoomTypeLabel(r.suite),
      })),
    });
    res.status(200).json({ ok: true, rooms, total: rooms.length });
  }),
);

metrcRouter.get(
  "/locations",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const locations = await metrcLocationsSyncService.listSyncedLocations(companyId);
    res.status(200).json({ ok: true, locations });
  }),
);

metrcRouter.get(
  "/locations/mappings",
  requireRole(cultivationMetrcReadRoles),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const mappings = await metrcLocationMappingService.listLocationRoomMappings(companyId);
    res.status(200).json({ ok: true, mappings });
  }),
);

metrcRouter.patch(
  "/locations/mapping",
  requireRole([...metrcAdminRoles]),
  validate({ body: metrcLocationMappingBody }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body as z.infer<typeof metrcLocationMappingBody>;
    const result = await metrcLocationsSyncService.updateLocationMapping({
      companyId,
      actorUserId: req.auth.userId,
      metrcLocationId: body.metrcLocationId,
      nexbatchRoomSuite: body.nexbatchRoomSuite,
      nexbatchRoomId: body.nexbatchRoomId,
    });
    if (result.ok === false) {
      res.status(result.status).json(result);
      return;
    }
    res.status(200).json(result);
  }),
);

metrcRouter.get(
  "/rooms",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcLocationsSyncService.syncMetrcLocations({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/packages/persisted",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const packages = await metrcPackagesSyncService.listSyncedPackages(companyId);
    res.status(200).json({ ok: true, packages });
  }),
);

metrcRouter.get(
  "/packages/reconciliation",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcPackagesSyncService.buildInventoryReconciliation(companyId);
    res.status(200).json({ ok: true, ...result });
  }),
);

metrcRouter.get(
  "/packages",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcPackagesSyncService.syncMetrcPackages({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/plant-batches/persisted",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const plantBatches = await metrcPlantBatchesSyncService.listSyncedPlantBatches(companyId);
    res.status(200).json({ ok: true, plantBatches });
  }),
);

metrcRouter.get(
  "/plant-batches/request-logs",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const { listMetrcPlantBatchRequestLogs } = await import(
      "../../repositories/metrcPlantBatchRepository.js"
    );
    const logs = await listMetrcPlantBatchRequestLogs(companyId, 50);
    res.status(200).json({ ok: true, logs });
  }),
);

metrcRouter.get(
  "/plant-batches",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcPlantBatchesSyncService.syncMetrcPlantBatches({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.post(
  "/plant-batches/create-test",
  requireRole([...metrcAdminRoles]),
  validate({ body: metrcCreateTestPlantBatchBody }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body as z.infer<typeof metrcCreateTestPlantBatchBody>;
    const result = await metrcPlantBatchCreateService.createTestPlantBatch({
      companyId,
      actorUserId: req.auth.userId,
      name: body.name,
      strain: body.strain,
      count: body.count,
      plantingDate: body.plantingDate,
      batchType: body.batchType,
      metrcLocationId: body.metrcLocationId ?? null,
      nexbatchRoomSuite: body.nexbatchRoomSuite ?? null,
      nexbatchRoomId: body.nexbatchRoomId ?? null,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/harvests/persisted",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const harvests = await metrcHarvestsSyncService.listSyncedHarvests(companyId);
    res.status(200).json({ ok: true, harvests });
  }),
);

metrcRouter.get(
  "/harvests/request-logs",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const { listMetrcHarvestRequestLogs } = await import(
      "../../repositories/metrcHarvestRepository.js"
    );
    const logs = await listMetrcHarvestRequestLogs(companyId, 50);
    res.status(200).json({ ok: true, logs });
  }),
);

metrcRouter.get(
  "/harvests",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcHarvestsSyncService.syncMetrcHarvests({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.post(
  "/harvests/create-test",
  requireRole([...metrcAdminRoles]),
  validate({ body: metrcCreateTestHarvestBody }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body as z.infer<typeof metrcCreateTestHarvestBody>;
    const result = await metrcHarvestCreateService.createTestHarvest({
      companyId,
      actorUserId: req.auth.userId,
      metrcPlantBatchId: body.metrcPlantBatchId,
      harvestName: body.harvestName?.trim() || METRC_DEFAULT_TEST_HARVEST_NAME,
      harvestType: body.harvestType ?? null,
      wetWeight: body.wetWeight ?? null,
      unitOfWeight: body.unitOfWeight ?? null,
      actualDate: body.actualDate ?? null,
      plantCount: body.plantCount ?? null,
      notes: body.notes ?? null,
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);
