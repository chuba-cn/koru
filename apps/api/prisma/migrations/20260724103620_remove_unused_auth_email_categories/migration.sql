/*
  Warnings:

  - The values [auth_verification,auth_password_reset] on the enum `EmailCategory` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EmailCategory_new" AS ENUM ('staff_invite', 'staff_removed', 'church_welcome', 'payment_confirmation', 'campaign_broadcast');
ALTER TABLE "EmailLog" ALTER COLUMN "category" TYPE "EmailCategory_new" USING ("category"::text::"EmailCategory_new");
ALTER TYPE "EmailCategory" RENAME TO "EmailCategory_old";
ALTER TYPE "EmailCategory_new" RENAME TO "EmailCategory";
DROP TYPE "public"."EmailCategory_old";
COMMIT;
