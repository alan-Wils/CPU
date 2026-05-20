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
    const result = await metrcPullService.pull({
      companyId,
      actorUserId: req.auth.userId,
      resource: "facilities",
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/strains",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcPullService.pull({
      companyId,
      actorUserId: req.auth.userId,
      resource: "strains",
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
  "/rooms",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcPullService.pull({
      companyId,
      actorUserId: req.auth.userId,
      resource: "rooms",
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);

metrcRouter.get(
  "/packages",
  requireRole([...metrcAdminRoles]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const result = await metrcPullService.pull({
      companyId,
      actorUserId: req.auth.userId,
      resource: "packages",
    });
    res.status(httpStatusForMetrcAction(result)).json(result);
  }),
);
