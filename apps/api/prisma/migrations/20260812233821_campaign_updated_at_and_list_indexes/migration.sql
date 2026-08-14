/*
  Warnings:

  - Added the required column `updatedAt` to the `Campaign` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Campaign_churchId_idx";

-- DropIndex
DROP INDEX "Campaign_scopeType_scopeRefId_idx";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Campaign" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Campaign_churchId_status_scopeType_scopeRefId_idx" ON "Campaign"("churchId", "status", "scopeType", "scopeRefId");

-- CreateIndex
CREATE INDEX "Campaign_churchId_title_id_idx" ON "Campaign"("churchId", "title", "id");
