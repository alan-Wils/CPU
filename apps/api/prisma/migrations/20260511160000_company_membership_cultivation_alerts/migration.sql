-- Opt-in per membership for Autogrow climate threshold notifications.
ALTER TABLE "CompanyMembership" ADD COLUMN "cultivationAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
