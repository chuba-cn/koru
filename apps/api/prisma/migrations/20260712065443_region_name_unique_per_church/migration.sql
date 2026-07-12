/*
  Warnings:

  - A unique constraint covering the columns `[churchId,name]` on the table `Region` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Region_churchId_name_key" ON "Region"("churchId", "name");
