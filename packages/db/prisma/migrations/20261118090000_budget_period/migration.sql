-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "period_start" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- Lignes existantes : période = mois en cours (UTC).
UPDATE "budgets" SET "period_start" = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
