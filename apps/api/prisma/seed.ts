import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { legacyUserRoleToCompanyRole } from "../src/lib/nexbatchRoles.js";
import { seedNexBatchPlatformOperators } from "./nexbatchOperatorSeed.js";

const prisma = new PrismaClient();

async function backfillMembershipsFromPrimaryCompany() {
  const users = await prisma.user.findMany({
    where: { companyId: { not: null } },
  });
  for (const u of users) {
    const cid = u.companyId as string;
    const nex = legacyUserRoleToCompanyRole(u.role);
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: u.id, companyId: cid } },
      create: { userId: u.id, companyId: cid, role: nex },
      update: { role: nex },
    });
  }
}

async function upsertCompanyWithUsers(input: {
  name: string;
  slug: string;
  users: Array<{ email: string; role: UserRole; password: string }>;
}) {
  const company = await prisma.company.upsert({
    where: { slug: input.slug },
    update: { name: input.name },
    create: { name: input.name, slug: input.slug, nextChainSequence: 0 }
  });

  for (const user of input.users) {
    const passwordHash = await bcrypt.hash(user.password, 12);
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: { companyId: company.id, role: user.role, passwordHash, isActive: true },
      create: {
        companyId: company.id,
        email: user.email,
        passwordHash,
        role: user.role,
        isActive: true
      }
    });
    const nex = legacyUserRoleToCompanyRole(user.role);
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: row.id, companyId: company.id } },
      create: { userId: row.id, companyId: company.id, role: nex },
      update: { role: nex },
    });
  }

  return company;
}

async function upsertConfig(companyId: string, key: string, value: unknown) {
  await prisma.companyConfig.upsert({
    where: { companyId_key: { companyId, key } },
    update: { valueJson: JSON.stringify(value) },
    create: { companyId, key, valueJson: JSON.stringify(value) }
  });
}

/** Demo rows for NexBatch portal “Usage & Costs” modal (current UTC month). */
async function seedDemoUsageEvents(budId: string, demoId: string) {
  await prisma.usageEvent.deleteMany({
    where: { companyId: { in: [budId, demoId] } },
  });

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = Math.min(Math.max(now.getUTCDate(), 2), 28);
  const at = (d: number, h = 10) => new Date(Date.UTC(y, m, d, h, 0, 0));

  await prisma.usageEvent.createMany({
    data: [
      {
        companyId: budId,
        provider: "vercel",
        feature: "edge_requests",
        unitType: "page_views",
        units: 14200,
        estimatedCost: 5.12,
        createdAt: at(day - 2),
      },
      {
        companyId: budId,
        provider: "railway",
        feature: "api_service",
        unitType: "gb_hours",
        units: 22.4,
        estimatedCost: 14.8,
        createdAt: at(day - 1, 14),
      },
      {
        companyId: budId,
        provider: "neon",
        feature: "postgres",
        unitType: "rows_written",
        units: 185000,
        estimatedCost: 3.25,
        createdAt: at(day - 1),
      },
      {
        companyId: budId,
        provider: "resend",
        feature: "transactional",
        unitType: "email_sent",
        units: 820,
        estimatedCost: 0.33,
        createdAt: at(day - 3),
      },
      {
        companyId: budId,
        provider: "cloudflare_r2",
        feature: "object_storage",
        unitType: "gb_month",
        units: 48.2,
        estimatedCost: 1.1,
        createdAt: at(day - 2, 16),
      },
      {
        companyId: budId,
        provider: "ai",
        feature: "openai_chat",
        unitType: "tokens_estimated",
        units: 2400000,
        estimatedCost: 18.6,
        createdAt: at(day - 1, 9),
      },
      {
        companyId: demoId,
        provider: "vercel",
        feature: "edge_requests",
        unitType: "page_views",
        units: 2100,
        estimatedCost: 0.72,
        createdAt: at(day - 2, 11),
      },
      {
        companyId: demoId,
        provider: "railway",
        feature: "api_service",
        unitType: "gb_hours",
        units: 4.1,
        estimatedCost: 2.65,
        createdAt: at(day - 2),
      },
      {
        companyId: demoId,
        provider: "neon",
        feature: "postgres",
        unitType: "rows_written",
        units: 12000,
        estimatedCost: 0.45,
        createdAt: at(day - 3),
      },
      {
        companyId: demoId,
        provider: "resend",
        feature: "transactional",
        unitType: "email_sent",
        units: 45,
        estimatedCost: 0.02,
        createdAt: at(day - 1),
      },
      {
        companyId: demoId,
        provider: "cloudflare_r2",
        feature: "object_storage",
        unitType: "gb_month",
        units: 3.2,
        estimatedCost: 0.08,
        createdAt: at(day - 4),
      },
      {
        companyId: demoId,
        provider: "ai",
        feature: "openai_chat",
        unitType: "tokens_estimated",
        units: 95000,
        estimatedCost: 0.85,
        createdAt: at(day - 2, 15),
      },
    ],
  });
}

async function main() {
  const budFox = await upsertCompanyWithUsers({
    name: "BudFox",
    slug: "budfox",
    users: [
      { email: "owner@budfox.com", role: "OWNER", password: "OwnerPass!234" },
      { email: "admin@budfox.com", role: "ADMIN", password: "AdminPass!234" },
      { email: "cultivation@budfox.com", role: "CULTIVATION_SPECIALIST", password: "CultivationPass!234" },
      { email: "extraction@budfox.com", role: "EXTRACTION_SPECIALIST", password: "ExtractionPass!234" },
      { email: "packaging@budfox.com", role: "PACKAGING_SPECIALIST", password: "PackagingPass!234" },
      { email: "viewer@budfox.com", role: "VIEW_ONLY", password: "ViewerPass!234" }
    ]
  });

  const demoCompany = await upsertCompanyWithUsers({
    name: "Demo Company",
    slug: "demo-company",
    users: [
      { email: "owner@demo.com", role: "OWNER", password: "OwnerPass!234" },
      { email: "admin@demo.com", role: "ADMIN", password: "AdminPass!234" }
    ]
  });

  await upsertConfig(budFox.id, "strains", ["Blue Dream", "GG4", "Sour Diesel", "Wedding Cake"]);
  await upsertConfig(budFox.id, "rooms", ["Flower Room A", "Flower Room B", "Veg Room"]);
  await upsertConfig(budFox.id, "bays", ["Bay 1", "Bay 2", "Bay 3"]);
  await upsertConfig(budFox.id, "tables", ["Table 1", "Table 2", "Table 3", "Table 4"]);
  await upsertConfig(budFox.id, "hardware_options", ["LED Rack", "CO2 System", "Drying Rack"]);
  await upsertConfig(budFox.id, "packaging_defaults", {
    skuPrefix: "BFX",
    gramsPerUnit: 1,
    defaultTemplate: "TamperSeal-v2"
  });
  await upsertConfig(budFox.id, "extraction_supplies", ["Ethanol", "Butane", "Rosin Press Bags", "Filter Media"]);

  const companyBud = await prisma.company.update({
    where: { id: budFox.id },
    data: { nextChainSequence: { increment: 1 } }
  });
  const seq = companyBud.nextChainSequence;
  const year = (new Date().getFullYear() % 100).toString().padStart(2, "0");
  const code = `${year}-${String(seq).padStart(4, "0")}`;
  const acronym = "BD";

  const aGrade = 3000;
  const popcorn = 500;
  const trimT = 500;
  const ffT = 200;
  const total = aGrade + popcorn + trimT + ffT;

  const batch = await prisma.cultivationBatch.create({
    data: {
      companyId: budFox.id,
      strain: "Blue Dream",
      strainAcronym: acronym,
      batchChainCode: code,
      plantedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
      expectedYieldGrams: total,
      aGradeFlowerGrams: aGrade,
      popcornGrams: popcorn,
      trimGrams: trimT,
      freshFrozenGrams: ffT,
      room: "Flower Room A",
      bay: "Bay 2",
      table: "Table 3"
    }
  });

  const chain = await prisma.sourceChain.create({
    data: {
      companyId: budFox.id,
      cultivationBatchId: batch.id,
      chainKey: `${acronym}-${code}`
    }
  });
  for (const [role, name] of [
    ["A_GRADE_FLOWER" as const, `${acronym}-${code}-AG`],
    ["POPCORN" as const, `${acronym}-${code}-PC`],
    ["DRY_TRIM" as const, `${acronym}-${code}-DT`],
    ["FRESH_FROZEN" as const, `${acronym}-${code}-FF`]
  ] as const) {
    await prisma.sourcePackage.create({
      data: { sourceChainId: chain.id, role, canonicalName: name }
    });
  }
  await prisma.trimFlowState.create({
    data: { companyId: budFox.id, cultivationBatchId: batch.id, toExtractionGrams: 300, consumedGrams: 200 }
  });
  await prisma.freshFrozenAllocation.create({
    data: { companyId: budFox.id, cultivationBatchId: batch.id, toExtractionGrams: 0 }
  });

  const popRun = await prisma.cultivationPackagingRun.create({
    data: {
      companyId: budFox.id,
      cultivationBatchId: batch.id,
      line: "POPCORN",
      status: "COMPLETED",
      terpeneGramsCumulative: 0,
      netMaterialGramsInProgress: 0,
      netMaterialGramsCompleted: 500,
      finishedAt: new Date()
    }
  });
  void popRun;

  await prisma.cultivationPackagingRun.create({
    data: {
      companyId: budFox.id,
      cultivationBatchId: batch.id,
      line: "A_GRADE_FLOWER",
      status: "IN_PROGRESS",
      terpeneGramsCumulative: 2.5,
      netMaterialGramsInProgress: 1200,
      netMaterialGramsCompleted: 0
    }
  });

  const socksAt = new Date(Date.now() - 1000 * 60 * 90);
  const extraction = await prisma.extractionRun.create({
    data: {
      companyId: budFox.id,
      cultivationBatchId: batch.id,
      phase: "COMPLETED",
      productCategory: "CURED_WAX",
      biomassPrepStartedAt: new Date(socksAt.getTime() - 1000 * 60 * 10),
      socksStartAt: socksAt,
      socksEndAt: new Date(socksAt.getTime() + 1000 * 60 * 20),
      biomassPrepDurationSeconds: 1200,
      method: "Ethanol",
      inputGrams: 200,
      outputGrams: 515,
      supplyUsed: "Filter Media",
      finishedAt: new Date()
    }
  });
  await prisma.freshFrozenAllocation.update({
    where: { cultivationBatchId: batch.id },
    data: { toExtractionGrams: 200, lastExtractionRunId: extraction.id }
  });
  await prisma.trimFlowState.update({
    where: { cultivationBatchId: batch.id },
    data: { toExtractionGrams: 500, consumedGrams: 0 }
  });
  await prisma.extractionBiomassInput.create({
    data: {
      companyId: budFox.id,
      extractionRunId: extraction.id,
      cultivationBatchId: batch.id,
      sourceType: "DRY_TRIM",
      grams: 200,
      sockWeightGrams: 48
    }
  });
  const packLot = await prisma.packagingLot.create({
    data: {
      companyId: budFox.id,
      extractionRunId: extraction.id,
      status: "COMPLETED",
      netOutputGrams: 400,
      terpeneGrams: 0,
      sku: "BFX-BD-1G",
      units: 400,
      gramsPerUnit: 1,
      defaultTemplate: "TamperSeal-v2",
      finishedAt: new Date()
    }
  });
  void packLot;

  const laborUser = await prisma.user.findUniqueOrThrow({ where: { email: "cultivation@budfox.com" } });
  await prisma.laborEntry.create({
    data: {
      companyId: budFox.id,
      userId: laborUser.id,
      stage: "CULTIVATION",
      taskType: "CPU_BENCH_PACK",
      hours: 8.5,
      hourlyRate: 26,
      totalCost: 221,
      referenceId: batch.id,
      cultivationBatchId: batch.id
    }
  });

  await prisma.cpuSnapshot.create({
    data: {
      companyId: budFox.id,
      period: "2026-W17",
      totalLabor: 221,
      totalOutputG: 515,
      cpuPerGram: 0.43
    }
  });

  await prisma.auditLog.create({
    data: {
      companyId: budFox.id,
      actorUserId: laborUser.id,
      action: "seed.bootstrap",
      entityType: "System",
      entityId: "seed",
      afterJson: JSON.stringify({ status: "operational_baseline" })
    }
  });

  await backfillMembershipsFromPrimaryCompany();
  await seedNexBatchPlatformOperators(prisma, budFox.id, demoCompany.id);
  await seedDemoUsageEvents(budFox.id, demoCompany.id);

  console.log("Seed complete: BudFox + Demo Company initialized with operational Data Hub + workflow baseline.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
