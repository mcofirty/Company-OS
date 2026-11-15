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

### 2026-11-15 — décisions prises pendant M0 (avant réception du pack)

1. **Specs détaillées absentes.** `START_HERE.md`, `docs/01..09`, `specs/events.schema.json` et `references/` sont
   référencés par `CLAUDE.md` mais pas encore dans le dépôt. M0 a été construit à partir de `CLAUDE.md` seul.
   Dès que ces fichiers sont ajoutés, réaligner le schéma d'événements et le découpage des jalons. _Réversible._

2. **Contrats d'événements en Zod** (`packages/contracts`) plutôt que JSON Schema : une seule source typée.
   Un export JSON Schema (`z.toJSONSchema`) pourra produire `specs/events.schema.json`. _Réversible._

3. **Ordonnancement des `seq`** : `appendEvents` prend un `pg_advisory_xact_lock` par entreprise, ce qui garantit
   que l'ordre des `seq` correspond à l'ordre de commit. Sans ce verrou, un lecteur « après seq N » pourrait
   sauter un événement encore en cours de commit. Coût : écritures sérialisées par entreprise (acceptable).

4. **Livraison temps réel au moins une fois** : outbox relayée par `FOR UPDATE SKIP LOCKED`, clients
   dédupliquant par `seq` (projection idempotente). À la souscription, le serveur rejoint la room avant le rejeu.

5. **Temporal reporté.** M0 n'a aucun workflow long. Le simulateur demo est un processus Node séparé de l'API
   (il persiste sans navigateur), idempotent par `demo:step:<lastSeq>`. Temporal sera introduit avec les vrais
   agents (boucles bornées, timeouts, retries). _Réversible._

6. **Résolution de modules `Bundler` + exécution via `tsx`** : les packages internes sont consommés en source
   TypeScript (pas d'étape de build). Next transpile `contracts` et `world`.

7. **TypeScript 6.0** (et non 7.0) : `typescript-eslint` ne supporte pas encore TS 7. **Prisma 7.10.1** (stable ;
   `latest` pointe vers une RC 8). **Playwright 1.63.0** pour correspondre au Chromium préinstallé.

8. **Reset de la base de test** : Prisma refuse `migrate reset` lancé par un agent IA. Le setup de test supprime
   le schéma `public` de la base de test seulement (refus si le nom ne finit pas par `_test`), puis lance `migrate deploy`.

9. **Visuels 100 % procéduraux** (Phaser Graphics → textures) : pixel art original, aucun asset tiers.

10. **Hooks de test** `window.__officeScene` / `window.__hqSocket` exposés uniquement hors production, pour cliquer
    dans le canvas et couper le WebSocket dans les e2e.
