-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('staff_invite', 'staff_removed', 'church_welcome', 'payment_confirmation', 'campaign_broadcast', 'auth_verification', 'auth_password_reset');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed');

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientStaffId" TEXT,
    "recipientMemberId" TEXT,
    "subject" TEXT NOT NULL,
    "renderedHtml" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'queued',
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_providerMessageId_key" ON "EmailLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailLog_churchId_idx" ON "EmailLog"("churchId");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_recipientStaffId_fkey" FOREIGN KEY ("recipientStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_recipientMemberId_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
