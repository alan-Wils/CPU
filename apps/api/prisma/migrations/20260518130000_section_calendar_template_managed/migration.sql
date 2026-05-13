-- Cultivation schedule template sync: stable upsert key + managed flag.

ALTER TABLE "SectionCalendarEvent" ADD COLUMN "templateDedupeKey" TEXT;
ALTER TABLE "SectionCalendarEvent" ADD COLUMN "templateManaged" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "SectionCalendarEvent_companyId_section_templateDedupeKey_key"
  ON "SectionCalendarEvent" ("companyId", "section", "templateDedupeKey");
