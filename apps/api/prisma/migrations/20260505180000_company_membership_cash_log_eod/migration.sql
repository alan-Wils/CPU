-- Per-user financial (cash) log digest email schedule.
ALTER TABLE "CompanyMembership" ADD COLUMN "cashLogEodPrefs" JSONB;
ALTER TABLE "CompanyMembership" ADD COLUMN "cashLogEodLastSentAt" TIMESTAMP(3);
