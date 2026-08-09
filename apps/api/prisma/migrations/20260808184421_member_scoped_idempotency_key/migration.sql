/*
  Warnings:

  - A unique constraint covering the columns `[churchId,memberId,idempotencyKey]` on the table `DonationIntent` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "DonationIntent_churchId_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "DonationIntent_churchId_memberId_idempotencyKey_key" ON "DonationIntent"("churchId", "memberId", "idempotencyKey");
