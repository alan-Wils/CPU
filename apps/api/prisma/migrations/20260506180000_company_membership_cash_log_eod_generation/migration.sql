-- Schedule generation: changing saved digest prefs resets same-day duplicate suppression.
ALTER TABLE "CompanyMembership" ADD COLUMN "cashLogEodScheduleGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CompanyMembership" ADD COLUMN "cashLogEodDigestSentScheduleGeneration" INTEGER;

-- Anchor legacy rows so same-day suppression keeps working until the user saves prefs again (bumps generation, clears anchoring column in app layer).
UPDATE "CompanyMembership"
SET "cashLogEodDigestSentScheduleGeneration" = "cashLogEodScheduleGeneration"
WHERE "cashLogEodLastSentAt" IS NOT NULL;
