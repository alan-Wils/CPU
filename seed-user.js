const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { code: "BUDFOX" },
    update: {},
    create: {
      name: "BudFox",
      code: "BUDFOX",
    },
  });

  const passwordHash = await bcrypt.hash("password123", 10);

  await prisma.user.upsert({
    where: {
      companyId_username: {
        companyId: company.id,
        username: "alan",
      },
    },
    update: {
      passwordHash,
      role: "OWNER",
      active: true,
    },
    create: {
      companyId: company.id,
      username: "alan",
      email: null,
      passwordHash,
      role: "OWNER",
      active: true,
    },
  });

  console.log("Login created:");
  console.log("Company Code: BUDFOX");
  console.log("Username: alan");
  console.log("Password: password123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());