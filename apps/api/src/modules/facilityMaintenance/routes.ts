import { Router } from "express";
import { z } from "zod";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { FacilityMaintenanceService } from "./facilityMaintenanceService.js";
import { userMayAccessFacilitiesMaintenance } from "./facilityMaintenanceAccess.js";

const service = new FacilityMaintenanceService();

export function requireFacilityMaintenanceAccess(req: any, res: any, next: any) {
  const role = String(req.auth?.role || "").trim().toUpperCase();
  const perms = (req.auth as { permissions?: string[] } | undefined)?.permissions;
  if (userMayAccessFacilitiesMaintenance(role, perms)) {
    next();
    return;
  }
  res.status(403).json({ message: "Forbidden" });
}

const workOrderCreateSchema = z.object({
  title: z.string().min(1).max(500),
  location: z.string().min(1).max(200),
  category: z.string().min(1).max(120),
  priority: z.string().min(1).max(40),
  status: z.string().min(1).max(40),
  assignedTo: z.string().min(1).max(200),
  dueDate: z.string().min(1).max(40),
  description: z.string().max(4000).optional(),
});

const workOrderPatchSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    location: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(120).optional(),
    priority: z.string().min(1).max(40).optional(),
    status: z.string().min(1).max(40).optional(),
    assignedTo: z.string().min(1).max(200).optional(),
    dueDate: z.string().min(1).max(40).optional(),
    description: z.union([z.string().max(4000), z.null()]).optional(),
    dueMeta: z.union([z.string().max(200), z.null()]).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Provide at least one field" });

const pmTaskCreateSchema = z.object({
  taskName: z.string().min(1).max(300),
  assetSystem: z.string().min(1).max(300),
  frequency: z.string().min(1).max(120),
  assignedTo: z.string().min(1).max(200),
  nextDueDate: z.string().min(1).max(40),
  notes: z.string().max(4000).optional(),
});

const assetCreateSchema = z.object({
  assetName: z.string().min(1).max(300),
  category: z.string().min(1).max(120),
  location: z.string().min(1).max(200),
  serialNumber: z.string().min(1).max(200),
  installDate: z.string().min(1).max(40),
  status: z.string().min(1).max(80),
});

const partRequestCreateSchema = z.object({
  partName: z.string().min(1).max(300),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  neededFor: z.string().min(1).max(300),
  priority: z.string().min(1).max(40),
  notes: z.string().max(4000).optional(),
});

const locationCreateSchema = z.object({
  locationName: z.string().min(1).max(300),
  locationType: z.string().min(1).max(120),
  parentArea: z.string().min(1).max(300),
  sqFt: z.coerce.number().int().min(0).max(10_000_000).optional().nullable(),
  notes: z.string().max(4000).optional(),
});

const workOrderIdParam = z.object({
  workOrderId: z.string().min(1).max(40),
});

export const facilityMaintenanceRouter = Router();

facilityMaintenanceRouter.get(
  "/dashboard",
  requireFacilityMaintenanceAccess,
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const data = await service.getDashboard(companyId);
    res.json(data);
  }),
);

facilityMaintenanceRouter.post(
  "/work-orders",
  requireFacilityMaintenanceAccess,
  validate({ body: workOrderCreateSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const row = await service.createWorkOrder(companyId, String(req.auth?.role || ""), req.body);
    res.status(201).json(row);
  }),
);

facilityMaintenanceRouter.patch(
  "/work-orders/:workOrderId",
  requireFacilityMaintenanceAccess,
  validate({ params: workOrderIdParam, body: workOrderPatchSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const row = await service.patchWorkOrder(
      companyId,
      String(req.auth?.role || ""),
      req.params.workOrderId,
      req.body,
    );
    res.json(row);
  }),
);

facilityMaintenanceRouter.delete(
  "/work-orders/:workOrderId",
  requireFacilityMaintenanceAccess,
  validate({ params: workOrderIdParam }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    await service.deleteWorkOrder(companyId, String(req.auth?.role || ""), req.params.workOrderId);
    res.json({ ok: true });
  }),
);

facilityMaintenanceRouter.post(
  "/pm-tasks",
  requireFacilityMaintenanceAccess,
  validate({ body: pmTaskCreateSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const row = await service.createPmTask(companyId, String(req.auth?.role || ""), req.body);
    res.status(201).json(row);
  }),
);

facilityMaintenanceRouter.post(
  "/assets",
  requireFacilityMaintenanceAccess,
  validate({ body: assetCreateSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const row = await service.createAsset(companyId, String(req.auth?.role || ""), req.body);
    res.status(201).json(row);
  }),
);

facilityMaintenanceRouter.post(
  "/part-requests",
  requireFacilityMaintenanceAccess,
  validate({ body: partRequestCreateSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const row = await service.createPartRequest(companyId, String(req.auth?.role || ""), req.body);
    res.status(201).json(row);
  }),
);

facilityMaintenanceRouter.post(
  "/locations",
  requireFacilityMaintenanceAccess,
  validate({ body: locationCreateSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const row = await service.createLocation(companyId, String(req.auth?.role || ""), req.body);
    res.status(201).json(row);
  }),
);
