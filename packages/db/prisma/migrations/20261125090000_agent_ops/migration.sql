-- Objectifs de pôle, contrôle qualité, retours de l'humain, missions en chaîne.
CREATE TABLE "objectives" (
  "id" UUID NOT NULL PRIMARY KEY,
  "org_id" UUID NOT NULL REFERENCES "organizations"("id"),
  "department_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "target" INTEGER NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_end" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "objectives_org_id_status_idx" ON "objectives"("org_id", "status");

CREATE TABLE "agent_feedback" (
  "id" UUID NOT NULL PRIMARY KEY,
  "org_id" UUID NOT NULL REFERENCES "organizations"("id"),
  "agent_id" TEXT NOT NULL,
  "task_id" UUID,
  "kind" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "agent_feedback_org_id_agent_id_created_at_idx" ON "agent_feedback"("org_id", "agent_id", "created_at");

CREATE TABLE "mission_chains" (
  "id" UUID NOT NULL PRIMARY KEY,
  "org_id" UUID NOT NULL REFERENCES "organizations"("id"),
  "template_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "steps" JSONB NOT NULL,
  "current_step" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'running',
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mission_chains_org_id_status_idx" ON "mission_chains"("org_id", "status");

ALTER TABLE "tasks" ADD COLUMN "objective_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "objective_counts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tasks" ADD COLUMN "quality_check" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "review_of" UUID;
ALTER TABLE "tasks" ADD COLUMN "review_status" TEXT;
ALTER TABLE "tasks" ADD COLUMN "review_notes" TEXT;
ALTER TABLE "tasks" ADD COLUMN "chain_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "chain_step" INTEGER;
CREATE INDEX "tasks_objective_id_idx" ON "tasks"("objective_id");
