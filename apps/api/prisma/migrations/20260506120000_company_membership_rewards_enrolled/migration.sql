-- Per-company staff rewards enrollment (Admin → Edit user).
ALTER TABLE "CompanyMembership" ADD COLUMN IF NOT EXISTS "rewardsEnrolled" BOOLEAN NOT NULL DEFAULT false;
