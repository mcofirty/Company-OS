# 08 — Qualité, stratégie de tests, acceptation et non-régression

## 1. Définition de terminé (DoD)
Une fonctionnalité est terminée si (a) endpoint/policy/documentation et projection UI fonctionnent ; (b) types et validation sont appliqués ; (c) test automatisé pertinent existe ; (d) screenshot/contrôle de rendu a été effectué si c'est visuel ; (e) événements et audit sont traçables ; (f) aucun secret ou vraie action externe ne part en DEMO ; (g) README/PROGRESS à jour. « Code écrit » n'est **pas** « fait ».

## 2. Pyramid de tests
**Unit (Vitest) :** projection événement→état monde, schéma Zod, transitions tasks/agents/meetings, pathfinding A*, affectation de siège, policy access, idempotency, calcul du coût, redaction des données, filtre de wall des outils.

**Intégration :** API + Postgres réel, Prisma migrations, outbox, idempotency, création agent puis event, tâche démo -> invocation démo -> fin, permissions 401/403, cross-tenant, génération d'approbation, reprise de workflow Temporal (si infra disponible).

**E2E (Playwright) :** desktop 1440×900 et 1920×1080, rendu carte & labels, clic agent, triggers task, usage outil live simulé, erreur outil, création agent + apparition, meeting, refresh pendant tâche, coupe Socket/reconnect, timeline, permissions.

**Visual regression** : screenshots versionnés sur un jeu de seeds et tailles d'écran fixes. Définir baselines seulement après revue humaine, seuils raisonnables. Vérifier que le moteur canvas est réellement rendu et que sprites sont visibles ; screenshots ne suffisent pas à prouver une activité backend.

## 3. Scénarios obligatoires (tracés automatisés)
- **S01 Premier affichage** : login demo, carte isométrique non vide, >=6 départements, >=8 avatars distincts, outils présents, KPI non tous vides.
- **S02 Cycle complet** : création tâche -> tâche `running` -> invocation CRM -> succeeded -> tâche succeeded -> timeline et compteur concordants -> screenshot.
- **S03 Reconnexion** : faire tomber Socket au milieu d'un run, rétablir, aucun événement perdu ni doublé, état après refresh exact.
- **S04 Erreur outil** : adapter renvoie 503 ; invocation failed, tâche blocked/retry selon code, alerte visible ; aucun faux succès.
- **S05 Création agent** : agent RH propose, admin accepte, dossier agent persisté, apparition accueil, assigne poste libre ; au refresh l'agent est toujours présent, pas de nouvel effet spawn.
- **S06 Réunion** : 3 agents, capacité 4+, avatars assis sans chevauchement, summary structuré & trace, retour vers leur poste.
- **S07 Permission** : viewer tente de lancer outil/approve -> 403, pas d'invocation créée. Agent interdit ne peut envoyer d'email.
- **S08 Budget** : dépassement plafond -> `BUDGET_EXCEEDED`, aucune nouvelle requête LLM/outils, KPI alerte.
- **S09 Idempotence** : deux POST identiques avec même clé -> un seul task/approval/side effect.
- **S10 Isolation tenant** : objet d'autre org non visible y compris événements Socket.
- **S11 Démo sans réseau externe** : couper accès externe puis exécuter scénario ; il fonctionne sans appels LLM, email ou CRM live.
- **S12 Kill switch** : bloquer nouvelles invocations et ne pas perdre traces existantes.
- **S13 Tool overlay** : sélectionner agent avec trois invocations ; liens corrects et panneau outils accessible ; au-dessus de cinq liens, regroupement lisible.
- **S14 Accessibilité** : listes agents/outils disponibles clavier ; reduced motion fonctionne ; badges ne dépendent pas uniquement de la couleur.

## 4. Critères performance (cibles à vérifier)
- 12 avatars: viser 60 fps sur machine desktop de référence, sans surcharge CPU excessive.
- 50 avatars: >30 fps avec qualité réduite.
- Délai p95 d'UI `tool.started` sur réseau local raisonnable : cible <2 s entre commit et rendu ; tracer séparément backend/transport/frontend.
- `GET /v1/bootstrap` p95 cible <500ms sur DB seedée locale, hors démarrage initial.
- Absence de mémoire croissante sous 30 min d'animation / connexions/déconnexions répétées.
Toutes ces valeurs sont des **objectifs** qui doivent apparaître comme non vérifiés tant que les benchmarks n'ont pas été exécutés.

## 5. UX checklists
- Carte occupe la plus grande zone, reste centrable, zoom/drag accessibles.
- Zone outil visible même si aucun agent choisi ; état vide informatif.
- Un clic avatar ouvre inspecteur et identifie correctement ID/tâche.
- Timeline ne masque jamais la carte et défile indépendamment.
- Au moins deux états d'outil bien contrastés (active / failed), plus warning approval.
- Tous KPI ont unité, période, provenance, mise à jour et statut estimé vs mesuré.
- Pas de « beau gif » quand aucune donnée : l'UI montre un état honnête.

## 6. Commandes de contrôle (Claude Code doit les implémenter)
```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm e2e
pnpm build
```
Ajouter `pnpm test:contracts` si utile pour alignement JSON Schema/Zod ; `pnpm test:visual` avec contrôle baselines. CI : installer deps avec lockfile, typecheck, lint, tests, build ; service PostgreSQL pour tests d'intégration ; E2E éventuellement workflow séparé (ne pas mettre tests impossibles dans un pipeline obligatoire).

## 7. Critères de sécurité
Tests de prompt injection dans données CRM/Drive fictives ; preuve que l'agent ne lit pas de secret ; test des ressources restreintes, revue des scopes, approbation invalide, double approbation, redaction des payloads. Vérifier les champs du log Socket.IO par inspection automatisée de snapshot sans PII. `APP_MODE=demo` doit échouer fermé si un adaptateur réel tente d'envoyer un effet externe.

## 8. Règle des livraisons
Pour chaque milestone : enregistrer commands exécutées + résultat dans `docs/PROGRESS.md`. Si une suite ne peut pas s'exécuter faute d'accès Docker/API/provider, noter explicitement **non testée**, proposer moyen local et continuer sur le reste sans affirmer un succès fictif.
