-- Existing tenants stay active; new companies default to invited until OWNER accepts invite.
ALTER TABLE "Company" ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Company" ALTER COLUMN "lifecycleStatus" SET DEFAULT 'invited';
