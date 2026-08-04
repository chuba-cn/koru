-- CreateEnum
CREATE TYPE "DonationIntentStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('settled', 'refunded', 'reversed');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('gateway_clearing', 'campaign_giving', 'fees', 'settlement_payout', 'refunds', 'cash_on_hand');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "DomainEventType" AS ENUM ('donation_intent_created', 'payment_attempt_succeeded', 'payment_settled', 'refund_requested', 'refund_processed');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'approved', 'rejected', 'processed');

-- CreateEnum
CREATE TYPE "CashApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_campaignId_fkey";

-- DropIndex
DROP INDEX "Payment_status_idx";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "expiresAt",
DROP COLUMN "status",
DROP COLUMN "virtualAcoountBank",
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "churchId" TEXT NOT NULL,
ADD COLUMN     "paymentAttemptId" TEXT,
ADD COLUMN     "state" "PaymentState" NOT NULL DEFAULT 'settled',
ADD COLUMN     "virtualAccountBank" TEXT,
ALTER COLUMN "paidAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "churchId" TEXT,
ADD COLUMN     "rawBody" TEXT NOT NULL,
ADD COLUMN     "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "signature" TEXT NOT NULL,
ADD CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id");

-- DropEnum
DROP TYPE "PaymentStatus";

-- CreateTable
CREATE TABLE "DonationIntent" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "branchId" TEXT,
    "campaignId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "pledgeId" TEXT,
    "amountKobo" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "DonationIntentStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "branchId" TEXT,
    "donationIntentId" TEXT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'pending',
    "providerReference" TEXT,
    "virtualAccountNumber" TEXT,
    "virtualAccountBank" TEXT,
    "amountKobo" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "cashApprovalStatus" "CashApprovalStatus",
    "cashApprovedById" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "branchId" TEXT,
    "campaignId" TEXT,
    "account" "LedgerAccount" NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "type" "DomainEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "branchId" TEXT,
    "paymentId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignBalance" (
    "campaignId" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "totalRaisedKobo" BIGINT NOT NULL DEFAULT 0,
    "totalRefundedKobo" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignBalance_pkey" PRIMARY KEY ("campaignId")
);

-- CreateTable
CREATE TABLE "MemberGivingSummary" (
    "memberId" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "totalGivenKobo" BIGINT NOT NULL DEFAULT 0,
    "lastGivingAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberGivingSummary_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE INDEX "DonationIntent_churchId_status_idx" ON "DonationIntent"("churchId", "status");

-- CreateIndex
CREATE INDEX "DonationIntent_campaignId_idx" ON "DonationIntent"("campaignId");

-- CreateIndex
CREATE INDEX "DonationIntent_memberId_idx" ON "DonationIntent"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "DonationIntent_churchId_idempotencyKey_key" ON "DonationIntent"("churchId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerReference_key" ON "PaymentAttempt"("providerReference");

-- CreateIndex
CREATE INDEX "PaymentAttempt_churchId_status_createdAt_idx" ON "PaymentAttempt"("churchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_donationIntentId_idx" ON "PaymentAttempt"("donationIntentId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_churchId_createdAt_idx" ON "LedgerTransaction"("churchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_dedupeKey_key" ON "LedgerEntry"("dedupeKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_churchId_createdAt_idx" ON "LedgerEntry"("churchId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_campaignId_entryType_idx" ON "LedgerEntry"("campaignId", "entryType");

-- CreateIndex
CREATE INDEX "DomainEvent_churchId_createdAt_idx" ON "DomainEvent"("churchId", "createdAt");

-- CreateIndex
CREATE INDEX "RefundRequest_churchId_status_idx" ON "RefundRequest"("churchId", "status");

-- CreateIndex
CREATE INDEX "RefundRequest_paymentId_idx" ON "RefundRequest"("paymentId");

-- CreateIndex
CREATE INDEX "AuditLog_churchId_createdAt_idx" ON "AuditLog"("churchId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "CampaignBalance_churchId_idx" ON "CampaignBalance"("churchId");

-- CreateIndex
CREATE INDEX "MemberGivingSummary_churchId_idx" ON "MemberGivingSummary"("churchId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentAttemptId_key" ON "Payment"("paymentAttemptId");

-- CreateIndex
CREATE INDEX "Payment_churchId_idx" ON "Payment"("churchId");

-- CreateIndex
CREATE INDEX "WebhookEvent_churchId_idx" ON "WebhookEvent"("churchId");

-- AddForeignKey
ALTER TABLE "DonationIntent" ADD CONSTRAINT "DonationIntent_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationIntent" ADD CONSTRAINT "DonationIntent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationIntent" ADD CONSTRAINT "DonationIntent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationIntent" ADD CONSTRAINT "DonationIntent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationIntent" ADD CONSTRAINT "DonationIntent_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "Pledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_donationIntentId_fkey" FOREIGN KEY ("donationIntentId") REFERENCES "DonationIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_cashApprovedById_fkey" FOREIGN KEY ("cashApprovedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBalance" ADD CONSTRAINT "CampaignBalance_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBalance" ADD CONSTRAINT "CampaignBalance_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberGivingSummary" ADD CONSTRAINT "MemberGivingSummary_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberGivingSummary" ADD CONSTRAINT "MemberGivingSummary_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial index: Prisma's schema language has no native partial-index syntax.
-- WHERE publishedAt IS NULL is the "still needs relaying" set #106's outbox
-- worker polls.
CREATE INDEX "DomainEvent_unpublished_idx" ON "DomainEvent" ("createdAt") WHERE "publishedAt" IS NULL;
