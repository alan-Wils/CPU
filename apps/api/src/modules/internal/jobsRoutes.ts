import { Router } from "express";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  runCashLogEodJob,
  type CashLogEodJobResult,
} from "../../services/cashLogEodJobService.js";
import { runCultivationClimateAlertsJob } from "../../services/cultivationClimateAlertsJobService.js";

export const internalJobsRouter = Router();

type CashLogEodCronSummary = "idle" | "skipped" | "sent" | "partial" | "error";

/** HTTP JSON for cron/monitoring tools (Railway Cron, uptime checks). */
export function buildCashLogEodCronResponse(result: CashLogEodJobResult): {
  ok: boolean;
  summary: CashLogEodCronSummary;
  message: string;
  job: CashLogEodJobResult;
} {
  let summary: CashLogEodCronSummary;
  if (result.examined === 0) summary = "idle";
  else if (result.errors.length && result.sent === 0) summary = "error";
  else if (result.errors.length && result.sent > 0) summary = "partial";
  else if (result.sent > 0) summary = "sent";
  else summary = "skipped";

  const ok = result.errors.length === 0;
  let message: string;
  if (summary === "idle") {
    message =
      "No memberships have cash log digest preferences; nothing to evaluate.";
  } else if (summary === "error") {
    message = `Digest job finished with send failures: ${result.errors.join("; ")}`;
  } else if (summary === "partial") {
    message = `Sent ${result.sent} digest email(s); ${result.errors.length} membership(s) failed to send.`;
  } else if (summary === "sent") {
    message = `Sent ${result.sent} digest email(s).`;
  } else {
    message =
      "No digest emails sent this tick (all memberships skipped—see job.skipReasons and job.memberships).";
  }

  return { ok, summary, message, job: result };
}

/**
 * Cash log EOD digest — same rules as the in-process scheduler; both default **strict_slack** (narrow send window,
 * one success per local day per schedule revision). Set `CASH_LOG_EOD_SEND_WINDOW_MODE=eod_local_day` for legacy all-day behavior.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (must match `CRON_SECRET` on the API service).
 *
 * @see apps/api/docs/RAILWAY_CRON_CASH_LOG_EOD.md
 */
internalJobsRouter.post(
  "/cash-log-eod",
  asyncHandler(async (_req, res) => {
    const secret = env.CRON_SECRET?.trim();
    if (!secret) {
      res.status(503).json({
        ok: false,
        summary: "error" as const,
        message:
          "CRON_SECRET is not set on the API service; cron-triggered digest is disabled.",
      });
      return;
    }
    const authz = String(_req.headers.authorization || "").trim();
    const bearer = authz.toLowerCase().startsWith("bearer ")
      ? authz.slice(7).trim()
      : "";
    if (bearer !== secret) {
      res.status(401).json({
        ok: false,
        summary: "error" as const,
        message:
          "Missing or invalid Authorization header; expected Bearer CRON_SECRET.",
      });
      return;
    }

    const result = await runCashLogEodJob({ trigger: "cron" });
    const body = buildCashLogEodCronResponse(result);
    res.status(200).json(body);
  }),
);

/**
 * Cultivation climate (Autogrow temp/RH) threshold alerts → peer notification inboxes.
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 */
internalJobsRouter.post(
  "/cultivation-climate-alerts",
  asyncHandler(async (_req, res) => {
    const secret = env.CRON_SECRET?.trim();
    if (!secret) {
      res.status(503).json({
        ok: false,
        message: "CRON_SECRET is not set; cultivation climate alert job is disabled.",
      });
      return;
    }
    const authz = String(_req.headers.authorization || "").trim();
    const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (bearer !== secret) {
      res.status(401).json({
        ok: false,
        message: "Missing or invalid Authorization header; expected Bearer CRON_SECRET.",
      });
      return;
    }

    const job = await runCultivationClimateAlertsJob();
    res.status(200).json({
      ok: job.errors.length === 0,
      ...job,
    });
  }),
);
