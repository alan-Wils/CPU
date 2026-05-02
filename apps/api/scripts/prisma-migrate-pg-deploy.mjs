/**
 * Loads `apps/api/.env` with override so a bad `DATABASE_URL` in the shell
 * (e.g. PowerShell leftovers) does not win over the file.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(apiRoot, ".env"), override: true });

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", "--schema=prisma/schema.postgresql.prisma"],
  { stdio: "inherit", cwd: apiRoot, shell: true }
);

process.exit(result.status === null ? 1 : result.status);
