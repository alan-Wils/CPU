-- Per-company JSON permission overrides (see `CompanyMembership.appPermissions`).
ALTER TABLE "CompanyMembership" ADD COLUMN "appPermissions" JSONB;
