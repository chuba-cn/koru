-- CreateIndex
-- CONCURRENTLY avoids taking a write lock for the build's duration; Prisma
-- runs any statement containing CONCURRENTLY outside its per-migration
-- transaction.
CREATE INDEX CONCURRENTLY "Staff_churchId_fullName_id_idx" ON "Staff"("churchId", "fullName", "id");
