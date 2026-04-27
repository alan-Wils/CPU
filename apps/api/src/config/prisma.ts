import { PrismaClient } from "@prisma/client";

/** Widen until `prisma/schema.*` matches all deployed tables (restored services expect full schema). */
export const prisma = new PrismaClient() as any;
