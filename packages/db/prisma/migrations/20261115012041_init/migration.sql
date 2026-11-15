-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('demo', 'live');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "activity" TEXT,
    "posX" INTEGER NOT NULL,
    "posY" INTEGER NOT NULL,
    "mode" "Mode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "seq" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" BIGSERIAL NOT NULL,
    "eventSeq" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_companyId_idx" ON "Agent"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_id_key" ON "Event"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Event_idempotencyKey_key" ON "Event"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Event_companyId_seq_idx" ON "Event"("companyId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_eventSeq_key" ON "OutboxMessage"("eventSeq");

-- CreateIndex
CREATE INDEX "OutboxMessage_publishedAt_id_idx" ON "OutboxMessage"("publishedAt", "id");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_eventSeq_fkey" FOREIGN KEY ("eventSeq") REFERENCES "Event"("seq") ON DELETE RESTRICT ON UPDATE CASCADE;
