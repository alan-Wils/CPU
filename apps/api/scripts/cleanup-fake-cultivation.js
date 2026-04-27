import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FAKE_IDS = [
  "cmogj3u2i000xbos4h9rbkufv",
  "cmoghy9pt000xbof0ft8nc92n",
  "cmogh1yo0000xbom8zal4yhm0"
];

async function main() {
  const existing = await prisma.cultivationBatch.findMany({
    where: {
      OR: [
        { id: { in: FAKE_IDS } },
        { id: { startsWith: "cmog" } }
      ]
    },
    select: { id: true, strain: true, createdAt: true }
  });

  console.log("Found fake cultivation rows:", existing.length);
  console.log(JSON.stringify(existing, null, 2));

  if (existing.length === 0) return;

  const ids = existing.map((row) => row.id);

  const deleted = await prisma.$transaction(async (tx) => {
    const cultRuns = await tx.cultivationPackagingRun.findMany({
      where: { cultivationBatchId: { in: ids } },
      select: { id: true }
    });
    const cultRunIds = cultRuns.map((r) => r.id);
    if (cultRunIds.length > 0) {
      await tx.packagingWeighSession.deleteMany({
        where: { packagingRunId: { in: cultRunIds } }
      });
      await tx.cultivationPackagingRun.deleteMany({
        where: { id: { in: cultRunIds } }
      });
    }

    const exRuns = await tx.extractionRun.findMany({
      where: { cultivationBatchId: { in: ids } },
      select: { id: true }
    });
    const exRunIds = exRuns.map((r) => r.id);
    if (exRunIds.length > 0) {
      await tx.packagingLot.deleteMany({
        where: { extractionRunId: { in: exRunIds } }
      });
      await tx.extractionBiomassInput.deleteMany({
        where: { extractionRunId: { in: exRunIds } }
      });
      await tx.extractionRun.deleteMany({
        where: { id: { in: exRunIds } }
      });
    }

    await tx.trimFlowState.deleteMany({
      where: { cultivationBatchId: { in: ids } }
    });
    await tx.freshFrozenAllocation.deleteMany({
      where: { cultivationBatchId: { in: ids } }
    });

    const chains = await tx.sourceChain.findMany({
      where: { cultivationBatchId: { in: ids } },
      select: { id: true }
    });
    const chainIds = chains.map((c) => c.id);
    if (chainIds.length > 0) {
      await tx.sourcePackage.deleteMany({
        where: { sourceChainId: { in: chainIds } }
      });
      await tx.sourceChain.deleteMany({
        where: { id: { in: chainIds } }
      });
    }

    return tx.cultivationBatch.deleteMany({
      where: { id: { in: ids } }
    });
  });

  console.log("Deleted rows:", deleted.count);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

