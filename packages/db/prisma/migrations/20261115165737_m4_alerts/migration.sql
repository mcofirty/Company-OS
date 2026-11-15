-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "event_seq" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "acked_at" TIMESTAMPTZ(3),
    "acked_by" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_org_id_acked_at_event_seq_idx" ON "alerts"("org_id", "acked_at", "event_seq");
