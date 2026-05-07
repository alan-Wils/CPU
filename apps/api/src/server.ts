/* Prefer IPv4 first when resolving SMTP hosts (Railway/cloud often hang on broken IPv6 to Gmail). */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { env } from "./config/env.js";
import { createCorsOriginResolver, describeCorsAllowlist } from "./config/cors.js";
import { resolvePublicWebBaseUrl } from "./config/publicWebUrl.js";
import { appRouter } from "./router.js";
import { errorMiddleware } from "./middleware/error.js";
import { prisma } from "./config/prisma.js";
import { logInfo, logError, logWarn } from "./lib/logger.js";
import { registerUploadStreamRoutes, uploadsUseS3 } from "./lib/uploadStorage.js";
import { runCashLogEodJob } from "./services/cashLogEodJobService.js";
const app = express();
/** Allow the web app (other origin) to `fetch()` uploads such as company logos for print preview. */
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
);
const corsOrigins = [env.CORS_ORIGIN, env.APP_URL ?? ""]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(",");
app.use(cors({
    origin: createCorsOriginResolver(corsOrigins),
    allowedHeaders: ["Content-Type", "Authorization", "X-Company-Id"],
}));
app.use(express.json({ limit: "15mb" }));
registerUploadStreamRoutes(app);
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
/** Liveness: process is up; does not hit the database. */
app.get("/health/live", (_req, res) => {
    res.json({ status: "ok", service: "cpu-api", check: "live" });
});
const healthReady = async (_req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({ status: "ok", service: "cpu-api", check: "ready" });
    }
    catch (error) {
        logError("health_ready_failure", { error });
        res.status(503).json({ status: "unavailable", service: "cpu-api", check: "ready" });
    }
};
/** Readiness: database reachable (Postgres in staging/prod, SQLite in local dev). */
app.get("/health/ready", healthReady);
/** Readiness (alias) — many platforms probe `/health` for DB-backed readiness. */
app.get("/health", healthReady);
/**
 * Emails occasionally link to this API hostname by mistake (APP_URL=CORS=RAILway).
 * Browsers GET /accept-invite here → forward to the real web app origin.
 */
app.get("/accept-nexbatch-invite", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token.trim()) {
        res.status(400)
            .type("text/plain")
            .send("Missing invite token. Use the link from your invitation.");
        return;
    }
    const base = resolvePublicWebBaseUrl().replace(/\/+$/, "");
    let redirectHref: string;
    try {
        const dest = new URL(`${base}/accept-nexbatch-invite`);
        dest.searchParams.set("token", token);
        redirectHref = dest.href;
    }
    catch {
        res.status(500).type("text/plain").send("Invalid APP_URL; cannot redirect to the invite page.");
        return;
    }
    const reqHost = (req.hostname || "").toLowerCase();
    let destHost: string;
    try {
        destHost = new URL(redirectHref).hostname.toLowerCase();
    }
    catch {
        res.status(500).type("text/plain").send("Invalid redirect URL derived from APP_URL.");
        return;
    }
    if (reqHost && destHost === reqHost) {
        res.status(503)
            .type("text/plain")
            .send("APP_URL/CORS resolves to this API host, so invites cannot reach the frontend. Set APP_URL on Railway to your deployed web app (e.g. https://your-project.vercel.app), redeploy, then open a new invite or replace the hostname in this URL with that frontend origin.");
        return;
    }
    logInfo("nexbatch_invite_browser_redirect_to_web", { destinationHost: destHost });
    res.redirect(302, redirectHref);
});
app.get("/accept-invite", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token.trim()) {
        res.status(400)
            .type("text/plain")
            .send("Missing invite token. Use the link from your invitation.");
        return;
    }
    const base = resolvePublicWebBaseUrl().replace(/\/+$/, "");
    let redirectHref: string;
    try {
        const dest = new URL(`${base}/accept-invite`);
        dest.searchParams.set("token", token);
        redirectHref = dest.href;
    }
    catch {
        res.status(500).type("text/plain").send("Invalid APP_URL; cannot redirect to the invite page.");
        return;
    }
    const reqHost = (req.hostname || "").toLowerCase();
    let destHost: string;
    try {
        destHost = new URL(redirectHref).hostname.toLowerCase();
    }
    catch {
        res.status(500).type("text/plain").send("Invalid redirect URL derived from APP_URL.");
        return;
    }
    if (reqHost && destHost === reqHost) {
        res.status(503)
            .type("text/plain")
            .send("APP_URL/CORS resolves to this API host, so invites cannot reach the frontend. Set APP_URL on Railway to your deployed web app (e.g. https://your-project.vercel.app), redeploy, then open a new invite or replace the hostname in this URL with that frontend origin.");
        return;
    }
    logInfo("invite_browser_redirect_to_web", { destinationHost: destHost });
    res.redirect(302, redirectHref);
});
app.use("/api", appRouter);
app.use(errorMiddleware);

let cashLogEodSchedulerRunning = false;
function startInternalCashLogEodSchedulerIfEnabled() {
    if (!env.CASH_LOG_EOD_INTERNAL_SCHEDULER)
        return;
    const everyMs = env.CASH_LOG_EOD_INTERNAL_EVERY_MINUTES * 60 * 1000;
    const runOnce = async () => {
        if (cashLogEodSchedulerRunning)
            return;
        cashLogEodSchedulerRunning = true;
        try {
            await runCashLogEodJob({ trigger: "internal_scheduler" });
        }
        catch (error) {
            logWarn("cash_log_eod_internal_tick_failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            cashLogEodSchedulerRunning = false;
        }
    };
    setTimeout(() => {
        void runOnce();
    }, 30_000);
    setInterval(() => {
        void runOnce();
    }, everyMs);
    logInfo("cash_log_eod_internal_scheduler_started", {
        everyMinutes: env.CASH_LOG_EOD_INTERNAL_EVERY_MINUTES,
    });
}
async function start() {
    try {
        await prisma.$connect();
        app.listen(env.PORT, () => {
            if (env.NODE_ENV === "production" && !uploadsUseS3()) {
                logWarn("upload_storage_ephemeral", {
                    hint: "Uploads use local disk; files are lost on Railway redeploy. Set S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (and optional S3_ENDPOINT for R2)."
                });
            }
            logInfo("server_start", {
                port: env.PORT,
                env: env.NODE_ENV,
                upload_storage: uploadsUseS3() ? "s3" : "local_disk",
                mail_resend: Boolean(env.RESEND_API_KEY?.trim()),
                mail_smtp: Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS),
                cors_allowlist: describeCorsAllowlist(corsOrigins),
            });
            startInternalCashLogEodSchedulerIfEnabled();
        });
    }
    catch (error) {
        logError("server_start_failure", { error });
        process.exit(1);
    }
}
void start();
