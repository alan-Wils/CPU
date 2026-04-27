import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.cultivationBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      strain: true,
      strainAcronym: true,
      batchChainCode: true,
      expectedYieldGrams: true,
      autoStatus: true,
      createdAt: true
    }
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

