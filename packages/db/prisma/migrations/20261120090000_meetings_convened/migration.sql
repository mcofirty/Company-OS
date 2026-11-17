-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "agenda" TEXT,
ADD COLUMN     "convened_by" TEXT,
ADD COLUMN     "ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "minutes_wanted" BOOLEAN NOT NULL DEFAULT false;

