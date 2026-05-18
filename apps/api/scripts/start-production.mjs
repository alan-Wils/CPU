/**
 * Production API entry: optional migrate deploy, then start server.
 * Railway: releaseCommand in railway.toml should migrate once per deploy; this is a fallback
 * when release did not run (uses DATABASE_URL / DIRECT_DATABASE_URL from the host).
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(apiRoot, "dist", "server.js");

function shouldRunMigrationsOnStart() {
  const runFlag = String(process.env.RUN_PRISMA_MIGRATIONS ?? "").trim().toLowerCase();
  if (runFlag === "false" || runFlag === "0" || runFlag === "no") return false;
  const db = String(process.env.DATABASE_URL ?? "").trim();
  if (!db || db.startsWith("file:")) return false;
  return db.includes("postgres") || db.includes("postgresql");
}

if (shouldRunMigrationsOnStart()) {
  console.log("[prisma] startup fallback: running migrate deploy before server…");
  const migrate = spawnSync(process.execPath, ["scripts/prisma-migrate-deploy-production.mjs"], {
    stdio: "inherit",
    cwd: apiRoot,
    env: process.env,
  });
  if (migrate.status !== 0) {
    console.error("[prisma] startup migrate deploy failed (exit", migrate.status, ")");
    process.exit(migrate.status === null ? 1 : migrate.status);
  }
}

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  cwd: apiRoot,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
