import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Idempotent: upserts NexBatch portal operators + memberships on BudFox + Demo.
 * Safe to run on production; does not touch cultivation/extraction demo data.
 */
export async function seedNexBatchPlatformOperators(prisma: PrismaClient, budFoxId: string, demoId: string) {
    const rows: Array<{ email: string; password: string; platformRole: "nexbatch_admin" | "owner" }> = [
        { email: "admin@nexbatch.com", password: "NexBatchAdmin123!", platformRole: "nexbatch_admin" },
        { email: "owner@nexbatch.com", password: "NexBatchOwner123!", platformRole: "owner" },
    ];
    for (const row of rows) {
        const passwordHash = await bcrypt.hash(row.password, 12);
        const u = await prisma.user.upsert({
            where: { email: row.email },
            update: {
                platformRole: row.platformRole,
                passwordHash,
                isActive: true,
                companyId: null,
                role: "OWNER",
            },
            create: {
                email: row.email,
                passwordHash,
                role: "OWNER",
                companyId: null,
                platformRole: row.platformRole,
                isActive: true,
            },
        });
        for (const cid of [budFoxId, demoId]) {
            await prisma.companyMembership.upsert({
                where: { userId_companyId: { userId: u.id, companyId: cid } },
                create: { userId: u.id, companyId: cid, role: "owner" },
                update: { role: "owner" },
            });
        }
    }
}
