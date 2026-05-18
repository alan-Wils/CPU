/** @deprecated Use prisma-migrate-deploy-production.mjs — kept as alias for docs/scripts. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "prisma-migrate-deploy-production.mjs");
const r = spawnSync(process.execPath, [script], { stdio: "inherit", shell: false });
process.exit(r.status === null ? 1 : r.status);
