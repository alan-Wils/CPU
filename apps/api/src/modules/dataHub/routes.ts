import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { DataHubService } from "../../services/dataHubService.js";

export const dataHubRouter = Router();
const service = new DataHubService();

dataHubRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await service.getSnapshot(req.auth!.companyId);
    res.json(data);
  })
);
