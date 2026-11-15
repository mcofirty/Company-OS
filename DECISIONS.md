# ADR — décisions d'architecture

## ADR-001 — Monorepo TypeScript, une seule pile applicative
**Décision :** pnpm workspaces ; Next.js/React+Phaser côté web, Fastify + Socket.IO côté API, worker Temporal TypeScript, Prisma/PostgreSQL. **Pourquoi :** partager les contrats, réduire la duplication et faciliter Claude Code. **Alternative :** microservices hétérogènes prématurés. **Réévaluation :** après mesure de charge.

## ADR-002 — Le backend fait foi, le monde affiche
**Décision :** aucun événement métier ne provient de l'animation client. Les déplacements sont une projection visuelle déterministe des affectations et tâches. **Pourquoi :** audit, reconnexion, cohérence.

## ADR-003 — Deux modes explicites
**Décision :** `demo` sans side effect, `live` sous politiques et autorisations. Tous les objets ont une provenance. **Pourquoi :** démonstration convaincante sans tromper l'utilisateur.

## ADR-004 — Temporal plutôt qu'un LLM superviseur omnipotent
**Décision :** les workflows durables gèrent étapes, temporisations, retries, interruptions et validations ; les agents prennent uniquement les décisions qui nécessitent du raisonnement. **Pourquoi :** prévisibilité, idempotence, reprise.

## ADR-005 — Temporal n'est pas une source de vérité financière
**Décision :** données et engagements officiels en PostgreSQL/systèmes de référence ; Temporal orchestre, n'est pas le grand livre. **Pourquoi :** éviter le couplage aux moteurs d'exécution.

## ADR-006 — Intégration LLM abstraite
**Décision :** adaptateur LLM utilisable avec Claude ou autre fournisseur, modèle configurable par rôle/complexité, usage borné. Fable 5.2 peut servir au **développement** du produit sans devoir être le modèle **runtime** de chaque agent. **Pourquoi :** coûts, latence, disponibilité, confidentialité.

## ADR-007 — Interface bureautique unique
**Décision :** monde principal + bandeau KPI + mur des outils + timeline/alertes + panneau d'inspection contextuel. **Pourquoi :** vue d'ensemble en une seule fenêtre PC ; overlays sur demande.

## Journal des nouvelles décisions
Claude Code ajoute les ADR ici ou dans des fichiers `ADR-00X-*.md` au fur et à mesure.
