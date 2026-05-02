/**
 * Run on staging/production when NexBatch portal logins are missing:
 *   cd apps/api && npx tsx prisma/seed-nexbatch-operators.ts
 * Requires DATABASE_URL (Postgres) and existing BudFox + Demo companies (any slug from prior seed/migrate).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedNexBatchPlatformOperators } from "./nexbatchOperatorSeed.js";

const prisma = new PrismaClient();

async function main() {
    const bud = await prisma.company.findFirst({ where: { slug: { equals: "budfox", mode: "insensitive" } } });
    const demo = await prisma.company.findFirst({
        where: { slug: { equals: "demo-company", mode: "insensitive" } },
    });
    if (!bud || !demo) {
        throw new Error(
            `Missing companies: budfox=${Boolean(bud)} demo-company=${Boolean(demo)}. Create companies or run full seed once in a non-prod environment.`
        );
    }
    await seedNexBatchPlatformOperators(prisma, bud.id, demo.id);
    console.log("NexBatch operators upserted: admin@nexbatch.com, owner@nexbatch.com (BudFox + Demo memberships).");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
