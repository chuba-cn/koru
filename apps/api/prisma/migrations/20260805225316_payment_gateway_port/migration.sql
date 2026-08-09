-- Two of the changes below are RENAMEs, hand-written over what Prisma generated.
-- Prisma's differ cannot tell a rename from "one column vanished, an unrelated
-- one appeared", so it emits DROP COLUMN + ADD COLUMN. That is the same result
-- on the empty tables this runs against today, and silently discards every
-- church's payment references the first time it replays against real rows.
-- A migration file is a permanent record; it should describe what happened.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('paystack');

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "provider" "PaymentProvider";

-- AlterTable: rename, not drop-and-add. The index follows the column.
ALTER TABLE "Payment" RENAME COLUMN "paystackReference" TO "providerReference";
ALTER INDEX "Payment_paystackReference_key" RENAME TO "Payment_providerReference_key";
ALTER TABLE "Payment" ADD COLUMN     "provider" "PaymentProvider";

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "provider" "PaymentProvider";

-- AlterTable
ALTER TABLE "SettlementAccount" ADD COLUMN     "accountName" TEXT,
ADD COLUMN     "bankCode" TEXT;

-- AlterTable: rename, not drop-and-add. ADR-0019 renamed this column because
-- Paystack sends no event id and the value was always derived, but it is the
-- same value, so existing keys must survive.
ALTER TABLE "WebhookEvent" RENAME COLUMN "paystackEventId" TO "providerEventKey";
ALTER INDEX "WebhookEvent_paystackEventId_key" RENAME TO "WebhookEvent_providerEventKey_key";
-- DEFAULT then DROP DEFAULT: the column is NOT NULL with no default in the
-- schema, which cannot be added to a table that already has rows. Backfilling
-- the only provider that existed when this ran, then dropping the default,
-- leaves the same end state Prisma's version produces on an empty table and a
-- correct one on a populated table.
ALTER TABLE "WebhookEvent" ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'paystack';
ALTER TABLE "WebhookEvent" ALTER COLUMN "provider" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "LedgerEntry_churchId_account_provider_createdAt_idx" ON "LedgerEntry"("churchId", "account", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_expiresAt_idx" ON "PaymentAttempt"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccount_paystackSubaccountCode_key" ON "SettlementAccount"("paystackSubaccountCode");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventKey_key" ON "WebhookEvent"("provider", "providerEventKey");
