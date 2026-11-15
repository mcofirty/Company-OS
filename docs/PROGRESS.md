# PROGRESS — registre de reprise

## Convention de mise à jour
Pour chaque changement : horodatage UTC, commit (si disponible), tâches terminées, commandes et résultats exacts, écarts connus, prochaine action.

## Session 2026-11-15 (2) — Alignement M0 sur les specs + M1 (vertical slice)

**Milestone courant : M1 terminé. Prochain : M2.**

### Réalisé
- Pack de specs rangé (`docs/`, `specs/`, `examples/`, `references/`), ADR fusionnés.
- **Contrats** (`packages/contracts`) : enveloppe v1 conforme à `specs/events.schema.json` (eventId, orgId, seq par org,
  aggregate*, correlation/causation, provenance, classification), 14 types de payloads M1 (agent, task, run, tool.invocation),
  statuts + transitions (docs/03 §4), catalogue 8 outils + 7 tâches démo, snapshot bootstrap, protocole Socket, codes d'erreur.
  Test de contrat : enum Zod == enum JSON Schema ; l'exemple `agent-tool-cycle.json` valide l'enveloppe.
- **Monde** (`packages/world`) : carte hq-v1 36×26 (6 départements + réunion + café + accueil, cloisons, portes, mobilier,
  ancres desk/meeting_seat/cafe/entry), A* 4-directions, réducteur idempotent avec détection de trou, KPI, projection visuelle
  (bureau / pause café cosmétique / pose travail-outil), présence « X/Y au poste ».
- **DB** (`packages/db`) : schéma M1 (organizations, users, memberships, departments, agents, agent_tool_grants, tools, tasks,
  agent_runs, tool_invocations, event_log, outbox, idempotency_keys). `withOrgTx` = seul chemin d'écriture (verrou ligne org,
  seq contigu, event_log + outbox dans la même transaction). Services tâches/invocations avec transitions vérifiées et
  concurrence optimiste. Seed relançable : 12 agents, 6 départements, 8 outils, admin local.
- **Outils** (`packages/tools`) : `ToolGateway` (grant explicite, risque : external_write -> APPROVAL_REQUIRED, high_impact refusé,
  kill switch, échec fermé démo, Zod, timeout, retry borné), 9 adaptateurs démo déterministes (ERP fetch_invoice = 503 simulé).
- **Worker** (`apps/worker`) : exécute les tâches sans navigateur, une par agent, concurrence bornée, reprise après crash
  (étapes idempotentes), autopilote démo déterministe et étiqueté (`actor: demo-autopilot`).
- **API** (`apps/api`) : `/health/live`, `/health/ready`, `/v1/me|bootstrap|departments|agents|agents/:id|tasks|tasks/:id|tools|
  tool-invocations|tool-invocations/:id|events`, `POST /v1/tasks` (Idempotency-Key obligatoire, rôle operator+), enveloppes
  `{data,meta}` / `{error:{code,message,requestId}}`, principal de dev limité (dev/test + démo + localhost), Socket.IO
  `events:resume` / `domain:event` / `sync:required`, relais outbox.
- **Web** (`apps/web`) : cockpit 1 écran — topbar (DEMO, 6 KPI), rail (recentrer/zoom), carte Phaser isométrique pixel art
  procédurale (murs, fenêtres, enseigne, cloisons colorées, bureaux avec écrans reflétant l'état réel, plantes, café, accueil),
  12 avatars (8 variantes, marche A* animée, pose travail, chip outil / BLOQUÉ / PAUSE), badges de département, pan/zoom,
  hitbox découplée ; panneau droit inspecteur (agent, tâche, invocation, département, outil) ou liste Équipe (alternative
  HTML) ; mur des outils Actifs/Récents (durées depuis les horodatages persistés) ; timeline live cliquable ; toasts.

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK (7 packages) · `pnpm build` OK.
- `pnpm test` : **46 tests passés** (contrats 8, monde 8, DB 9, workflow/worker 9, API 12) — dont S02, S04, S07, S09,
  reprise après crash, seq contigu sous concurrence, projection serveur = rejeu client.
- `pnpm e2e` : **5 tests passés** — S01 premier affichage, clic avatar dans le canvas -> inspecteur, S02 cycle complet + refresh,
  S03 coupure WebSocket en plein run (aucun événement perdu/doublé), S04 erreur ERP visible.
- Captures : `docs/screenshots/m1-cockpit-1440.png`, `docs/screenshots/m1-cockpit-1920.png`.
- CI : `.github/workflows/ci.yml` (lint/typecheck/test/build + job e2e) — **écrit, pas encore exécuté sur GitHub**.

### Écarts connus
- Temporal pas encore branché (frontière : `apps/worker/src/workflows`), prévu M2 avec le vrai agent.
- Pas d'approbations, réunions, création d'agent via RH, replay, overlay agent→outil, recherche Ctrl+K (M3/M4).
- Auth réelle absente : seul le principal de dev local existe (refusé hors démo/dev/localhost).
- Performances (fps, p95) non mesurées. Régression visuelle non outillée.
- Les incidents KPI = tâches bloquées/échouées dans la fenêtre bornée du snapshot (pas encore de fenêtres 1h/24h).

### Prochaine tâche exacte
M2 : `packages/agents` (LLMProvider + adaptateur Anthropic, AgentRunner borné maxSteps/coût/timeout), Temporal dans
docker-compose + workflow `qualifyLead`, table `llm_usage` + coûts mesurés/estimés, budgets hard/soft, redaction et
tests de prompt injection ; tout reste testable en démo sans clé.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev            # API :4000, worker, web :3000
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build
```

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

> Remplacé par la session M0-alignement + M1 ci-dessous (enveloppe d'événements, schéma et UI refaits selon les specs).
