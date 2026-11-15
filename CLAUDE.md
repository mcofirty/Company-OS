# CLAUDE.md — AI Company OS / Living HQ

> Instructions persistantes pour Claude Code (dont Claude Fable 5.2). Ce fichier est volontairement court : la spécification détaillée se trouve dans `docs/` et `specs/`.

## Référence visuelle
Lire `references/README.md` (description textuelle de la référence) avant de dessiner le monde. La capture d'origine n'est **pas versionnée** (droits non vérifiés) : si elle est fournie, la garder hors du dépôt (`references/*.jpeg` est ignoré par git). **Inspiration uniquement ; pas de copie d’assets ni de redistribution.**

## Mission
Construire **une application web réellement fonctionnelle** permettant de superviser une entreprise exploitée par des agents IA autonomes. Son écran principal est un **quartier général isométrique en pixel art, type Habbo / jeu de gestion**, avec avatars qui marchent, travaillent, se réunissent, apparaissent à leur création, et outils logiciels visibles en temps réel, **sur un seul écran PC**. Cliquer sur un agent, outil, réunion, tâche ou alerte ouvre son inspecteur. Les comportements affichés sont causés par des événements persistés du backend, pas par des animations mensongères.

## Lire AVANT de coder, dans cet ordre
1. `START_HERE.md` : consigne d'exécution et critères de succès.
2. `docs/01-PRODUIT-ET-UX.md` : exigences et vue principale.
3. `docs/02-ARCHITECTURE.md` : décisions et frontières.
4. `docs/03-DONNEES.md` et `specs/events.schema.json` : contrats.
5. `docs/04-AGENTS-ET-ORCHESTRATION.md` et `docs/05-OUTILS-ET-SECURITE.md`.
6. `docs/06-MONDE-ISOMETRIQUE.md`, `docs/07-API-TEMPS-REEL.md`.
7. `docs/08-TESTS-CRITERES.md`, `docs/09-PLAN-IMPLEMENTATION.md`.
8. `docs/PROGRESS.md` : point de reprise à tenir à jour.

## Règles non négociables
- **Code exécutable, tests exécutés, pas seulement du pseudocode ni un mockup.** Progresser verticalement : DB -> API -> events -> World -> inspector -> vrais agents -> outils -> gouvernance.
- **Une source de vérité** : PostgreSQL pour état métier, EventLog + transactional outbox pour événements. Phaser n'est qu'une projection visuelle.
- **Séparer `demo` et `live`** clairement, tant en backend qu'en UI. Aucune démo ne doit être présentée comme de l'activité réelle. Mode demo déterministe et sans appels externes ; mode live avec intégrations autorisées.
- **Aucune action externe à effet réel par défaut** : envoi d'email, publication, paiement, signature, suppression, déploiement et modification des permissions exigent une politique explicite, et une validation humaine quand sensible.
- **Agents limités** : autorisations attribuées côté serveur, budgets, délais, nombre d'étapes, idempotency keys, audit, kill switch. Jamais de secrets dans prompts/logs/événements frontend.
- **L'humain est responsable** des décisions stratégiques et engageantes. Un agent RH peut proposer un recrutement d'agent, mais ne s'accorde pas ses propres droits.
- **Ne jamais afficher les raisonnements internes cachés des LLM.** Exposer traces d'actions, prompts/redactions si autorisés, résumés, résultats, décisions et erreurs.
- **Pas de technologies superflues** : monorepo pnpm TypeScript. Next.js/React UI, Phaser world, Fastify API + Socket.IO, PostgreSQL/Prisma, Temporal workers, Zod contracts, Vitest, Playwright, Docker. Choisir les versions stables compatibles au moment d'installer ; verrouiller par lockfile.
- **L'exécution des agents persiste sans navigateur ouvert**. Une déconnexion WebSocket ne perd pas l'état ni les événements.
- **TypeScript strict**, aucun `any` tacite, pas d'API contournant la couche métier, schémas validés, migrations versionnées, lint + format + tests.
- **Ne pas se limiter à de faux tableaux** : le prototype peut avoir des assets temporaires originaux et un mode demo, mais les cartes, actions, avatars et inspecteurs doivent être réellement interactifs.
- **UX desktop-first, 1440x900 et 1920x1080**. Le bureau isométrique reste la vue dominante, tandis que les outils actifs, KPI, tâches et alertes sont visibles sans changement d'onglet. Mobile = consultation secondaire, non priorité.
- **Textures originales ou à licence vérifiée**, ne pas reprendre les sprites/Habbo/TikTok sous copyright. Cohérence pixel-art isométrique et lisibilité forte.

## Architecture cible (résumé)
`apps/web` (Next.js + React + Phaser), `apps/api` (Fastify + Socket.IO), `apps/worker` (Temporal), `packages/contracts` (Zod + event schemas), `packages/db` (Prisma), `packages/agents` (provider adapters et boucles bornées), `packages/policies`, `packages/world` (projection/adapters), `packages/ui`, `infra` (compose, Docker, observabilité), `tests`.

## Ordre d'implémentation
Suivre **strictement** `docs/09-PLAN-IMPLEMENTATION.md` par jalons M0 à M5. Pour chaque jalon : implémentation -> migrations -> tests unitaires/intégration/e2e pertinents -> screenshot/UI validation -> mise à jour `docs/PROGRESS.md` -> commit descriptif si environnement autorisé. Ne pas ajouter des centaines d'agents avant de prouver un workflow complet.

## Commandes cibles (à créer par Claude pendant M0)
- `pnpm install`
- `docker compose up -d`
- `pnpm db:migrate && pnpm db:seed`
- `pnpm dev`
- `pnpm lint && pnpm typecheck && pnpm test`
- `pnpm e2e`
- `pnpm build`
Ne PAS déclarer ces commandes fonctionnelles avant de les avoir implémentées et exécutées.

## Discipline de livraison
- Avant une grosse modification, lire les fichiers impactés et annoncer en 3-5 lignes le plan de travail.
- Si une dépendance ou exigence est ambiguë, choisir l'option réversible la plus simple, la noter dans `docs/DECISIONS.md` et poursuivre.
- Corriger les défauts trouvés ; ne jamais cacher les tests échoués ni simuler un résultat de test.
- À chaque fin de session, écrire dans `docs/PROGRESS.md` : réalisé, tests, écarts, prochaine tâche exacte, commandes de reprise.
- Ne modifier le `CLAUDE.md` que pour une règle durable, pas pour stocker les tâches en cours.
