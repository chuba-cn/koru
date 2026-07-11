-- CreateEnum
CREATE TYPE "CampaignScopeType" AS ENUM ('church', 'region', 'branch');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');

-- CreateTable
CREATE TABLE "SettlementAccount" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "branchId" TEXT,
    "label" TEXT NOT NULL,
    "paystackSubaccountCode" TEXT,
    "bankName" TEXT,
    "accountNumberMasked" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" "CampaignScopeType" NOT NULL,
    "scopeRefId" TEXT,
    "settlementAccountId" TEXT NOT NULL,
    "targetAmountKobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementAccount_churchId_idx" ON "SettlementAccount"("churchId");

-- CreateIndex
CREATE INDEX "SettlementAccount_branchId_idx" ON "SettlementAccount"("branchId");

-- CreateIndex
CREATE INDEX "Campaign_churchId_idx" ON "Campaign"("churchId");

-- CreateIndex
CREATE INDEX "Campaign_settlementAccountId_idx" ON "Campaign"("settlementAccountId");

-- CreateIndex
CREATE INDEX "Campaign_scopeType_scopeRefId_idx" ON "Campaign"("scopeType", "scopeRefId");

-- AddForeignKey
ALTER TABLE "SettlementAccount" ADD CONSTRAINT "SettlementAccount_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAccount" ADD CONSTRAINT "SettlementAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_settlementAccountId_fkey" FOREIGN KEY ("settlementAccountId") REFERENCES "SettlementAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
