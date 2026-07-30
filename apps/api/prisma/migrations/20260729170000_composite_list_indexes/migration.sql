-- Region/Branch already have @@unique([churchId, name]); the plain
-- single-column index is redundant, so it is dropped with no replacement.
DROP INDEX "Region_churchId_idx";
DROP INDEX "Branch_churchId_idx";

-- Build before drop: if CREATE INDEX CONCURRENTLY fails, the table still
-- has a working churchId index instead of none.
CREATE INDEX CONCURRENTLY "SettlementAccount_churchId_label_id_idx" ON "SettlementAccount"("churchId", "label", "id");
DROP INDEX "SettlementAccount_churchId_idx";
