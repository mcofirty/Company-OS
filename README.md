# AI COMPANY OS — Living Headquarters

**Statut :** application en construction par jalons (voir `docs/PROGRESS.md`). Le pack de spécifications d'origine est dans `docs/`, `specs/` et `examples/`.

**Référence visuelle privée :** `references/REFERENCE-UI-ISOMETRIQUE.jpeg`, à utiliser comme inspiration uniquement et à retirer avant tout dépôt public si droits de redistribution absents.

## Vision
Un centre de commande desktop unique : bureau isométrique pixel-art avec avatars d'agents IA et interactions réelles, outils utilisés en direct, flux de tâches, réunions, gouvernance, coûts, validation humaine et audit.

## Commencer
1. Copier ou extraire tout le contenu du pack **à la racine du nouveau dépôt**, y compris les fichiers cachés `.claude/` si présents.
2. Démarrer Claude Code à la racine du dépôt et choisir Fable 5.2 (Claude Code compatible, selon abonnement/version).
3. Coller le prompt de `PROMPT-A-LANCER-DANS-CLAUDE.md` dans Claude Code.
4. Laisser Claude lire `CLAUDE.md` et implémenter `START_HERE.md` par jalons.
5. Conserver `docs/PROGRESS.md` comme registre de reprise d'une session à l'autre.

## Sommaire
- `CLAUDE.md` : règles pérennes courtes pour l'agent développeur.
- `START_HERE.md` : mission et procédure d'exécution.
- `PROMPT-A-LANCER-DANS-CLAUDE.md` : message de démarrage prêt à coller.
- `docs/01-PRODUIT-ET-UX.md` : vision produit, fonctionnalités et layout.
- `docs/02-ARCHITECTURE.md` : architecture en couches, monorepo, choix.
- `docs/03-DONNEES.md` : schéma logique, contraintes, états.
- `docs/04-AGENTS-ET-ORCHESTRATION.md` : hiérarchie, tâches, meetings, runtime.
- `docs/05-OUTILS-ET-SECURITE.md` : catalogue d'outils, contrôle d'accès, budget.
- `docs/06-MONDE-ISOMETRIQUE.md` : carte, sprites, animation, pathfinding.
- `docs/07-API-TEMPS-REEL.md` : endpoints, événements, reconnexion.
- `docs/08-TESTS-CRITERES.md` : DoD, performance, tests et qualité.
- `docs/09-PLAN-IMPLEMENTATION.md` : milestones M0-M5 et ordre.
- `docs/10-OBSERVABILITE.md` : logs, tracing, coûts, santé, replay.
- `docs/11-DEPLOIEMENT.md` : local, staging, production, sauvegardes.
- `docs/12-SCENARIOS.md` : parcours et tests métier end-to-end.
- `docs/13-PROMPTS-ET-AGENT-CONFIG.md` : modèles des prompts runtime et règles d’évaluation.
- `docs/14-DESIGN-SYSTEM.md` : direction artistique et catalogue des composants UI.
- `GUIDE-IMPORT-GITHUB.md` : procédure pour un dépôt réellement vide.
- `docs/DECISIONS.md` : registre des décisions d'architecture.
- `docs/PROGRESS.md` : état d'avancement (à maintenir).
- `docs/REFERENCES.md` : documentation publique consultée.
- `specs/events.schema.json` : enveloppe contractuelle événementielle.
- `examples/` : exemples JSON et scénarios de référence.

## Attention
L'**orchestration d'agents** et la **visualisation d'agents** sont des systèmes distincts. Un avatar qui tape au clavier n'est pas la preuve qu'un LLM travaille. Le backend doit enregistrer un état vérifiable ; le front le représente honnêtement.

## Évolutivité
Le MVP vise un seul tenant et 8-12 agents de démo, sans difficulté structurelle pour évoluer ensuite vers multi-tenant et 100+ agents. La sécurité multi-tenant doit exister dans le schéma de données dès l'origine.

## Démarrage

Prérequis : Node ≥ 22.12, pnpm 10, Docker.

```bash
cp .env.example .env
pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev            # API http://localhost:4000 · worker (Temporal) · web http://localhost:3000 · Temporal UI http://localhost:8233
```

Le badge **DEMO** signale une simulation déterministe côté serveur : aucun appel LLM, e-mail ou SaaS externe.
Contrôles : `curl localhost:4000/health/ready`, `curl localhost:4000/v1/bootstrap`.

## Vérifications

```bash
pnpm lint && pnpm typecheck
pnpm test                 # unitaires + intégration (base companyos_test)
pnpm test:contracts       # contrats Zod <-> specs/events.schema.json, projection
pnpm test:integration     # PostgreSQL réel : DB, gateway, worker, API
pnpm e2e                  # Playwright (lance pnpm dev si besoin)
pnpm build
```

## Code

| Dossier              | Rôle                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `packages/contracts` | Zod : enveloppe d'événements v1, payloads, snapshot, API, catalogues démo   |
| `packages/world`     | Carte hq-v1, A*, réducteur idempotent, KPI, projection visuelle             |
| `packages/db`        | Prisma/PostgreSQL : event_log + outbox, services métier, seed               |
| `packages/agents`    | Fournisseurs LLM (Anthropic, démo scripté, mock), prompts versionnés, boucle bornée |
| `packages/policies`  | Rédaction, budgets, tarification versionnée                                 |
| `packages/tools`     | ToolGateway (politique, retries, timeout) + adaptateurs démo                |
| `apps/api`           | Fastify `/v1` + Socket.IO (`events:resume`, `domain:event`), relais outbox |
| `apps/worker`        | Workflow Temporal `agentTask` + activities, dispatcher, autopilote démo     |
| `apps/web`           | Cockpit Next.js + monde Phaser isométrique                                  |

État d'avancement et prochaines étapes : `docs/PROGRESS.md`. Décisions : `docs/DECISIONS.md`.
