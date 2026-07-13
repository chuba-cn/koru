/*
  Warnings:

  - A unique constraint covering the columns `[churchId,name]` on the table `Branch` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Branch_churchId_name_key" ON "Branch"("churchId", "name");
