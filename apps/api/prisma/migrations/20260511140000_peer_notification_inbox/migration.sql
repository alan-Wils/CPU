-- Per-user per-company inbox for home notification bell (cross-device sync).

CREATE TABLE "PeerNotificationInbox" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeerNotificationInbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PeerNotificationInbox_membershipId_key" ON "PeerNotificationInbox"("membershipId");

ALTER TABLE "PeerNotificationInbox" ADD CONSTRAINT "PeerNotificationInbox_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
