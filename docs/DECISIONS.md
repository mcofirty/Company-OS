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

### 2026-11-15 — alignement sur le pack + M1

ADR-008 — **Migration init réécrite.** Le schéma M0 ne respectait pas docs/03 ; rien n'était déployé, la migration
`init` a été régénérée. Désormais toute évolution passe par une nouvelle migration.

ADR-009 — **Sérialisation des écritures par organisation.** `withOrgTx` verrouille la ligne `organizations` (`FOR UPDATE`)
et y tient `last_seq` : `seq` est contigu par org, dans l'ordre des commits, sans verrou consultatif. Coût : mutations d'une
même org sérialisées (acceptable pour le MVP mono-org ; à mesurer avant 100+ agents).

ADR-010 — **Identifiants.** Slugs stables pour agents/départements/outils (`sdr-01`, `sales`, `crm`), UUID pour org, tâches,
runs, invocations, événements. Multi-tenant futur : préfixer ou passer à des PK composites (org_id, id).

ADR-011 — **Déplacements = projection.** Aucun événement de mouvement. `visualIntent` déduit la cible (poste, pause café
cosmétique de 20 s après une tâche réellement terminée) de l'état métier. Le statut métier n'est jamais modifié par l'animation.

ADR-012 — **Temporal reporté à M2.** M1 utilise un worker Node déterministe (reprise après crash par étapes idempotentes).
`runDemoTask` est écrit comme un futur Workflow et `ToolGateway.invoke` comme une future Activity.

ADR-013 — **Pas d'approbation avant M3.** La gateway refuse toute action `external_write` (`APPROVAL_REQUIRED`) et
`high_impact` (`POLICY_DENIED`) : échec fermé plutôt qu'exécution non validée.

ADR-014 — **Autopilote démo.** Le worker crée périodiquement des tâches DEMO (pondérées, déterministes par `lastSeq`,
acteur `system:demo-autopilot`, provenance `demo`) pour que le QG vive sans fausse animation. Désactivable : `DEMO_AUTOPILOT=false`.

ADR-015 — **Rendu procédural.** Tuiles, mobilier et avatars sont dessinés par code (Phaser Graphics) : originaux, sans
licence tierce. Une tilemap Tiled pourra remplacer le décor sans changer `packages/world`.

### 2026-11-15 — M2

ADR-016 — **Boucle manuelle plutôt que le Tool Runner du SDK.** Chaque appel modèle et chaque appel d'outil doivent être
des étapes séparées (réserve budgétaire, persistance d'événements, Activities Temporal rejouables). La boucle
(`packages/agents/src/loop.ts`) est pure et réutilisée telle quelle par le workflow et par le mode inline.

ADR-017 — **Modèle runtime par défaut `claude-opus-5-5`, effort `medium` explicite**, configurable par version d'agent
(`agent_versions.model_policy`). Le modèle de développement (Fable 5.2) n'impose pas le modèle runtime (ADR-006).
Repli serveur sur refus activé (`fallbacks: "default"`, bêta `server-side-fallback-2026-07-01`).

ADR-018 — **Coûts en micro-dollars, « estimés ».** Les tokens viennent du fournisseur ; le prix vient de
`config/llm-pricing.json` (versionné, daté, source citée). Un modèle non tarifé => coût `null`, jamais inventé.

ADR-019 — **Démo = même chemin, fournisseur scripté.** En démo, la boucle, la gateway, les événements et Temporal sont
identiques ; seul le fournisseur est remplacé par un script déterministe (échec fermé : jamais de fournisseur réel en démo).

ADR-020 — **Live « hybride » limité.** En live, les tâches du catalogue utilisent le vrai modèle et les adaptateurs
d'outils démo (aucun effet externe). Le cockpit live attend l'authentification (M5) ; vérification par `agent:live-smoke`.

ADR-021 — **Rattachement département -> plan par `roomId`.** Les identifiants de département sont globaux ; la
sélection d'agent et la validation de poste passent par `department.roomId` (prépare le multi-tenant).

ADR-022 — **OpenTelemetry reporté à M5**, logs JSON corrélés en attendant (le jalon M2 du plan le mentionnait).

### 2026-11-15 — M3

ADR-023 — **Reprise après validation par signal Temporal + filet en base.** L'API signale `approvalDecided` au workflow
(`workflowId` du run) ; si le signal est perdu (Temporal indisponible côté API), le workflow relit la décision toutes les
20 s et expire la demande à échéance. La gateway revérifie les droits au moment de l'exécution.

ADR-024 — **Actions internes = outil « platform ».** Proposer un agent, réunir, déléguer passent par la ToolGateway :
mêmes grants, même audit, visibles dans le mur des outils. Les handlers sont idempotents par invocation.

ADR-025 — **Le recrutement est exécuté par la décision humaine**, dans la même transaction que `approval.decided`
(acteur de `agent.created` = l'approbateur). Les droits accordés sont exactement ceux affichés dans l'aperçu.

ADR-026 — **Réunions déterministes en M3.** Synthèse/décisions démo scriptées et étiquetées ; la délégation qui en
découle applique les règles de docs/04 §6. Les contributions LLM par participant sont reportées.

ADR-027 — **Assignation automatique filtrée par autorisation** : parmi les agents du département, priorité à ceux qui
ont le grant de l'outil requis (sinon la gateway refuserait l'appel).

ADR-028 — **Interface sur Vercel, backend hors Vercel.** Vercel ne peut pas héberger Socket.IO persistant ni le
worker Temporal. `apps/web/vercel.json` installe uniquement le cockpit et ses paquets (`--filter
@company-os/web...`). `prisma.config.ts` tolère l'absence de `DATABASE_URL` (génération du client seulement).
Sans API joignable, le cockpit affiche un état « backend non joignable » explicite, sans aucune donnée simulée.

ADR-029 — **Exposition par Cloudflare Tunnel avec jeton d'accès.** Derrière un tunnel, toutes les requêtes semblent
venir de 127.0.0.1 : dès que `API_ACCESS_TOKEN` (≥ 32 caractères) est défini, le principal de développement est
désactivé et seules les requêtes portant ce jeton (HTTP `Authorization: Bearer`, Socket.IO `auth.token`) passent,
comparées en temps constant ; un en-tête de proxy (`cf-connecting-ip`, `x-forwarded-for`…) refuse aussi le
principal dev. Le cockpit permet de choisir l'API et le jeton par navigateur (localStorage), sans redéploiement
Vercel. Auth locale simple en attendant OIDC (M5).

ADR-030 — **Désactiver un agent libère son poste.** La contrainte unique (org, poste) est conservée ; à la désactivation,
`deskAnchor` devient `retired:<agentId>`, dans le service comme dans le réducteur partagé (snapshot = rejeu). Le poste
d'origine reste dans l'historique (`agent.created`). Réversible : une contrainte partielle SQL pourrait la remplacer.

ADR-031 — **Alertes dérivées des événements, acquittement hors journal.** Une alerte est calculée par `alertFromEvent`
(partagé client/serveur) et insérée dans la transaction de l'événement ; son id est l'eventId (idempotence naturelle).
L'acquittement est un état opérateur, pas un fait métier : il ne crée pas d'événement.

ADR-032 — **Replay calculé dans le navigateur.** Le client relit `/v1/events` et applique le même réducteur, avec points
de contrôle. Aucun appel mutateur ni KPI « présent » pendant le replay. Un replay serveur paginé sera nécessaire au-delà
de quelques milliers d'événements.

ADR-033 — **Capacités UI venant du serveur.** `/v1/me` renvoie rôle et capacités ; l'UI masque les actions non permises
(viewer : aucune), le serveur reste seul juge (403).

ADR-034 — **L'API est un « resource server » OIDC.** Elle vérifie des jetons d'accès JWT (JWKS découverts,
`iss`/`aud`/`exp`, algorithmes asymétriques) ; les jetons opaques sont refusés. L'identité vaut `iss#sub` et
n'ouvre un accès que si un administrateur l'a accordée (`pnpm users grant`) ; le rôle est relu à chaque requête.
Le jeton unique `API_ACCESS_TOKEN` reste disponible pour un usage personnel.

ADR-035 — **Jetons Bearer explicites, pas de cookies.** Le cockpit (client public PKCE) garde le jeton en
sessionStorage et l'envoie dans `Authorization` / `auth.token`. Sans cookie ambiant, pas de CSRF ; CORS sans
`credentials`. Pas de jeton de rafraîchissement : nouvelle connexion à expiration (moins de surface).

ADR-036 — **CSP du cockpit avec `'unsafe-inline'` pour les scripts.** Les pages Next statiques ont des scripts
d'amorçage inline ; sans nonce (rendu dynamique), `'unsafe-inline'` est nécessaire. Pas de `'unsafe-eval'`,
`connect-src` limité à HTTPS/WSS (+ localhost), `frame-ancestors 'none'`.

ADR-037 — **Images Docker exécutant le TypeScript via tsx.** Pas d'étape de compilation séparée : tsx est une
dépendance d'exécution déclarée, aucune commande de gestionnaire de paquets au démarrage. Une cible `migrate`
porte la CLI Prisma ; l'image d'exécution n'a que les dépendances de production.

ADR-038 — **Traces : liste blanche d'attributs.** Les spans ne portent que des identifiants et mesures
(`SPAN_ATTRIBUTE_ALLOWLIST`) ; tout autre attribut est ignoré à la source. Export OTLP uniquement si
`OTEL_EXPORTER_OTLP_ENDPOINT` est défini.

ADR-039 — **Restauration à côté, jamais en place.** `db:restore` refuse la base en service et exige `--yes` ;
la vérification d'intégrité du journal suit automatiquement.

ADR-040 — **Banc de rendu synthétique.** La carte hq-v1 n'a que 22 postes : 50 agents réels ne tiennent pas dans
l'organisation démo. `/bench` génère un monde synthétique local (étiqueté, sans réseau) passant par les mêmes
règles visuelles, pour mesurer le rendu.

ADR-041 — **Le mode est porté par l'organisation.** Une organisation `live` (créée par `pnpm live:init`) exécute
ses missions avec un vrai modèle mais des outils démo sans effet externe (mode « hybride », affiché) ;
`APP_MODE=live` reste réservé aux futurs connecteurs réels et refusé. Démo et live ne partagent ni agents,
ni départements, ni événements (identifiants de département préfixés, `roomId` relie au plan).

ADR-042 — **Agents live créés par un humain, pas par un agent.** `POST /v1/agents` est réservé aux admins ; les
droits sont validés contre le catalogue (`high_impact` et actions de plateforme exclus). Le recrutement par
l'agent RH (proposition + validation) reste le chemin de la démo.

ADR-043 — **Missions libres seulement en live.** Le fournisseur démo est scripté par type de tâche ; une
mission libre n'a de sens qu'avec un vrai modèle. Agent explicite obligatoire (pas de routage implicite).

ADR-044 — **Sans clé, échec fermé et visible.** Le worker sert toutes les organisations ; une mission live sans
fournisseur configuré est bloquée `PROVIDER_UNAVAILABLE`. L'autopilote ne crée jamais de travail en live.

ADR-045 — **Choix d'organisation par `X-Org-Id`, adhésion vérifiée.** L'administrateur local (jeton/dev) et
les comptes OIDC choisissent l'organisation parmi leurs adhésions ; tout autre identifiant renvoie 403. Le
rôle effectif ne dépasse jamais celui de l'adhésion.

ADR-046 — **Annulation limitée aux tâches au repos ; relance = nouvelle tâche.** On n'annule ici qu'une tâche
en file ou bloquée : interrompre un workflow en cours exige un signal Temporal et l'expiration des validations
(reporté). Relancer ne réécrit pas l'histoire : une nouvelle tâche est créée et l'ancienne, annulée, pointe vers
elle (`retriedAs`), ce qui garde le journal append-only lisible.

ADR-047 — **Déploiement mono-serveur avec Caddy.** Un VPS unique (Hostinger, Hetzner…) porte toute la pile via
`docker-compose.prod.yml` + `docker-compose.vps.yml` ; Caddy fournit HTTPS automatique et seul lui publie des
ports. Adresses `sslip.io` par défaut (gratuites, liées à l'IP) ; un nom de domaine peut les remplacer.
La configuration est lue clé par clé, jamais exécutée comme script.


ADR-048 — **Aucune donnée fictive en LIVE.** Chaque outil du catalogue déclare `availability` (`demo`
par défaut, `live`). Une organisation live ne voit et n'accorde que des outils réels ; les adaptateurs
`kind: 'demo'` sont refusés par la passerelle (`DEMO_TOOL_DISABLED`) sauf `organizations.allow_demo_tools`
(réservé aux tests). Outils réels livrés : `web` (recherche/lecture web via les outils serveur
Anthropic, tracés comme invocations, coût de recherche compté au budget), `company` (état réel de
l'entreprise lu en base) et `library` (documents produits, secrets masqués, lisibles et téléchargeables
dans l'inspecteur de tâche).

ADR-049 — **Démo masquée sur un serveur réel.** `HIDE_DEMO_ORG=true` (défaut du compose de production) :
l'org démo disparaît de `/v1/me`, l'org par défaut est la première org live du membre, et une demande
explicite de la démo reçoit 403 (jamais de substitution silencieuse). `install.sh` ne charge plus la démo.

ADR-050 — **Décor et avatars pré-rendus en atlas.** Le monde (sol, murs, fenêtres, tapis) est cuit une fois
dans une texture découpée en morceaux (les zones vides ne sont pas dessinées) ; mobilier, cloisons vitrées,
sièges et écrans sont dessinés procéduralement (art original, `apps/web/src/world/decor.ts`) puis empaquetés
et rognés dans un atlas unique ; les avatars (22x35 pixels d'art, 7 poses, face/dos) dans un second atlas.
Moins de surface et de changements de texture : plus de détails pour un coût de rendu quasi identique
(banc `/bench`, captures `docs/screenshots/graphics-before-*` / `graphics-after-*`).

ADR-051 — **Connecteurs = serveurs MCP distants, politique par outil choisie par l'humain.** Plutôt que
d'écrire un adaptateur par éditeur, la plateforme parle MCP (Streamable HTTP, SDK officiel). Chaque outil
découvert est un `toolId` dynamique `mcp-xxxxxxxx` (ligne `tools` par organisation) ; nature et risque
viennent de la politique (`read` => risque read ; sinon `external_write` => validation humaine). Défaut :
validation à chaque appel. Jeton chiffré AES-256-GCM avec une clé d'environnement ; protection SSRF
(HTTPS, IP publiques). Les droits d'un agent sont remplaçables par un admin (`agent.grants.updated`).

ADR-052 — **Hiérarchie contrôlée par l'humain, équipes pilotées par les managers.** Le rattachement
(`managerId`) et le rôle ne changent que par un administrateur (organigramme, `agent.reporting.updated`,
sans cycle ; rattacher sous un spécialiste le promeut). Un agent manager (live) dispose de l'outil
« Équipe » : voir son équipe, confier une mission à un subordonné DIRECT (sous-tâche), proposer un
recrutement — toujours soumis à validation humaine, droits demandés ⊆ droits du manager, jamais l'outil
Équipe (pas de recrutement en chaîne sans décision humaine).

ADR-053 — **Fiche agent ancrée au personnage.** La fiche (pôle, rattachement, statut réel, mission,
compétences, outils, tâches habituelles, équipe) s'affiche à côté de l'avatar et le suit image par image
(position écran exposée par la scène) ; l'inspecteur de droite garde détails et historique. Compétences
et tâches habituelles : saisies par un humain (`agent.profile.updated`), purement descriptives.

ADR-054 — **Production « réel uniquement ».** Avec `HIDE_DEMO_ORG=true` (défaut du compose de production) :
aucune organisation ni donnée de démonstration (`update.sh` lance `purge:demo` après sauvegarde,
idempotent), aucun outil fictif recréé (`ensureCatalogTools({ liveOnly })`), page `/bench` absente
(`NEXT_PUBLIC_LIVE_ONLY` au build), aucune mention « démo » dans le cockpit. Le mode démo déterministe
reste disponible pour le développement local et les tests automatiques (règle CLAUDE.md inchangée),
jamais livré sur ce serveur.

ADR-055 — **Suppression d'agent = suppression logique, décidée par un humain.** `deletedAt` + événement
`agent.deleted` : l'agent quitte le QG, les listes et l'organigramme ; tâches, invocations et journal
restent consultables (audit). Une mission en cours est arrêtée (révisé le 2026-11-17) ; tâches ouvertes annulées ;
subordonnés rattachés à son manager ; droits retirés ; ses recrutements en attente rejetés.

ADR-056 — **Versions d'agent et niveaux de modèle.** Objectif, consignes et modèle se modifient en créant
une NOUVELLE version (`agent.version.updated`) : les runs en cours gardent la leur, l'historique reste.
Niveaux Qualité (Opus 5.5) / Équilibré (Sonnet 5.5) / Économique (Haiku 5.5), coût estimé affiché à partir
de la grille tarifaire versionnée. Les règles de plateforme restent toujours en tête des consignes.

ADR-057 — **Budgets éditables et remis à zéro chaque mois.** Plafond modifiable par un admin
(`budget.updated`, raison `limit_changed`) ; l'horloge du worker remet la consommation à zéro le 1er du
mois UTC (raison `new_period`) — correctif : aucune remise à zéro n'existait.

ADR-058 — **Missions récurrentes déclenchées par le worker.** Table `schedules` (quotidienne /
hebdomadaire / mensuelle, fuseau IANA, heure locale gérant les changements d'heure). Chaque exécution est
une mission normale avec un plafond de coût propre (`tasks.cost_cap_micros`), idempotente par échéance ;
agent indisponible = occurrence sautée et tracée ; jamais de rattrapage en rafale.

ADR-059 — **Attentes humaines et délégation hors délai de run.** Le temps passé à attendre une validation
ou des missions déléguées (`team.wait`, attente durable dans le workflow, 4 h max) ne compte plus dans
`maxDurationMs` — correctif : une validation donnée après 5 min faisait échouer la mission.

ADR-060 — **Mémoire du pôle et suite de mission.** Les missions live reçoivent, en données balisées, les
dernières missions terminées et documents de leur pôle. « Demander une suite » crée une mission liée
(`tasks.follow_up_of`) avec le résultat précédent.

ADR-061 — **Notifications via ntfy.** Téléphone (application ntfy) et email facultatif ; adresse et jeton
chiffrés AES-256-GCM, anti-SSRF, 60 / heure / org, uniquement pour les organisations live ; envoi après la
diffusion temps réel, jamais bloquant.

ADR-062 — **Cockpit v2.** Navigation à onglets (Bureau / Organigramme / Missions / Livrables / Réglages),
indicateurs cliquables, incidents et alertes limités aux 24 h, équipe sans les anciens agents, fiche
flottante = identité / panneau droit = travail et gestion, fil d'activité groupé par mission, bulles
d'activité et halo de blocage sur la carte (textes à échelle inverse du zoom), bandeau « depuis ta dernière
visite », premier démarrage guidé, thème sombre, vue téléphone (validations + activité).
