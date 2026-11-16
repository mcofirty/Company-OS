-- AlterTable
ALTER TABLE "tools" ADD COLUMN     "archived_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "connectors" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "tool_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret_sealed" TEXT,
    "auth_header" TEXT NOT NULL DEFAULT 'authorization',
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "last_error" TEXT,
    "last_sync_at" TIMESTAMPTZ(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_tools" (
    "connector_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "remote_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "input_schema" JSONB NOT NULL,
    "policy" TEXT NOT NULL DEFAULT 'approval',
    "read_only_hint" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_tools_pkey" PRIMARY KEY ("connector_id","action")
);

-- CreateIndex
CREATE UNIQUE INDEX "connectors_tool_id_key" ON "connectors"("tool_id");

-- CreateIndex
CREATE INDEX "connectors_org_id_idx" ON "connectors"("org_id");

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_tools" ADD CONSTRAINT "connector_tools_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

