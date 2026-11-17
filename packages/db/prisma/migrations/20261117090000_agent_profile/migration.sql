-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "routines" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];

