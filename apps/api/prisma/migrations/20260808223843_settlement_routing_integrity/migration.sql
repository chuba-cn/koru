/*
  Warnings:

  - A unique constraint covering the columns `[churchId,id]` on the table `SettlementAccount` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[churchId,bankCode,accountNumberHash]` on the table `SettlementAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_settlementAccountId_fkey";

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "settlementAccountId" TEXT;

-- AlterTable
ALTER TABLE "SettlementAccount" ADD COLUMN     "accountNumberHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccount_churchId_id_key" ON "SettlementAccount"("churchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAccount_churchId_bankCode_accountNumberHash_key" ON "SettlementAccount"("churchId", "bankCode", "accountNumberHash");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_settlementAccountId_churchId_fkey" FOREIGN KEY ("settlementAccountId", "churchId") REFERENCES "SettlementAccount"("id", "churchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_settlementAccountId_fkey" FOREIGN KEY ("settlementAccountId") REFERENCES "SettlementAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
