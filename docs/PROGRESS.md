# Progression

## Session 2026-11-15 — M0 (fondations)

### Réalisé

- Monorepo pnpm, TypeScript strict, ESLint (strict, `no-explicit-any`), Prettier, Vitest, Playwright.
- `docker-compose.yml` : PostgreSQL 16 (+ base `companyos_test`).
- `packages/contracts` : événements `agent.spawned`, `agent.moved`, `agent.status_changed` (union discriminée Zod),
  snapshot du monde, protocole Socket.IO, plan du bureau.
- `packages/db` : migration Prisma `init` (Company, Agent, Event, OutboxMessage), `appendEvents` transactionnel
  (verrou par entreprise, validation, état + journal + outbox, idempotency key, séparation demo/live), snapshot
  cohérent, rejeu, relais outbox, seed demo idempotent.
- `apps/api` : `/health`, `GET /api/companies/:id/world|events|agents/:agentId`, Socket.IO `world:subscribe`
  avec rejeu depuis `afterSeq`, relais outbox → rooms.
- `apps/worker` : simulateur demo déterministe (PRNG seedé par `lastSeq`), indépendant du navigateur.
- `apps/web` : QG isométrique Phaser (sol, murs, bureaux avec écrans qui s'allument quand l'agent travaille,
  salle de réunion, café), avatars pixel art animés (marche tuile par tuile, apparition animée), clic avatar →
  inspecteur (état + trace d'actions), roster, KPI, journal temps réel, badge MODE DÉMO, état de connexion.

### Tests (exécutés)

- `pnpm test` : 21 tests passés (contrats, projection, DB/outbox/concurrence/idempotence, API HTTP + Socket.IO, simulateur).
- `pnpm e2e` : 4 tests passés (badge démo, clic avatar dans le canvas → inspecteur, flux temps réel, reprise après coupure WebSocket).
- `pnpm lint`, `pnpm typecheck`, `pnpm build` : OK.
- Capture : `docs/screenshots/m0-hq-1440.png` (1440x900).

### Écarts / non fait

- Docs de spec (`docs/01..09`, `START_HERE.md`, `specs/`, `references/`) absents : M0 interprété depuis `CLAUDE.md`.
- Pas encore de Temporal, de vrais agents LLM, d'outils, de tâches, d'alertes, de politiques, de kill switch ni de mode live.
- Pas de Dockerfiles applicatifs (seul PostgreSQL est conteneurisé).
- Validation visuelle en 1920x1080 non capturée.

### Prochaine tâche exacte

1. Ajouter les docs de spec manquants, puis réaligner contrats et jalons sur `docs/09-PLAN-IMPLEMENTATION.md`.
2. M1 : modèle Task + événements `task.*`, panneau tâches et alertes, inspecteur de tâche ; introduire Temporal
   (service compose + worker) pour la boucle d'agent bornée (budget, étapes, timeout, kill switch).

### Commandes de reprise

```bash
cp .env.example .env && pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e
```
