-- Hold Live Resin oil for the edible kitchen before batch creation.

CREATE TABLE "EdibleOilReservation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "extractionRunId" TEXT NOT NULL,
    "reservedGrams" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdibleOilReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EdibleOilReservation_companyId_extractionRunId_idx" ON "EdibleOilReservation"("companyId", "extractionRunId");
CREATE INDEX "EdibleOilReservation_companyId_status_idx" ON "EdibleOilReservation"("companyId", "status");
CREATE INDEX "EdibleOilReservation_extractionRunId_status_idx" ON "EdibleOilReservation"("extractionRunId", "status");

ALTER TABLE "EdibleOilReservation" ADD CONSTRAINT "EdibleOilReservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EdibleOilReservation" ADD CONSTRAINT "EdibleOilReservation_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "ExtractionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EdibleOilReservation" ADD CONSTRAINT "EdibleOilReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
