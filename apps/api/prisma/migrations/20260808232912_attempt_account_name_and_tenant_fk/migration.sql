-- DropForeignKey
ALTER TABLE "PaymentAttempt" DROP CONSTRAINT "PaymentAttempt_settlementAccountId_fkey";

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "virtualAccountName" TEXT;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_settlementAccountId_churchId_fkey" FOREIGN KEY ("settlementAccountId", "churchId") REFERENCES "SettlementAccount"("id", "churchId") ON DELETE RESTRICT ON UPDATE CASCADE;
