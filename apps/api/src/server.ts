import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { parseCorsOrigin } from "./config/cors.js";
import { appRouter } from "./router.js";
import { errorMiddleware } from "./middleware/error.js";
import { prisma } from "./config/prisma.js";
import { logInfo, logError } from "./lib/logger.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: parseCorsOrigin(env.CORS_ORIGIN) }));
app.use(express.json({ limit: "1mb" }));

/** Liveness: process is up; does not hit the database. */
app.get("/health/live", (_req, res) => {
  res.json({ status: "ok", service: "cpu-api", check: "live" });
});

const healthReady: express.RequestHandler = async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", service: "cpu-api", check: "ready" });
  } catch (error) {
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
      logInfo("server_start", { port: env.PORT, env: env.NODE_ENV });
    });
  } catch (error) {
    logError("server_start_failure", { error });
    process.exit(1);
  }
}

void start();
