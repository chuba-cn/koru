ALTER TYPE "CampaignScopeType" RENAME TO "ScopeLevel";

ALTER TABLE "SettlementAccount"
  ADD COLUMN "scopeType" "ScopeLevel" NOT NULL DEFAULT 'church',
  ADD COLUMN "scopeRefId" TEXT;

UPDATE "SettlementAccount"
  SET "scopeType" = 'branch', "scopeRefId" = "branchId"
  WHERE "branchId" IS NOT NULL;

ALTER TABLE "SettlementAccount" ALTER COLUMN "scopeType" DROP DEFAULT;

ALTER TABLE "SettlementAccount" DROP CONSTRAINT "SettlementAccount_branchId_fkey";

DROP INDEX "SettlementAccount_branchId_idx";

ALTER TABLE "SettlementAccount" DROP COLUMN "branchId";

CREATE INDEX "SettlementAccount_churchId_scopeType_scopeRefId_idx"
  ON "SettlementAccount"("churchId", "scopeType", "scopeRefId");

-- Prisma's schema language has no CHECK. Hand-written here on purpose; a later
-- migrate dev does not see it and does not report drift.
ALTER TABLE "SettlementAccount"
  ADD CONSTRAINT "SettlementAccount_scope_ref_null_iff_church"
  CHECK (("scopeType" = 'church') = ("scopeRefId" IS NULL));

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_scope_ref_null_iff_church"
  CHECK (("scopeType" = 'church') = ("scopeRefId" IS NULL));