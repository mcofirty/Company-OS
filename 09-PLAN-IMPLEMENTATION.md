# 09 — Plan d'implémentation exécutable pour Claude Code

## Mode opératoire
Implémenter **verticalement**, pas tous les composants superficiellement. Les milestones ci-dessous sont un contrat de progression. **Commencer M0 immédiatement**, puis M1, etc. Chaque milestone = code + scripts + tests + mise à jour PROGRESS + snapshot visuel lorsque concerné. Garder la portée de chaque commit cohérente. Éviter que la taille du projet empêche de faire tourner quoi que ce soit.

## M0 — Socle exécutable
**Objectif :** monorepo qui démarre, même sans LLM.

**À créer :** `pnpm-workspace.yaml`, root package scripts, tsconfig strict, packages contracts/db, apps/web/API, Docker Compose PostgreSQL, config Prisma, Zod, Fastify health, Socket.IO, Next.js page simple, tests unitaires, lint/format, Vitest, Playwright config, GitHub Actions CI. Versionner les dépendances et `.env.example`. Temporal peut être intégré après que le premier squelette fonctionne, mais son répertoire et frontière doivent exister. Dans ce stade, pas d'auth réelle requise pour visualiser en DEMO localhost, mais strict guard du mode.

**Tests / acceptation :** `pnpm install`, `docker compose up -d`, migrations/seed, `pnpm dev`, `curl /health/live`, page Next visible, `pnpm typecheck`, `pnpm test`, `pnpm build`. Documenter ports et commande de reset. Toute indisponibilité Docker doit être signalée, pas contournée par faux retour.

## M1 — Premier parcours vertical réel au niveau du système
**Objectif :** monde jouable + backend d'événements persistés + outils demo.

**Ordre exact :**
1. Schema M1 : org, user admin local de demo, department, agent, task, tool, invocation, event_log, outbox, map/rooms.
2. Seed relançable : 12 agents répartis dans 6 départements (plus café), mobilier/ancres, au moins 8 outils ; `provenance:demo`.
3. `POST /v1/tasks` et démo `run` via worker déterministe backend ; la task passe queued/running ; invocation CRM fixture `requested/started/succeeded`; résultat crée task succeeded et tous events/outbox.
4. `GET /v1/bootstrap`, `/v1/events`, `/v1/agents`, `/v1/tools`, `/v1/tasks` et Socket.IO diffusion ; test reconnexion à seq.
5. Map isométrique Phaser : tilemap originale, allées, desks, plantes, 6 zones colorées, au moins 8 avatars avec pathfinding vers desks, depth sort ; clic sur un avatar ouvre panneau.
6. Layout cockpit 1440×900 : topbar KPI, carte centrale, panneau outils actifs à droite, inspecteur contextuel, timeline en bas, bannière `DEMO`.
7. Bouton « lancer Qualification de prospect (DEMO) » crée tâche via API ; observer ligne tool CRM, avatar se déplace/travaille, timeline change, succès terminal ; refresh rétablit l'état serveur.
8. Tests unitaires/integration/e2e et screenshots ; résoudre les ruptures SSR/Phaser et Socket event gaps.

**Definition of done M1 :** impossible de confondre la map avec un GIF ; appels HTTP et événements réels du backend ; agent sélectionnable ; outil réel **au sens de l'adaptateur demo serveur instrumenté** ; états conservés ; aucun appel SaaS/LLM extérieur.

## M2 — Agent LLM fonctionnel et outils sécurisés
**Objectif :** un véritable agent exécute un workflow de faible risque.

**À faire :** `AgentRunner` borné, provider Anthropic configuré par `.env` (API réelle seulement en mode LIVE), outil CRM de test (connexion choisie) ou `DemoTool` en mode hybride bien signalé, `ToolGateway` policy, tokens/cost, OTel, redaction, retries, budgets, Temporal worker + workflow `qualifyLead`, état retrievable via API. UI affiche provider/model/source/cost/trace. Ne pas connecter Gmail réel sans permission explicite ; limiter à lectures et brouillons.

**Tests :** mocks provider, erreurs outil, coûts, `maxSteps`, prompt injection dans fixture, hard stop. Si aucune clé API n'est disponible, **tout doit rester testable en mode demo** ; le parcours LIVE est documenté comme « non vérifié sans clé ».

## M3 — Entreprise organisée : managers, RH, création, réunions
**Objectif :** hiérarchie et collaboration observables.

**À faire :** agent versions, manager link, capability grants, meeting lifecycle + salle d'attente/sièges, task delegation, HR proposal, approval admin, `agent.created/activated` et spawn, work desks dynamiques, inspecteur meeting, résumé + décisions, alertes. Un manager ne peut pas donner à un agent plus de pouvoirs que sa policy. Afficher nouveaux agents lors de création réelle backend. Ajouter événements `approval` et `meeting`.

**Tests :** create/approve agent -> spawn et desk ; réunion 3 agents -> salle et retour ; délégations cycliques rejetées ; capacity room ; invalid approvals.

## M4 — Command Center complet / multi-outils / audit
**Objectif :** écran PC donne une vision opérationnelle complète.

**À faire :** mur des outils avec historique et agrégations, overlay limité des connexions agent→outils, recherche globale, filtres de département, tool health, KPI par intervalle, Activity timeline virtuelle, replay scrubbable, inspections de traces/correlation, files d'erreur, permissions operator/viewer/admin, kill switch, S3-compatible artifacts facultatifs si nécessaire, audits et rétention configurable.

**Tests :** plusieurs invocations en parallèle, filtres, erreur visible, replay sans déclenchement live, isolation tenant, viewer 403, dégagement overlay >5 liaisons.

## M5 — Durcissement et déploiement
**Objectif :** plateforme robuste, testable et exploitable.

**À faire :** auth OIDC prod, vault secrets, CSP/CSRF/cookies, Docker images optimisées, migrations automatique contrôlées, staging, sauvegarde/restauration, OpenTelemetry, traces, stress tests 50+ avatars, pagination, CI et E2E, runbooks incidents, documentation d'ajout tools/agents, monitoring coûts. Pour multi-tenant SaaS, implémenter tenant isolation end-to-end avant ouverture clients externes.

**Tests :** backup restore, crash/restart Temporal, forced Socket disconnect/replay, security tests, ramp load, build CI, production smoke tests.

## Dépendances critiques
M1 nécessite DB+events avant visuel ; M2 requiert gateway avant outils LIVE ; M3 requiert politiques/identités ; M4 requiert historique événementiel ; M5 doit vérifier tous les précédents. Ne pas accélérer en supprimant la traçabilité ni en contournant politiques.

## Recommandations de gestion du contexte long
- Lire le `CLAUDE.md` de root à chaque session automatiquement ; consulter `docs/PROGRESS.md`.
- Une session = un sous-objectif démontrable, idéalement quelques commits cohérents.
- Vérifier les docs externes uniquement pour API actuelles ; noter tout changement majeur dans ADR.
- Si Claude Code ne dispose pas d'accès navigateur/écran, prendre screenshot via Playwright et vérifier les dimensions/DOM/canvas ; ne pas déclarer une qualité esthétique validée visuellement sans inspection possible.
- En fin de session, bilan factuel et `next task` unique pour reprise.

## Définition du succès « fin de projet »
Le produit est réussi lorsqu'un utilisateur peut créer une organisation, créer/activer agents, définir manager et équipe, lancer de vraies tâches, observer les avatars et leurs outils **dans un seul écran**, superviser réunions, voir coûts/erreurs, intervenir sur approbations, retrouver historique et reprendre après panne — avec un niveau d'autonomie dépendant explicitement des politiques et des connecteurs autorisés.
