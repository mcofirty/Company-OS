-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "cost_cap_micros" INTEGER,
ADD COLUMN     "follow_up_of" UUID,
ADD COLUMN     "schedule_id" UUID;

-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "weekday" INTEGER,
    "month_day" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "max_cost_micros" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "last_run_at" TIMESTAMPTZ(3),
    "last_task_id" UUID,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "org_id" UUID NOT NULL,
    "url_sealed" TEXT NOT NULL,
    "token_sealed" TEXT,
    "email" TEXT,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE INDEX "schedules_enabled_next_run_at_idx" ON "schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "schedules_org_id_idx" ON "schedules"("org_id");

