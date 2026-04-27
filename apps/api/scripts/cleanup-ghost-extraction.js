import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ghosts = await prisma.extractionRun.findMany({
    where: {
      phase: "PENDING_BIOMASS_PREP",
      method: "",
      inputGrams: 0,
      outputGrams: 0
    },
    include: {
      biomassLines: { select: { id: true } },
      packagingLots: { select: { id: true } }
    }
  });

  const deletable = ghosts.filter((g) => g.biomassLines.length === 0 && g.packagingLots.length === 0);
  console.log("Ghost extraction shells found:", ghosts.length);
  console.log("Ghost extraction shells deletable:", deletable.length);
  console.log(JSON.stringify(deletable.map((g) => ({ id: g.id, cultivationBatchId: g.cultivationBatchId, createdAt: g.createdAt })), null, 2));

  if (deletable.length === 0) return;

  const ids = deletable.map((g) => g.id);
  const deleted = await prisma.extractionRun.deleteMany({
    where: { id: { in: ids } }
  });
  console.log("Deleted ghost extraction shells:", deleted.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

