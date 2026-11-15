# Prompt à coller dans Claude Code / Fable 5.2

Tu es mon lead engineer, architecte logiciel, designer produit et QA. Tu es connecté à ce dépôt Git actuellement vide de code applicatif mais contenant un **pack de spécifications contractuelles**.

**Ta mission : créer effectivement AI Company OS / Living HQ**, un cockpit desktop pour entreprise gérée par agents IA, avec **monde 2D isométrique pixel art style Habbo**, avatars mobiles, départements, managers et RH, réunions visibles, nouveaux agents qui arrivent, tâche/état au clic, outils logiciels utilisés en temps réel, graphes de flux, KPI, alertes, validations humaines, journal et replay. Le tout visible sur un unique écran PC ; frontend et backend découplés ; système de tâches réel.

1. Lis complètement `CLAUDE.md`, `START_HERE.md`, puis les documents de `docs/` et les contrats de `specs/`.
2. Inspecte l'environnement et les versions stables des dépendances ; crée le monorepo pnpm défini dans `docs/02-ARCHITECTURE.md`.
3. Exécute le plan de `docs/09-PLAN-IMPLEMENTATION.md` **dans l'ordre**. Ne t'arrête pas à la génération du squelette : implémente le premier parcours complet, puis les jalons suivants lorsque possible.
4. **Priorité visuelle absolue** : rendu isométrique crédible, coloré et lisible, carte occupée par des départements cohérents, avatars animés, UI réellement interactive. N'utilise ni images protégées ni assets non licenciés.
5. **Priorité fonctionnelle absolue** : tout état affiché doit provenir de la source de vérité serveur ou du moteur de démo serveur explicitement identifié ; journal d'événements persistant et récupération après reconnexion. Pas de gadgets visuels isolés.
6. Sépare `DEMO` (fixtures reproductibles, aucun appel externe) et `LIVE` (LLM/outil branchés après configuration explicite). Les événements sensibles sont interdits sans autorisation et approbation requise.
7. Lance les commandes de build, lint, typecheck, tests unitaires, d'intégration et e2e prévues. Corrige les erreurs réelles. Documente les impossibilités d'exécution et ne prétends jamais qu'un test non lancé a réussi.
8. Après chaque milestone : mets à jour `docs/PROGRESS.md`, documente les choix dans `docs/DECISIONS.md`, fournis le résultat vérifiable et reprends le milestone suivant.

Je veux du **code de production progressif et testable**, pas un nouveau cahier des charges, pas une simple maquette, pas de questions de préférence déjà tranchées dans les docs. Avance avec des décisions raisonnables et réversibles. Commence maintenant par M0 puis M1, et continue au maximum dans cette session.
