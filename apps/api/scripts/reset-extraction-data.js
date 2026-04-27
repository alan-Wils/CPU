import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const packagingLots = await tx.packagingLot.deleteMany({});
    const biomassInputs = await tx.extractionBiomassInput.deleteMany({});
    const extractionRuns = await tx.extractionRun.deleteMany({});

    // Reset extraction allocation counters so source material is available again.
    const trimReset = await tx.trimFlowState.updateMany({
      data: { toExtractionGrams: 0, consumedGrams: 0 }
    });
    const freshReset = await tx.freshFrozenAllocation.updateMany({
      data: { toExtractionGrams: 0, lastExtractionRunId: null }
    });

    const taskLogs = await tx.taskLog.deleteMany({
      where: { stage: { in: ["EXTRACTION", "PACKAGING"] } }
    });
    const auditLogs = await tx.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: "extraction." } },
          { action: { startsWith: "packaging." } }
        ]
      }
    });

    return {
      packagingLots: packagingLots.count,
      biomassInputs: biomassInputs.count,
      extractionRuns: extractionRuns.count,
      trimReset: trimReset.count,
      freshReset: freshReset.count,
      taskLogs: taskLogs.count,
      auditLogs: auditLogs.count
    };
  });

  console.log("Extraction reset completed:");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

