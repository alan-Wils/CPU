-- Per-workflow-section scheduled calendar rows (not TaskLog completions).

CREATE TABLE "SectionCalendarEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "dateYmd" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "batchRef" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionCalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SectionCalendarEvent_companyId_section_dateYmd_idx"
    ON "SectionCalendarEvent"("companyId", "section", "dateYmd");

ALTER TABLE "SectionCalendarEvent"
    ADD CONSTRAINT "SectionCalendarEvent_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
