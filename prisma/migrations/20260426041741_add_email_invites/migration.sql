/*
  Warnings:

  - The primary key for the `CompanyConfig` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `companyId` on the `CompanyConfig` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.
  - You are about to alter the column `id` on the `CompanyConfig` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompanyConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CompanyConfig" ("companyId", "createdAt", "data", "id", "updatedAt") SELECT "companyId", "createdAt", "data", "id", "updatedAt" FROM "CompanyConfig";
DROP TABLE "CompanyConfig";
ALTER TABLE "new_CompanyConfig" RENAME TO "CompanyConfig";
CREATE UNIQUE INDEX "CompanyConfig_companyId_key" ON "CompanyConfig"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
