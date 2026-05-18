import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Prisma 7-ready config (replaces deprecated `package.json#prisma`). */
export default {
  schema: path.join(root, "prisma", "schema.postgresql.prisma"),
  migrations: {
    path: path.join(root, "prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
};
