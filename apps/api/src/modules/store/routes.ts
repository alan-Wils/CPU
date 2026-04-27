import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { z } from "zod";
import { StoreService } from "../../services/storeService.js";

const storePayloadSchema = z.object({
  cultivationBatches: z.array(z.unknown()).default([]),
  completedCultivationBatches: z.array(z.unknown()).default([]),
  dryFlowerBatches: z.array(z.unknown()).default([]),
  productionBatches: z.array(z.unknown()).default([]),
  sourceBatches: z.array(z.unknown()).default([]),
  extractionBatches: z.array(z.unknown()).default([]),
  packagingBatches: z.array(z.unknown()).default([]),
  logs: z.array(z.unknown()).default([])
});

export const storeRouter = Router();
const service = new StoreService();

storeRouter.get(
  "/version",
  asyncHandler(async (req, res) => {
    const version = await service.getVersion(req.auth!.companyId);
    res.json(version);
  })
);

storeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await service.load(req.auth!.companyId);
    res.json(data);
  })
);

storeRouter.put(
  "/",
  validate({ body: storePayloadSchema }),
  asyncHandler(async (req, res) => {
    const data = await service.save(req.auth!.companyId, req.auth!.userId, req.body);
    res.json(data);
  })
);
