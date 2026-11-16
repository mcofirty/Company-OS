-- Organisations live : outils fictifs refusés par défaut.
ALTER TABLE "organizations" ADD COLUMN "allow_demo_tools" BOOLEAN NOT NULL DEFAULT false;

-- Documents réels produits par les agents.
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "task_id" UUID,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documents_org_id_created_at_idx" ON "documents"("org_id", "created_at");
CREATE INDEX "documents_task_id_idx" ON "documents"("task_id");
