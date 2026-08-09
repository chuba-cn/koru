-- A rename, hand-written over what Prisma generated. Prisma's differ emits
-- DROP COLUMN + ADD COLUMN, which is indistinguishable on today's empty table
-- and silently drops every church's payout routing the first time it replays
-- against real rows. The index follows the column.
ALTER TABLE "SettlementAccount" RENAME COLUMN "paystackSubaccountCode" TO "providerSubaccountCode";
ALTER INDEX "SettlementAccount_paystackSubaccountCode_key" RENAME TO "SettlementAccount_providerSubaccountCode_key";
