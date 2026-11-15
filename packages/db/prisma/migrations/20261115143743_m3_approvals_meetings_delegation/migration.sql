-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parent_task_id" UUID;

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "agent_id" TEXT NOT NULL,
    "task_id" UUID,
    "invocation_id" UUID,
    "tool_id" TEXT,
    "action" TEXT,
    "risk_reason" TEXT NOT NULL,
    "safe_preview" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "decision_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "initiator_agent_id" TEXT NOT NULL,
    "task_id" UUID,
    "invocation_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "summary" TEXT,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "task_ids_created" TEXT[],

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "meeting_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "seat_anchor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("meeting_id","agent_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_invocation_id_key" ON "approval_requests"("invocation_id");

-- CreateIndex
CREATE INDEX "approval_requests_org_id_status_requested_at_idx" ON "approval_requests"("org_id", "status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_org_id_idempotency_key_key" ON "approval_requests"("org_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_invocation_id_key" ON "meetings"("invocation_id");

-- CreateIndex
CREATE INDEX "meetings_org_id_status_idx" ON "meetings"("org_id", "status");

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
