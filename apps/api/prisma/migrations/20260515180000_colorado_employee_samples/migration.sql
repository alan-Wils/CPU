-- Colorado MED employee R&D sample records + designated sampling employee flag (CompanyMembership).

CREATE TYPE "EmployeeSampleLicenseType" AS ENUM ('MEDICAL', 'RETAIL');
CREATE TYPE "EmployeeSampleSourceType" AS ENUM ('CULTIVATION', 'MANUFACTURING', 'PACKAGING', 'OTHER');
CREATE TYPE "EmployeeSampleProductCategory" AS ENUM ('FLOWER', 'CONCENTRATE', 'EDIBLE', 'NON_EDIBLE_PRODUCT');
CREATE TYPE "EmployeeSampleUnit" AS ENUM ('GRAMS', 'SERVINGS', 'EACH');
CREATE TYPE "EmployeeSamplePurpose" AS ENUM ('QUALITY_CONTROL', 'PRODUCT_DEVELOPMENT');

ALTER TABLE "CompanyMembership" ADD COLUMN "designatedRnDSamplingEmployee" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EmployeeSample" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "employeeIdentifierSnapshot" TEXT,
    "licenseType" "EmployeeSampleLicenseType" NOT NULL,
    "sourceType" "EmployeeSampleSourceType" NOT NULL,
    "productCategory" "EmployeeSampleProductCategory" NOT NULL,
    "productName" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "metrcPackageTag" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "EmployeeSampleUnit" NOT NULL,
    "thcMgPerServing" DOUBLE PRECISION,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "calendarMonth" TEXT NOT NULL,
    "purpose" "EmployeeSamplePurpose" NOT NULL,
    "sopAcknowledged" BOOLEAN NOT NULL,
    "employeeConfirmedMonthlyLimit" BOOLEAN NOT NULL,
    "notCompensationAcknowledged" BOOLEAN NOT NULL,
    "noOnPremConsumptionAcknowledged" BOOLEAN NOT NULL,
    "noResaleOrTransferAcknowledged" BOOLEAN NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeSample_companyId_calendarMonth_idx" ON "EmployeeSample"("companyId", "calendarMonth");
CREATE INDEX "EmployeeSample_companyId_employeeId_calendarMonth_idx" ON "EmployeeSample"("companyId", "employeeId", "calendarMonth");
CREATE INDEX "EmployeeSample_companyId_transferDate_idx" ON "EmployeeSample"("companyId", "transferDate");
CREATE INDEX "EmployeeSample_companyId_batchNumber_idx" ON "EmployeeSample"("companyId", "batchNumber");
CREATE INDEX "EmployeeSample_companyId_metrcPackageTag_idx" ON "EmployeeSample"("companyId", "metrcPackageTag");

ALTER TABLE "EmployeeSample" ADD CONSTRAINT "EmployeeSample_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeSample" ADD CONSTRAINT "EmployeeSample_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeSample" ADD CONSTRAINT "EmployeeSample_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
