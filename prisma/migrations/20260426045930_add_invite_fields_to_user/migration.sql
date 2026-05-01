/*
  Warnings:

  - The primary key for the `CompanyConfig` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompanyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CompanyConfig" ("companyId", "createdAt", "data", "id", "updatedAt") SELECT "companyId", "createdAt", "data", "id", "updatedAt" FROM "CompanyConfig";
DROP TABLE "CompanyConfig";
ALTER TABLE "new_CompanyConfig" RENAME TO "CompanyConfig";
CREATE UNIQUE INDEX "CompanyConfig_companyId_key" ON "CompanyConfig"("companyId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEW_ONLY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inviteToken" TEXT,
    "inviteTokenExpires" DATETIME,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "companyId", "createdAt", "email", "id", "passwordHash", "role", "updatedAt", "username") SELECT "active", "companyId", "createdAt", "email", "id", "passwordHash", "role", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_companyId_username_key" ON "User"("companyId", "username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
