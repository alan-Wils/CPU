/**
 * Production Postgres migrations (Railway release command or `npm run prisma:migrate:deploy`).
 *
 * - Uses `DIRECT_DATABASE_URL` (or derives non-pooler URL from `DATABASE_URL`)
 * - Sets `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1` for this process only
 * - Single `migrate deploy` — no retry loop
 * - Skips when `RUN_PRISMA_MIGRATIONS=false` (API replicas must not run this)
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { neonDirectDatabaseUrl } from "./neon-direct-url.mjs";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(apiRoot, ".env"), override: true });

const runFlag = String(process.env.RUN_PRISMA_MIGRATIONS ?? "").trim().toLowerCase();
if (runFlag === "false" || runFlag === "0" || runFlag === "no") {
  console.log("[prisma] RUN_PRISMA_MIGRATIONS disabled — skipping migrate deploy");
  process.exit(0);
}

const poolUrl = String(process.env.DATABASE_URL ?? "").trim();
let directUrl = String(process.env.DIRECT_DATABASE_URL ?? "").trim();
if (!directUrl && poolUrl) {
  directUrl = neonDirectDatabaseUrl(poolUrl);
  if (directUrl && directUrl !== poolUrl) {
    console.log("[prisma] DIRECT_DATABASE_URL derived from DATABASE_URL (removed -pooler host)");
  }
}
if (!directUrl) {
  console.error("[prisma] Set DIRECT_DATABASE_URL or DATABASE_URL before migrate deploy");
  process.exit(1);
}

if (!poolUrl) {
  console.warn("[prisma] DATABASE_URL unset — using direct URL for runtime url env as well");
}

const childEnv = {
  ...process.env,
  DATABASE_URL: poolUrl || directUrl,
  DIRECT_DATABASE_URL: directUrl,
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
};

console.log("[prisma] migrate deploy starting (direct connection, advisory lock disabled for this run)");

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", "--schema=prisma/schema.postgresql.prisma"],
  { stdio: "inherit", cwd: apiRoot, shell: true, env: childEnv },
);

const code = result.status === null ? 1 : result.status;
if (code === 0) {
  console.log("[prisma] migrate deploy finished successfully");
} else {
  console.error("[prisma] migrate deploy failed with exit code", code);
}
process.exit(code);
