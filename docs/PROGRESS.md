# PROGRESS — registre de reprise

## Convention de mise à jour
Pour chaque changement : horodatage UTC, commit (si disponible), tâches terminées, commandes et résultats exacts, écarts connus, prochaine action.

## Session 2026-11-15 (3) — M2 : agent LLM borné, outils sécurisés, coûts, Temporal

**Milestone courant : M2 terminé (parcours LIVE réel non vérifié faute de clé). Prochain : M3.**

### Réalisé
- **Temporal** : service `temporal` dans `docker-compose.yml` (dev server 1.5.1, UI http://localhost:8233). Workflow
  `agentTaskWorkflow` (apps/worker/src/workflows) : la boucle d'agent est déterministe, chaque appel modèle / outil /
  préparation / clôture est une Activity avec timeout et retries. `workflowId = agent-task-<taskId>` (démarrage idempotent).
  Mode `ORCHESTRATOR=inline` conservé pour les tests sans serveur.
- **`packages/agents`** : interface `LLMProvider` ; `AnthropicProvider` (SDK officiel, Messages API + tool use, effort
  explicite, repli serveur `fallbacks: "default"`, outils `strict`, erreurs classées retryable/définitive) ;
  `ScriptedDemoProvider` (démo déterministe, même protocole, zéro appel) ; `MockProvider` (tests). Prompts runtime
  versionnés (docs/13, `PROMPT_VERSION`), sorties d'outils encapsulées `<donnees_non_fiables>`, résultat final via
  `submit_result` validé par Zod (`AgentResult`). Boucle bornée : `maxSteps`, durée, plafond de coût du run, relance unique
  sans résultat, refus modèle, `needs_approval` -> tâche bloquée.
- **`packages/policies`** : rédaction (emails, téléphones, IBAN, cartes, secrets), arithmétique de budget (réserve,
  seuil, pas de division par zéro), tarification depuis `config/llm-pricing.json` (versionnée, datée ; coût = « estimé »).
- **DB (migration `m2_agents_costs_budgets`)** : `agent_versions` (instructions + politique modèle + limites, immuables),
  `llm_usage` (unique par run+étape), `budgets` (org/agent, plafond dur, alerte 80 %), usage cumulé sur `agent_runs`.
  Kill switch (`system.paused/resumed`), `budget.threshold_reached`, usage dans `agent.run.completed`.
- **Gateway** : sorties redigées avant stockage et avant renvoi au modèle ; tout appel d'outil (même non autorisé)
  est audité puis refusé. Fixture d'injection de prompt dans le CRM démo.
- **API** : `POST /v1/system/pause|resume` (admin, Idempotency-Key), `GET /v1/budgets`, détail des runs dans
  `GET /v1/tasks/:id` (fournisseur, modèle, version, workflow, tokens, coût par appel).
- **Web** : KPI coût IA réel (micro-dollars, « estimé » / « aucun appel LLM »), bouton Pause système avec confirmation,
  bannière de pause, carte de run dans l'inspecteur de tâche, budget de l'agent, nouveaux événements dans la timeline.
- `pnpm agent:live-smoke` : exécute UNE tâche avec le vrai modèle Anthropic (org live séparée, outils démo, budget $2).

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK (9 packages) · `pnpm build` OK.
- `pnpm test` : **72 tests passés** (8 fichiers) dont : boucle bornée (maxSteps, coût, refus, résultat invalide),
  requête Anthropic construite via fetch simulé (aucun réseau), parcours live avec MockProvider (coûts estimés, budgets
  imputés, alerte 80 %, plafond dur avant tout appel, fournisseur absent = échec fermé), **injection de prompt** (donnée
  encapsulée, PII rédigée, `send_email` refusé et audité), kill switch, reprise après crash, **workflow sur un vrai
  serveur Temporal** (idempotence du démarrage, activités dans l'historique).
- `pnpm e2e` : **7 tests passés** (stack complète avec orchestration Temporal) dont inspecteur de run et kill switch (S12).
- Constaté manuellement : un worker tué en plein run -> le workflow reprend au redémarrage (tâches terminées sans doublon).
- Capture : `docs/screenshots/m2-run-inspector-1440.png`.
- **Non vérifié** : appel réel à l'API Anthropic (`ANTHROPIC_API_KEY` absente ; `pnpm agent:live-smoke` refuse proprement).

### Écarts connus
- Cockpit et worker continus en mode LIVE non ouverts : nécessitent une vraie authentification (M5). Le live se vérifie
  via `pnpm agent:live-smoke`.
- OpenTelemetry reporté à M5 (logs JSON corrélés en attendant). Pas d'approbations (M3) : toute écriture externe est refusée.
- Si une activité modèle est rejouée après l'appel mais avant l'enregistrement, le second appel n'est pas compté (idempotence
  par étape) : sous-estimation possible, documentée.
- Budgets affichés côté client mis à jour à la fin du run (le contrôle serveur, lui, est fait avant chaque appel).

### Prochaine tâche exacte
M3 : `approval_requests` + `approval.requested/decided` (signal Temporal de reprise), réunions (`meeting.started/completed`,
sièges réservés), proposition RH -> approbation admin -> `agent.created/activated` avec spawn à l'accueil, délégation
bornée (profondeur 3, cycles rejetés), inspecteurs réunion/approbation.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait          # PostgreSQL + Temporal (UI :8233)
pnpm db:migrate && pnpm db:seed
pnpm dev                             # API :4000, worker Temporal, web :3000
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build
ANTHROPIC_API_KEY=... pnpm agent:live-smoke   # optionnel, appel réel payant
```

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
