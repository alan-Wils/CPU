-- NexBatch portal staff invites (email link + accept password), separate from company InviteToken.

CREATE TABLE "PlatformStaffInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "platformRole" TEXT NOT NULL,
    "companyIds" JSONB NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformStaffInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformStaffInvite_tokenHash_key" ON "PlatformStaffInvite"("tokenHash");

CREATE INDEX "PlatformStaffInvite_email_idx" ON "PlatformStaffInvite"("email");

CREATE INDEX "PlatformStaffInvite_createdBy_idx" ON "PlatformStaffInvite"("createdBy");
