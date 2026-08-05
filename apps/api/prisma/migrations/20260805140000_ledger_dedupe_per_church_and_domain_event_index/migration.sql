-- LedgerEntry.dedupeKey was unique across every church, so two different
-- churches could never use the same key string even though the idempotency
-- guarantee it exists for is per-posting, not global. Scope it to
-- (churchId, dedupeKey) instead.
DROP INDEX "LedgerEntry_dedupeKey_key";
CREATE UNIQUE INDEX "LedgerEntry_churchId_dedupeKey_key" ON "LedgerEntry"("churchId", "dedupeKey");

-- DomainEvent_unpublished_idx (a partial index, WHERE "publishedAt" IS NULL)
-- was declared only in raw migration SQL, with nothing matching it in
-- schema.prisma — Prisma's schema DSL has no syntax for a partial index.
-- Replace it with a full (publishedAt, createdAt) index that schema.prisma
-- can track, so a future `prisma migrate dev` cannot compute this as drift
-- and drop the index the relay's once-a-second claim query depends on.
-- Build before drop: if CREATE INDEX CONCURRENTLY fails, the relay still
-- has a working index instead of none.
CREATE INDEX CONCURRENTLY "DomainEvent_publishedAt_createdAt_idx" ON "DomainEvent"("publishedAt", "createdAt");
DROP INDEX "DomainEvent_unpublished_idx";
