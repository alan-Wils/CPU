/**
 * API runtime only — does NOT run Prisma migrations.
 * Railway: use `releaseCommand` in railway.toml for migrate deploy once per deploy.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(apiRoot, "dist", "server.js");

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  cwd: apiRoot,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
