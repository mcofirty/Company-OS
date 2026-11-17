-- Optimisation automatique du modèle (ADR-066) : niveau imposé par mission, raison du choix par exécution.
ALTER TABLE "tasks" ADD COLUMN "model_tier" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "model_reason" TEXT;
