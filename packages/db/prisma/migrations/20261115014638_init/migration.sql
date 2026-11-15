-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('demo', 'live');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('demo', 'live', 'imported');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('admin', 'operator', 'viewer');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "last_seq" BIGINT NOT NULL DEFAULT 0,
    "kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("org_id","user_id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "manager_agent_id" TEXT,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "manager_id" TEXT,
    "avatar_id" TEXT NOT NULL,
    "desk_anchor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "activity" TEXT NOT NULL DEFAULT 'idle',
    "current_task_id" UUID,
    "last_task_ended_at" TIMESTAMPTZ(3),
    "provenance" "Provenance" NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_grants" (
    "agent_id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "actions" TEXT[],
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_grants_pkey" PRIMARY KEY ("agent_id","tool_id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL,
    "org_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'healthy',

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "agent_id" TEXT NOT NULL,
    "requester_type" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "provenance" "Provenance" NOT NULL,
    "idempotency_key" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "result_summary" TEXT,
    "result_ref" TEXT,
    "failure_code" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "task_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "outcome_summary" TEXT,
    "failure_code" TEXT,
    "provenance" "Provenance" NOT NULL,
    "start_event_id" UUID NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_invocations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "tool_id" TEXT NOT NULL,
    "agent_run_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "task_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "action_kind" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "redacted_input" JSONB NOT NULL,
    "safe_summary" TEXT,
    "duration_ms" INTEGER,
    "idempotency_key" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "correlation_id" UUID NOT NULL,
    "provenance" "Provenance" NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "error_code" TEXT,

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_log" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "provenance" "Provenance" NOT NULL,
    "classification" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" BIGSERIAL NOT NULL,
    "org_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "response_ref" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("org_id","key","operation")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_subject_key" ON "users"("provider_subject");

-- CreateIndex
CREATE INDEX "departments_org_id_idx" ON "departments"("org_id");

-- CreateIndex
CREATE INDEX "agents_org_id_department_id_status_idx" ON "agents"("org_id", "department_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_org_id_desk_anchor_key" ON "agents"("org_id", "desk_anchor");

-- CreateIndex
CREATE INDEX "tasks_org_id_status_created_at_idx" ON "tasks"("org_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_org_id_idempotency_key_key" ON "tasks"("org_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "agent_runs_task_id_started_at_idx" ON "agent_runs"("task_id", "started_at");

-- CreateIndex
CREATE INDEX "tool_invocations_org_id_status_requested_at_idx" ON "tool_invocations"("org_id", "status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "tool_invocations_org_id_idempotency_key_key" ON "tool_invocations"("org_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "event_log_correlation_id_idx" ON "event_log"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_log_org_id_seq_key" ON "event_log"("org_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_event_id_key" ON "outbox"("event_id");

-- CreateIndex
CREATE INDEX "outbox_status_next_attempt_at_idx" ON "outbox"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
