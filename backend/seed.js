const bcrypt = require("bcryptjs");
const prisma = require("./db");

async function main() {
  const company = await prisma.company.upsert({
    where: { code: "BUDFOX" },
    update: {},
    create: {
      name: "BudFox",
      code: "BUDFOX",
    },
  });

  const passwordHash = await bcrypt.hash("password123", 12);

  const existingUser = await prisma.user.findFirst({
    where: {
      companyId: company.id,
      username: "alan",
    },
  });

  let user;

  if (existingUser) {
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        passwordHash,
        role: "OWNER",
        active: true,
        email: "alan.w@budfoxsupply.com",
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        companyId: company.id,
        username: "alan",
        email: "alan.w@budfoxsupply.com",
        passwordHash,
        role: "OWNER",
        active: true,
      },
    });
  }

  console.log("Seed complete");
  console.log("Company Code: BUDFOX");
  console.log("Username: alan");
  console.log("Password: password123");
  console.log("Company ID:", company.id);
  console.log("User ID:", user.id);

  const ownerDemoHash = await bcrypt.hash("OwnerPass!234", 12);
  await prisma.user.upsert({
    where: {
      companyId_username: {
        companyId: company.id,
        username: "owner",
      },
    },
    update: {
      email: "owner@budfox.com",
      passwordHash: ownerDemoHash,
      role: "OWNER",
      active: true,
    },
    create: {
      companyId: company.id,
      username: "owner",
      email: "owner@budfox.com",
      passwordHash: ownerDemoHash,
      role: "OWNER",
      active: true,
    },
  });

  console.log("Demo owner (also): Username owner or owner@budfox.com · Password OwnerPass!234");
}

main()
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });