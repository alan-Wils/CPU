-- Soft delete for conversation messages. Owners/admins of the sender company can delete their own
-- outgoing messages; readers and senders both stop seeing them. The `deletedByUserId` column gives
-- us an audit trail of who removed it.
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "deletedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "ConversationMessage_deletedAt_idx" ON "ConversationMessage"("deletedAt");
