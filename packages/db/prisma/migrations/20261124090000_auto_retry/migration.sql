-- Reprise automatique des échecs techniques : nombre d'essais automatiques et date au plus tôt.
ALTER TABLE "tasks" ADD COLUMN "auto_retries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN "not_before" TIMESTAMPTZ(3);
