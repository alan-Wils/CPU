/**
 * `prisma generate` for Postgres schema — ensures DIRECT_DATABASE_URL is set (required by datasource).
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { neonDirectDatabaseUrl } from "./neon-direct-url.mjs";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(apiRoot, ".env"), override: true });

const pool = String(process.env.DATABASE_URL ?? "").trim();
let direct = String(process.env.DIRECT_DATABASE_URL ?? "").trim();
if (!direct && pool) {
  direct = neonDirectDatabaseUrl(pool) || pool;
}
if (!direct) {
  direct = "postgresql://build:build@127.0.0.1:5432/build";
}
process.env.DIRECT_DATABASE_URL = direct;
if (!pool) process.env.DATABASE_URL = direct;

const r = spawnSync(
  "npx",
  ["prisma", "generate", "--schema=prisma/schema.postgresql.prisma"],
  { stdio: "inherit", cwd: apiRoot, shell: true, env: process.env },
);
process.exit(r.status === null ? 1 : r.status);
