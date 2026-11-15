# START HERE — Mission de développement pour Claude Fable 5.2

## Contexte
Tu es Claude Code, connecté à un **dépôt Git vide** dans lequel les fichiers de ce pack viennent d'être placés. Tu dois **CONSTRUIRE LE PRODUIT**, pas seulement écrire un plan, faire une maquette Figma ou générer une page statique. Le projet est une **entreprise virtuelle d'agents IA visualisée en temps réel** sous la forme d'un quartier général isométrique pixel art.

Les exigences détaillées font autorité, en particulier `CLAUDE.md`, `docs/01-PRODUIT-ET-UX.md` à `docs/10-OBSERVABILITE.md`, `specs/` et `docs/09-PLAN-IMPLEMENTATION.md`.

## Ce que l'utilisateur doit voir
Une application sur ordinateur qui montre sur **UN SEUL ÉCRAN** :
1. Un environnement isométrique type Habbo/jeu de gestion, beau et lisible, réparti en services (Direction, Sales, Marketing/Studio, Finance, RH, Operations/Support, espace commun, salles de réunion).
2. Des agents avatarisés qui marchent vers les bureaux et salles, s'assoient, travaillent, s'assemblent en réunion, signalent leur statut, apparaissent lorsqu'un agent est créé.
3. Un panneau live **Outils actuellement utilisés** montrant application, agent, tâche, opération, durée, succès/erreur, avec icônes et liens vers les traces.
4. Un bandeau KPI (agents actifs, tâches en cours, approbations, outils actifs, coût LLM, incidents).
5. Une timeline événementielle et des alertes ; un panneau inspecteur pour agents, outils, tâches, réunions et départements.
6. Une surcouche optionnelle de liens animés agent → outil → résultat, filtrable sans masquer le monde.
7. Une distinction explicite des modes DEMO / LIVE ; aucune action externe n'est déclenchée par une simple simulation.

## Mode de travail obligatoire
**Étape 0** : inspecte le dépôt, lis les spécifications, valide l'environnement (Node, pnpm, Docker), sélectionne des versions *stables et compatibles* de packages ; consigne les choix dans `docs/DECISIONS.md`.

**Étape 1** : réalise le jalon M0. Initialise monorepo, base, API, UI et mécanismes tests. **Exécute** les commandes réelles. Si Docker n'est pas disponible, livre un mode `demo:local` explicitement identifié et documente le blocage ; pas de faux résultat.

**Étape 2** : réalise M1 (vertical slice). On doit pouvoir ouvrir le cockpit, voir une vraie map isométrique, cliquer sur un avatar, déclencher une tâche demo via API, voir l'agent marcher, une utilisation d'outil apparaître, puis le statut revenir à disponible. L'événement doit être stocké et récupérable après refresh.

**Étape 3** : réalise M2, M3, M4 et M5 progressivement tant que le contexte de travail, les autorisations et les ressources le permettent. Après chaque jalon, teste et rends le résultat fonctionnel.

## Instruction anti-raccourcis
- Ne livre pas une simple `index.html` ou des composants qui montrent seulement des données artificielles non reliées à une API.
- La démo *est autorisée* si **clairement étiquetée** et fondée sur des événements générés par un moteur déterministe dans le backend (pas des animations arbitraires dans le navigateur).
- Ne prétends pas qu'un vrai agent est actif sans invocation de modèle confirmée.
- Ne mets jamais de clé API en dur. Un fichier `.env.example` avec valeurs fictives suffit.
- Évite d'installer des frameworks non prévus sans décision documentée.
- N'utilise pas de contenu protégé de la capture TikTok fournie : reproduis seulement le **style général**.

## Premier livrable vérifiable
À la fin de la première tranche de travail, l'utilisateur doit pouvoir lancer les commandes du README et :
- ouvrir le cockpit ;
- voir au moins 6 zones colorées en pixel art isométrique et 8-12 agents de démo ;
- sélectionner un agent et une tâche ;
- démarrer une tâche `Qualify Lead (DEMO)` ;
- observer avatar -> bureau -> outil CRM -> résultat -> KPI/timeline ;
- rafraîchir l'onglet sans perdre l'état officiel ;
- retrouver la même exécution via API ;
- constater que chaque donnée démo porte une provenance `demo`.

## Livrable final demandé
Application et code source, migrations, seed, tests, scripts, documentation de lancement, CI simple, journal de progrès, scénarios de démonstration et guide d'ajout d'un vrai agent et d'un nouvel outil.

## Reprise après interruption
Ouvre `docs/PROGRESS.md`, exécute le prochain jalon et actualise le document. Ne redemande pas les exigences déjà formulées. Termine chaque session par un bilan factuel : fichiers, commandes testées, résultat, prochaines étapes.
