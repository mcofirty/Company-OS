-- Rapport quotidien sur téléphone : heure d'envoi, fuseau, dernier envoi (anti-doublon).
ALTER TABLE "notification_settings" ADD COLUMN "daily_hour" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "notification_settings" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris';
ALTER TABLE "notification_settings" ADD COLUMN "last_daily_at" TIMESTAMPTZ(3);
