# AI COMPANY OS — Living Headquarters

**Statut initial du pack : spécifications à implémenter.** Ce dépôt contient le cahier des charges et les instructions de réalisation pour Claude Code / Claude Fable 5.2. À réception, il **ne contient pas encore l'application exécutable** ; c'est Claude Code qui doit la construire.

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
