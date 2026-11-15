-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "agent_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "cost_micros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cost_source" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "llm_calls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "output_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workflow_id" TEXT;

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "active_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "agent_versions" (
    "id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "model_policy" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_run_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL,
    "cache_write_tokens" INTEGER NOT NULL,
    "cost_micros" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "measured_or_estimated" TEXT NOT NULL,
    "pricing_version" TEXT NOT NULL,
    "stop_reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'month',
    "limit_micros" INTEGER NOT NULL,
    "used_micros" INTEGER NOT NULL DEFAULT 0,
    "reserved_micros" INTEGER NOT NULL DEFAULT 0,
    "hard_stop" BOOLEAN NOT NULL DEFAULT true,
    "alert_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "alerted_at" TIMESTAMPTZ(3),

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agent_id_version_key" ON "agent_versions"("agent_id", "version");

-- CreateIndex
CREATE INDEX "llm_usage_org_id_created_at_idx" ON "llm_usage"("org_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "llm_usage_agent_run_id_step_key" ON "llm_usage"("agent_run_id", "step");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_org_id_scope_type_scope_id_period_key" ON "budgets"("org_id", "scope_type", "scope_id", "period");

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
