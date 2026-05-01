/* Prefer IPv4 first when resolving SMTP hosts (Railway/cloud often hang on broken IPv6 to Gmail). */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { env } from "./config/env.js";
import { parseCorsOrigin } from "./config/cors.js";
import { appRouter } from "./router.js";
import { errorMiddleware } from "./middleware/error.js";
import { prisma } from "./config/prisma.js";
import { logInfo, logError } from "./lib/logger.js";
const app = express();
app.use(helmet());
app.use(cors({ origin: parseCorsOrigin(env.CORS_ORIGIN) }));
app.use(express.json({ limit: "15mb" }));
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
app.use("/api", appRouter);
app.use(errorMiddleware);
async function start() {
    try {
        await prisma.$connect();
        app.listen(env.PORT, () => {
            logInfo("server_start", {
                port: env.PORT,
                env: env.NODE_ENV,
                mail_resend: Boolean(env.RESEND_API_KEY?.trim()),
                mail_smtp: Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS),
            });
        });
    }
    catch (error) {
        logError("server_start_failure", { error });
        process.exit(1);
    }
}
void start();
