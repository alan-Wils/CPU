import { Router } from "express";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { runCashLogEodJob } from "../../services/cashLogEodJobService.js";

export const internalJobsRouter = Router();

/**
 * Scheduled digest emails for financial (cash) logs.
 * Configure Railway Cron (or similar) to POST here every 15–30 minutes with header
 * `Authorization: Bearer $CRON_SECRET`.
 */
internalJobsRouter.post(
  "/cash-log-eod",
  asyncHandler(async (_req, res) => {
    const secret = env.CRON_SECRET?.trim();
    if (!secret) {
      res.status(503).json({
        message:
          "CRON_SECRET is not set on the API; scheduled cash-log digest emails are disabled.",
      });
      return;
    }
    const authz = String(_req.headers.authorization || "").trim();
    const bearer = authz.toLowerCase().startsWith("bearer ")
      ? authz.slice(7).trim()
      : "";
    if (bearer !== secret) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const out = await runCashLogEodJob();
    res.json(out);
  }),
);
