# 01 — Cahier des charges produit et UX

## 1. Positionnement
**Nom de travail :** AI Company OS — Living HQ. **Promesse :** voir, comprendre et piloter une entreprise d'agents IA comme un jeu de gestion isométrique, sans perdre la rigueur d'une plateforme d'exploitation. Le produit n'est ni un chat multi-agents ni une simple animation d'avatars.

**Utilisateur initial :** fondateur / responsable des opérations qui souhaite lancer des agents, leur attribuer des responsabilités, visualiser ce qu'ils font, contrôler les outils et les dépenses, arbitrer les exceptions.

**Principes :** vérité des données > animation ; actionnable > décoratif ; compréhension immédiate > densité ; autonomie conditionnée > accès illimité ; un écran > multiplication de pages.

## 2. Inspiration visuelle de référence
L'utilisateur a fourni une capture TikTok montrant un **quartier général pixel art en perspective isométrique** sur fond mauve/rosé, avec bureaux et services colorés, personnages petits mais identifiables, panneaux arrondis indiquant nom de département et nombre d'agents au poste, bulles au-dessus des avatars. Reproduire **l'intention visuelle**, pas les éléments copiés : originale et conçue pour le web. Ambiance : chaleureuse, ludique, professionnelle, propre, contrastée, pas cartoon grossier. Éviter le style dashboard générique de cartes blanches sans monde illustré.

## 3. L'écran principal (critique)
Prototype desktop **1440×900**, adaptation **1920×1080**. La carte domine :

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ BRAND · DEMO/LIVE · Agents:12 · Missions:8 · Outils:5 · $:0.42 · Alerts:2 · Search │ ← Topbar 56-64px
├──────┬───────────────────────────────────────────────┬──────────────────────────────┤
│ Nav  │                                               │ ACTIVITY / INSPECTOR         │
│ 56px │          QUARTIER GÉNÉRAL ISOMÉTRIQUE          │ [Agent sélectionné]           │
│      │                                               │ Tâche / modèle / département  │
│      │ RH   Finance   Direction    Sales              │ Outils actifs (live)          │
│      │                                               │ CRM → read_lead • 0.8s       │
│      │ Marketing / Studio   Ops   Café   Meeting      │ Mail → draft • running        │
│      │                                               │ Flux agent → outil → résultat │
│      │ Zoom / Pan / filtres / liens outils (overlay) │ Actions: Pause / Inspecter    │
├──────┴───────────────────────────────────────────────┴──────────────────────────────┤
│ LIVE TIMELINE  [16:03 Sales→CRM] [16:04 RH→Drive] [16:05 réunion] [! Approbation]  │ ← 130-170px
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Tailles indicatives, pas pixels figés :** rail nav ~56 ; carte ~65-72 % largeur restante, panneau droit ~28-35 %, timeline ~16-20 % hauteur disponible. Disposer des panneaux repliables mais ne pas masquer par défaut la liste des outils actifs. À 1920, donner plus d'espace à la carte et à la vue des outils. **Pas de scroll vertical global** à la résolution cible ; scroll interne dans les panneaux.

## 4. Composition exacte de la carte
Départements et couleurs : Direction (or doux), RH (rose), Sales (orange), Marketing/Studio (violet), Finance (vert), Operations/Support (bleu), Communauté/Café (turquoise), réunion (neutre), accueil (espace spawn). Créer une grande dalle isométrique avec sol, cloisons basses, portes/circulations, baies vitrées, bureaux, tableaux, fauteuils, écrans, plantes et enseigne de type « QUARTIER GÉNÉRAL ». Prévoir cartographie des ancrages (postes, sièges, portes, point café, table meeting), **pas de collisions avec mobilier**.

Labels de département : nom, icône, fraction « X/Y au poste », couleur. Au survol : résumé (agents, tâches, incidents). Au clic : détail du département, manager, flux, KPI. Les labels suivent la caméra mais restent lisibles.

## 5. Hiérarchie visuelle / management
Chaque agent possède ID, nom, rôle, équipe, manager, avatar, badges de compétences et statut. Un responsable est identifiable sans devenir un super-utilisateur technique. Les réunions sont représentées par déplacement des avatars à la table avec **sujet et participants réels**. Une conversation API courte n'impose pas systématiquement une animation de 30 secondes : agréger les échanges et conserver une correspondance causalement vraie. Une réunion ne doit pas être déclenchée juste pour donner du mouvement.

**Création d'agent :** formulaire admin (identité, rôle, instruction, modèle, équipe, manager, outils, budgets). Validation du schéma + politique, persistence, événement `agent.created`, apparition depuis l'accueil, marche vers le siège disponible, toast « Nouvel agent rejoint l'équipe ». **RH propose** la création ; **admin approuve**. Les permissions ne sont pas héritées de façon implicite par le seul nom du rôle.

**Désactivation/suppression :** soft delete d'abord ; arrêt des nouveaux runs, annulation contrôlée des tâches, avatar quitte la carte ; conservation des traces d'audit. Pas d'effacement silencieux des données historiques.

## 6. Inspecteur universel
Un panneau latéral contextuel sélectionne un objet parmi : `agent`, `task`, `tool`, `invocation`, `meeting`, `department`, `approval`, `workflow`. Affiche provenance, état réel, horodatages et IDs/correlation.

**Agent** : nom, département, manager, rôle et objectif, statut, tâche active, mission, outils autorisés vs actifs, coût cumulé, métriques de réussite, dernières traces, boutons Pause/Reprise, Assigner tâche, Ouvrir historique, Gérer permissions (admin).

**Outil** : nom/logo autorisé, santé, comptes connectés sans secrets, agents consommateurs, actions récentes, latences, taux d'erreur, permissions, dernière utilisation. Au clic sur invocation : argumentaires **redacted**, résultat résumé, trace, durée, coût (si mesurable), tentative n°N, lien de tâche.

**Réunion** : sujet, date, initiateur, participants, décisions structurées, tâches créées, traces corrélées ; ne pas exposer de chaîne de pensée. **Tâche** : objectif, dépendances, owner, progres, échéance, artefacts, actions/outils, validations, erreurs et reprise.

## 7. Mur des outils — global et permanent
Affiché en permanence sur le panneau droit même sans agent sélectionné :
- 5 à 10 **utilisations actives**, tri par incident/risque puis heure ; groupe par outil ou agent.
- Chaque ligne : icône, outil, agent, type `read/write/search/draft/send/execute`, nom de mission, durée, statut `running/succeeded/failed/waiting_approval`.
- Indicateurs par outil : connexions actives, nombre de requêtes, taux d'erreur récent, latence p95, autorisations.
- **Lien agent→outil** optionnel : survol ou filtre montrant traits animés depuis l'avatar vers un dock d'outils, jamais « spaghetti » de lignes permanentes. Limiter à 5 connexions visibles et regrouper les autres.
- Si aucun outil n'est actif : afficher « Aucun outil utilisé actuellement » et les dernières actions vérifiées, jamais des appels inventés.

## 8. Commandes et modes
Boutons : créer une tâche ; créer un agent ; pause/reprise ; mettre en attente ; inspecter un workflow ; filtrer par département ; recherche globale ; DEMO/LIVE ; liste approbations ; galerie d'outils ; historique/replay ; basculer overlay outils.

**Mode Focus agent** : zoom caméra et panneau détaillé, sans changer de route. **Mode System** : overlay des dépendances agent→outil→service. **Mode Replay** : mouvement reconstruits à partir d'événements historiques et de snapshots, bandeau « REPLAY / date » très visible, aucune exécution backend.

## 9. Navigation / raccourcis / accessibilité
Recherche `Ctrl/Cmd+K` agents/tâches/outils ; `Esc` ferme inspecteur ; double clic recentre ; roulette zoom ; glisser pan ; boutons +/−, retour home ; navigation clavier pour actions essentielles en panneau ; liste HTML alternative pour retrouver un agent sans utiliser la carte. Réduire animations si `prefers-reduced-motion`. Couleurs complétées par texte/icône (éviter codes couleur seuls). Contrastes adaptés au monde pixel art.

## 10. États et libellés honnêtes
`idle` disponible ; `queued` en file ; `thinking` requête modèle active si instrumentation ; `working` activité en cours ; `using_tool` appel outil engagé ; `walking` seulement état d'animation local ; `in_meeting` réunion réelle ; `waiting_approval` en attente ; `blocked` erreur/dépendance ; `paused` suspendu ; `offline` indisponible. **Les déplacements ne doivent pas modifier le statut métier.**

La bannière DEMO doit préciser que l'activité est simulée. La bannière LIVE ne doit s'afficher que si des exécutions réelles sont possibles. Les cartes KPI distinguent « Mesuré » vs « Estimé » et affichent plage de temps et monnaie.

## 11. Fonctionnalités par priorité
**P0** : monde isométrique original, au moins 6 départements, 8-12 avatars de démo, clic inspecteur, événements backend persistés, outils actifs réellement corrélés, bandeau KPI et timeline, login local/admin de dev, déclenchement de tâche démo, création d'agent démo, tests.

**P1** : vrai provider LLM, vraie exécution d'outils sécurisée, workflows Temporal, réunions structurées, managers/RH, validation humaine, replay, outils défaillants, historique coûts.

**P2** : multi-tenant réel, designers de bureaux, plusieurs étages, agents spécialisés par industrie, simulation de charge, permissions avancées, connecteurs enterprise.

**Hors périmètre initial** : chat vocal 3D, jeu multijoueur temps réel, paiement réellement autonome, navigateur de bureau distant complet, plateforme RH juridique complète, tenue d'une comptabilité officielle.

## 12. Critère fonctionnel produit
Un utilisateur novice doit pouvoir répondre en **moins de 10 secondes** (objectif UX à tester) : quels agents travaillent ? sur quelles tâches ? quels outils utilisent-ils ? quels problèmes nécessitent mon intervention ? que coûte l'activité ? Le gameplay ne doit jamais cacher un risque métier.
