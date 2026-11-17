-- AlterTable
ALTER TABLE "connectors" ADD COLUMN     "app" TEXT,
ADD COLUMN     "auth_kind" TEXT NOT NULL DEFAULT 'token',
ADD COLUMN     "oauth_sealed" TEXT,
ADD COLUMN     "url_sealed" TEXT;

-- CreateTable
CREATE TABLE "oauth_sessions" (
    "state" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "app" TEXT,
    "name" TEXT NOT NULL,
    "server_url" TEXT NOT NULL,
    "data_sealed" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "oauth_sessions_pkey" PRIMARY KEY ("state")
);

