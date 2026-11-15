# Décisions

Format : date — décision — raison — réversibilité.

## 2026-11-15 — M0

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
