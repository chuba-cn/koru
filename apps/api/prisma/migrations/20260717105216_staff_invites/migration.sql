-- CreateTable
CREATE TABLE "StaffInvite" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvite_staffId_idx" ON "StaffInvite"("staffId");

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
