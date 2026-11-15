# Company OS — Living HQ

Supervision d'une entreprise opérée par des agents IA, sous la forme d'un QG isométrique en pixel art.
Instructions de développement : voir [`CLAUDE.md`](CLAUDE.md). État d'avancement : [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Démarrage

Prérequis : Node ≥ 22.12, pnpm 10, Docker.

```bash
cp .env.example .env
pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev            # API :4000, worker demo, web :3000
```

Ouvrir http://localhost:3000. Le badge **MODE DÉMO** signale une simulation déterministe, sans aucun appel externe.

## Vérifications

```bash
pnpm lint && pnpm typecheck && pnpm test   # tests unitaires + intégration (base companyos_test)
pnpm e2e                                    # Playwright (lance pnpm dev si besoin)
pnpm build
```

## Structure

| Dossier              | Rôle                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `packages/contracts` | Schémas Zod : événements, snapshot du monde, protocole Socket.IO    |
| `packages/world`     | Projection pure événements → état du monde (idempotente)            |
| `packages/db`        | Prisma/PostgreSQL : EventLog, outbox transactionnelle, état courant |
| `apps/api`           | Fastify + Socket.IO : snapshot, rejeu, relais outbox → temps réel   |
| `apps/worker`        | Simulateur demo déterministe (Temporal prévu, cf. DECISIONS)        |
| `apps/web`           | Next.js + Phaser : QG isométrique, inspecteur, journal              |
