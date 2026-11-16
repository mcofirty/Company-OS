# PROGRESS — registre de reprise

## Convention de mise à jour
Pour chaque changement : horodatage UTC, commit (si disponible), tâches terminées, commandes et résultats exacts, écarts connus, prochaine action.

## Session 2026-11-16 (10) — Outils réels en LIVE, démo masquée (Phase A)

### Réalisé
- Catalogue : `availability` demo/live ; outils réels `web` (recherche + lecture de pages, outils serveur
  Anthropic `web_search`/`web_fetch`), `company` (état réel : agents, budgets, missions, validations),
  `library` (enregistrer/lister/lire des documents). Les outils fictifs (CRM, email…) ne sont plus
  proposés ni exécutables en LIVE (`DEMO_TOOL_DISABLED`, ADR-048).
- Migration `20261116090000_live_real_tools` : table `documents`, `organizations.allow_demo_tools`.
- Worker : recherches/lectures web enregistrées comme invocations (`web.search`/`web.fetch`), coût des
  recherches (10 $/1000) ajouté au coût LLM et à la réservation de budget ; gestion de `pause_turn`.
- API : `GET /v1/documents?taskId&query`, `GET /v1/documents/:id` ; `/v1/tools` filtré par mode ;
  `HIDE_DEMO_ORG` (ADR-049). Cockpit : section « Documents produits » (lire, télécharger .md).
- Production : `HIDE_DEMO_ORG=true` par défaut, `install.sh` ne charge plus la démo.

### Tests (exécutés le 2026-11-16)
- `pnpm lint && pnpm typecheck` : OK. `pnpm test` : 134/134. `pnpm e2e` : 21/21.

### Écarts connus
- Un agent live créé avant cette version avec des outils fictifs (ex. CRM) verra ses appels refusés :
  le recréer avec Web / Entreprise / Bibliothèque.
- Section documents non couverte en e2e (exige un vrai appel LLM) ; couverte par les tests API/worker.

### Prochaine tâche exacte
Phase B : page « Connecteurs » en libre-service (serveurs MCP : URL + jeton, découverte des outils,
politique par outil lecture/validation/désactivé, secrets chiffrés, droits, audit).

## Session 2026-11-15 (9) — Kit de déploiement VPS (Hostinger)

### Réalisé
- `infra/deploy/install.sh` : installation complète sur Ubuntu 24.04 (Docker, pare-feu UFW 22/80/443,
  mises à jour de sécurité), secrets générés (`openssl rand`), clé Anthropic saisie sans affichage,
  `.env.production` en 600, construction et démarrage, organisations démo + LIVE, sauvegarde
  quotidienne (cron, 14 jours). Relançable sans perte de configuration.
- `infra/docker-compose.vps.yml` + `infra/deploy/Caddyfile` : HTTPS automatique (Let's Encrypt)
  devant cockpit et API, aucun autre port publié ; adresses gratuites `sslip.io` par défaut.
- `update.sh` (sauvegarde puis mise à jour), `backup.sh`, service `admin` (CLI ponctuelles) ; la clé
  Anthropic n'est transmise qu'au worker.
- Guide pas à pas : `docs/DEPLOIEMENT-HOSTINGER.md` (commande, terminal, questions, connexion,
  mise à jour, restauration, sécurité).

### Tests (exécutés le 2026-11-15)
- `shellcheck` sans avertissement sur les scripts ; `docker compose config` valide.
- Pile complète démarrée avec la surcouche VPS (certificats locaux) : santé OK, cockpit 200 en
  HTTPS, API 401 sans jeton et rôle admin avec jeton, port interne non exposé, seed + organisation
  LIVE, sauvegarde OK ; navigateur : connexion par jeton, temps réel via le proxy, bascule LIVE,
  aucune erreur ; restauration après sinistre : état identique (12 agents, séquence 24).
- Bugs trouvés et corrigés pendant ces tests : relecture du fichier de configuration qui cassait
  avec un nom d'entreprise contenant une espace ; directive `email` vide refusée par Caddy.

### Écarts connus
- Non testés ici : la commande Hostinger, un vrai certificat Let's Encrypt (serveur joignable
  requis), le clonage d'un dépôt privé (jeton GitHub en lecture seule demandé par git).
- Temporal en mode serveur de développement (SQLite) sur le VPS : suffisant pour un usage
  personnel, Temporal Cloud/cluster pour une production exigeante.

### Prochaine tâche exacte
Accompagner l'installation sur le VPS de l'utilisateur, puis vérification réelle avec Claude.

## Session 2026-11-15 (8) — Annulation et relance des missions

### Réalisé
- Nouvel événement **`task.cancelled`** (`reason`, `retriedAs`) dans les contrats Zod et
  `specs/events.schema.json`, appliqué par le réducteur partagé.
- **Annuler** une tâche en file ou bloquée (`POST /v1/tasks/:id/cancel`, motif obligatoire,
  opérateur+) : l'agent au repos est libéré (règle `activityAfterCancel` identique serveur/client).
  Une tâche en cours ou en attente de validation n'est pas interrompue (son workflow suit son cours).
- **Relancer** une tâche bloquée ou en échec (`POST /v1/tasks/:id/retry`) : nouvelle tâche
  identique (même agent, même mission) ; la bloquée est annulée et reliée (« voir la nouvelle
  tâche »). Cas d'usage : missions bloquées faute de clé, relancées après son ajout.
- Cockpit : boutons « ↻ Relancer » et « ⊘ Annuler » dans l'inspecteur de tâche (selon les droits),
  événement lisible dans la timeline ; libellés KPI sur deux lignes au lieu d'être tronqués à 1440 px.

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm test` : **129 tests passés** (17 fichiers), dont
  annulation (file, bloquée, double annulation, motif, tâche en cours refusée), relance (liaison,
  agent en file, refus après annulation), viewer 403, projection serveur = rejeu client.
- `pnpm e2e` : **21 tests passés** ; le scénario live inclut désormais relance puis annulation.

### Écarts connus
- Toujours aucun appel réel à Claude vérifié (pas de clé dans cet environnement).
- Annulation d'une tâche en cours / en attente de validation non proposée (nécessite l'arrêt
  propre du workflow Temporal et l'expiration de la validation).

### Prochaine tâche exacte
Avec une clé : vérification réelle (`pnpm live:init`, agent, mission, coût). Ensuite : annulation
des tâches en cours via signal Temporal, puis premier connecteur réel en lecture seule.

## Session 2026-11-15 (7) — Live encadré (sans clé Anthropic)

**État : organisations LIVE opérationnelles de bout en bout ; seul l'appel réel à Claude reste à
vérifier (aucune clé fournie dans cet environnement).**

### Réalisé
- **Organisation LIVE** : `pnpm live:init --name "…" [--budget 5] [--admin-sub <sub OIDC>]` crée une
  organisation séparée de la démo (6 départements calqués sur le plan, budget mensuel à plafond dur,
  administrateur local membre), sans agent.
- **Agents définis par un humain** : `POST /v1/agents` (admin, organisation live uniquement,
  Idempotency-Key). Droits exactement cochés, validés contre le catalogue (`high_impact` et actions
  de plateforme refusés), budget à plafond dur, poste libre du département ; les consignes de
  l'humain s'ajoutent aux règles de la plateforme. Acteur de `agent.created` = l'humain.
- **Missions libres** (`kind: custom`, titre + consignes, agent explicite) : réservées aux
  organisations live (la démo reste déterministe) ; exécutées avec les seuls outils accordés.
- **Worker multi-organisations** : un dispatcher par organisation, y compris celles créées après le
  démarrage ; l'autopilote n'invente du travail que pour la démo. Sans `ANTHROPIC_API_KEY`, une
  mission live est bloquée `PROVIDER_UNAVAILABLE` (visible, aucune exécution simulée).
- **Cockpit** : sélecteur d'organisation (DEMO / LIVE, `X-Org-Id` et `auth.orgId`, adhésion vérifiée
  par le serveur), badge LIVE « modèle réel · outils sans effet externe », formulaire « + Agent »,
  « + Nouvelle mission » et « Confier une mission » ; état vide guidé. Les pièces de la carte sont
  reliées aux départements par `roomId` (exposé dans le snapshot).
- **Corrections de tests instables** : acquittement d'alerte et validation d'email ciblent
  désormais l'élément exact (numéro de séquence, `data-task-id`) car l'autopilote démo crée des
  alertes et validations en parallèle.

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK.
- `pnpm test` : **124 tests passés** (16 fichiers) dont live : org séparée et idempotente, agent créé
  par un admin (droits exacts, poste, budget, consignes, acteur humain), refus (fort impact,
  plateforme, outil inconnu, org démo), mission libre exécutée avec un faux Claude (outils accordés
  seulement, coût imputé, provenance live), blocage `PROVIDER_UNAVAILABLE` sans clé, dispatcher par
  org sans autopilote en live ; API : `/v1/me` + bascule `X-Org-Id`, 403 hors adhésion, rôles et
  idempotence de `POST /v1/agents`, validation des missions, isolation temps réel démo/live.
- `pnpm e2e` : **21 tests passés** dont la bascule vers une org LIVE, la création d'agent depuis le
  cockpit, la mission bloquée sans clé et le retour à la démo sans fuite.
- Capture : `docs/screenshots/live-mission-1440.png`.

### Écarts connus
- **Aucun appel réel à Claude vérifié** : la clé ne peut pas être fournie à cet environnement cloud
  (le domaine Anthropic n'accepte pas de secret réseau) ; à tester dans une session dont
  l'environnement définit `ANTHROPIC_API_KEY`, ou sur un poste local.
- Pas d'annulation de mission depuis le cockpit (une mission bloquée reste visible comme telle).
- Outils : uniquement les adaptateurs démo (aucun connecteur réel ; `APP_MODE=live` refusé).
- À 1440 px, avec le sélecteur d'organisation, certains libellés KPI sont tronqués.

### Prochaine tâche exacte
Avec une clé : `pnpm live:init`, créer un agent, lancer une mission, vérifier coût et résultat réels.
Ensuite : annulation de mission, premier connecteur réel en lecture seule.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm live:init --name "Ma Société"
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e
```

## Session 2026-11-15 (6) — M5 : durcissement et déploiement

**Milestone courant : M5 livré (hors écarts listés). Le plan M0–M5 est parcouru.**

### Réalisé
- **Authentification de production (OIDC)** : l'API vérifie des jetons d'accès JWT (découverte,
  JWKS en cache, `iss`, `aud`, `exp`, algorithmes autorisés). Utilisateurs et rôles lus en base à
  chaque requête ; identité inconnue => 403, aucun compte créé implicitement ; révocation immédiate.
  `pnpm users grant|revoke|list`. Socket.IO authentifié de la même façon.
- **Cockpit** : connexion Authorization Code + PKCE (client public, jeton en sessionStorage
  uniquement), écrans « Connexion requise » / « Accès non autorisé », déconnexion.
- **Sécurité HTTP** : helmet (CSP `default-src 'none'` sur l'API), CORS restreint sans cookies
  (pas de CSRF possible), limitation de débit (`RATE_LIMITED`), CSP de production du cockpit
  (vérifiée sans violation, carte et WebSocket fonctionnels).
- **Configuration validée au démarrage** : en production, refus sans authentification, avec des
  origines ou un émetteur HTTP, ou avec un OIDC partiel ; `APP_MODE=live` toujours refusé.
- **Sauvegarde / restauration** : `pnpm db:backup`, `db:restore` (à côté de la base en service,
  confirmation, mot de passe hors ligne de commande), `db:verify` (séquence contiguë, `last_seq`).
  Restauration testée en CI et via la CLI réelle (1 824 événements restaurés, intégrité OK).
- **OpenTelemetry** : spans `http.request`, `tool.invoke`, `llm.invoke` ; export OTLP seulement si
  configuré ; liste blanche d'attributs (aucun prompt, PII ou contenu injecté — testé).
- **Images Docker** : API + worker (dépendances de production, non-root, healthcheck, aucun
  gestionnaire de paquets au démarrage, 1,24 Go contre 2,65 Go initialement), cible `migrate`,
  cockpit Next standalone (411 Mo). `infra/docker-compose.prod.yml` vérifié de bout en bout :
  migrations, seed démo optionnel, API, worker, cockpit ; une tâche créée via l'API a été exécutée
  par le worker conteneurisé via Temporal.
- **Charge** : `/v1/bootstrap` p95 = 164 ms (p50 124 ms) avec 200 tâches et 10 clients
  concurrents (cible < 500 ms). Banc de rendu `/bench?agents=N` (monde synthétique local).
- **CI** : audit des dépendances de production, construction des trois images, contrôle du refus de
  démarrage sans authentification.
- **Runbooks** : `docs/RUNBOOKS.md` (incident, accès, sauvegarde, déploiement, observabilité,
  ajout d'outil et d'agent, charge).
- **Corrections** : boucle du worker avec attente exponentielle (plus d'erreur toutes les 300 ms sur
  base vide) ; variante d'avatar inconnue => avatar neutre au lieu d'un carré noir ; replay :
  curseur désactivé pendant le chargement et erreur de chargement affichée ; échange OIDC unique
  même si l'effet React est rejoué.

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK · `pnpm audit --prod` : aucune vulnérabilité.
- `pnpm test` : **113 tests passés** (14 fichiers) dont M5 : OIDC (jeton valide, expiré, mauvaise
  audience/émetteur/signature, identité non accordée, viewer, révocation, Socket.IO), en-têtes, CORS,
  limitation de débit, validation de configuration, sauvegarde/restauration/intégrité, traces sans
  données sensibles, charge bootstrap.
- `pnpm e2e` : **20 tests passés** — scénarios M1–M4 + connexion PKCE réelle contre un fournisseur OIDC factice (admin,
  viewer en lecture seule, identité refusée) + banc 50 avatars.
- Images construites et démarrées localement ; pile de production complète démarrée puis détruite.

### Mesures de rendu (honnêtes)
Rendu logiciel (Chromium sans GPU, 4 vCPU) : 1 avatar ≈ 35 img/s, 12 ≈ 30–32, **50 ≈ 21–24**
(23–42 selon le mode de lancement du navigateur), 100 ≈ 15–19, 200 ≈ 9–15. Le plafond est fixé par
le rendu logiciel lui-même (≈ 35 img/s à 1 avatar). Les cibles de docs/08 (60 img/s à 12, > 30 à
50) concernent une machine de bureau avec GPU : **non vérifiées ici**. Une optimisation (sol et murs
précalculés en texture) a été essayée puis retirée : aucun gain mesurable dans cet environnement.

### Écarts connus
- Cibles d'images/s non vérifiables sans GPU ; à mesurer sur le poste de référence (`/bench`).
- Pas de jeton de rafraîchissement OIDC : reconnexion à l'expiration du jeton d'accès.
- Coffre de secrets : variables d'environnement du service (pas de Vault/KMS intégré) ; les images
  n'embarquent aucun secret.
- Temporal de développement dans le compose de production : Temporal Cloud/cluster recommandé.
- Mode `live` (connecteurs réels, organisation live) toujours refusé au démarrage.
- Les tests e2e ne sont pas vérifiés par `tsc` (transpilés par Playwright).
- Accorder/révoquer un accès humain passe par la CLI (journal d'exploitation), pas encore par un
  événement métier visible dans la timeline.

### Prochaine tâche exacte
Au-delà de M5 : mode live encadré (organisation live, premier connecteur réel en lecture seule,
identité de service, validation humaine), puis mesure de rendu sur poste avec GPU.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build
```

## Session 2026-11-15 (5) — M4 : Command Center (alertes, santé outils, replay, recherche, rôles)

**Milestone courant : M4 terminé (hors éléments listés en écarts). Prochain : M5.**

### Réalisé
- **Cycle de vie d'agent** : `agent.paused` / `agent.resumed` / `agent.deactivated` (motif obligatoire ≥ 3 car.,
  Idempotency-Key). Pause : la tâche en cours se termine, aucune nouvelle ne démarre. Désactivation (admin) refusée s'il
  reste des tâches ouvertes ; elle **libère le poste** (`deskAnchor = retired:<id>`, même règle dans le réducteur).
- **Alertes persistées** (migration `m4_alerts`) : dérivées des événements dans la même transaction que `event_log`
  (`alertFromEvent`, partagé client/serveur ; id = eventId). Niveaux info/warning/error/critical. Acquittement idempotent
  (operator+), qui n'est pas un événement métier. `GET /v1/alerts`, `POST /v1/alerts/:id/ack`.
- **Indicateurs serveur** `GET /v1/metrics/summary?window=1h|24h|7d` : taux de succès sur échantillon réel (« — » sans
  échantillon), appels/coût LLM, santé par outil (appels, échecs, taux d'erreur, p95, dégradé si ≥ 50 % d'erreurs sur ≥ 2
  appels). `GET /v1/me` : rôle + capacités.
- **Cockpit** : recherche globale Ctrl/Cmd+K (agents, tâches, outils, départements, validations) ; filtres de département
  (avatars des autres départements estompés, liste équipe, mur d'outils et timeline filtrés) ; filtre de type de timeline ;
  overlay de liens agent→outil animés (uniquement invocations actives, ≤ 5 tracés + « +N regroupés ») et dock d'outils
  cliquable sur la carte ; centre d'alertes (tiroir, niveaux, acquittement) ; KPI « Succès » avec fenêtre 1 h/24 h/7 j ;
  santé dans l'inspecteur d'outil ; boutons Suspendre/Reprendre/Désactiver dans l'inspecteur d'agent.
- **Replay** : reconstruction côté navigateur à partir du journal (`/v1/events`, points de contrôle tous les 200
  événements, même réducteur), lecture 0,5–4×, curseur, bandeau REPLAY permanent ; toute l'UI passe en lecture seule
  (aucun bouton mutateur, KPI serveur masqués) ; vérifié en e2e : **aucune requête non-GET** pendant le replay.
- **Rôles dans l'UI** : boutons mutateurs affichés selon les capacités de `/v1/me` (viewer : aucun) ; le serveur revérifie.
- **Corrections** : hook React appelé après un retour anticipé (inspecteur de validation) + règle ESLint
  `react-hooks/rules-of-hooks` ajoutée ; animations d'avatar arrêtées avant destruction (crash en replay arrière) ;
  barre supérieure compacte à 1440 px ; débordement horizontal du panneau latéral ; tests e2e S05/M4 désormais
  autonettoyants (recrue désactivée, validation refusée) donc rejouables sur la même base.

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm --filter @company-os/web build` OK.
- `pnpm test` : **93 tests passés** (10 fichiers) dont M4 : pause/reprise/désactivation (viewer 403, operator 403 pour
  désactiver, 409 si tâches ouvertes, poste libéré), alertes (même transaction, acquittement idempotent, viewer 403,
  cohérence projection serveur = rejeu client), seed sans alerte, métriques (succès, outil dégradé, null sans
  échantillon), isolation entre organisations (API + temps réel, S10).
- `pnpm e2e` : **15 tests passés**, exécuté deux fois de suite sur la même base. Nouveaux : recherche Ctrl+K, filtre de
  département, S13 (≤ 5 liens, chacun adossé à une invocation serveur), replay sans requête mutatrice, pause/reprise
  d'agent + acquittement d'alerte.
- Captures : `docs/screenshots/m4-cockpit-1440.png`, `docs/screenshots/m4-cockpit-1920.png`.

### Écarts connus
- Timeline non virtualisée : elle affiche la fenêtre récente du snapshot ; l'historique complet passe par le replay.
- Pas de stockage d'artefacts S3 ni de rétention configurable des événements/alertes.
- Rôles : en local, seul le principal dev (admin) ou l'en-tête de test `x-dev-role` ; vrais comptes = OIDC (M5).
- Le replay charge tout le journal dans le navigateur (adapté à quelques milliers d'événements, pas plus).
- Un défaut de composition a été observé en Chromium headless quand un panneau défilant court recouvre le canvas WebGL ;
  contourné (centre d'alertes en tiroir pleine hauteur), non reproduit hors headless faute de navigateur réel ici.

### Prochaine tâche exacte
M5 : authentification OIDC + cookies/CSRF/CSP, secrets hors `.env`, images Docker de prod, sauvegarde/restauration
PostgreSQL testée, OpenTelemetry, test de charge 50+ avatars, CI complète (lint/typecheck/test/e2e/build), runbooks.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build
```

## Session 2026-11-15 (4) — M3 : entreprise organisée (validations, recrutement, réunions, délégation)

**Milestone courant : M3 terminé. Prochain : M4.**

### Réalisé
- **Validations humaines** (`approval_requests`, `approval.requested/decided`) : toute écriture externe (ex. `send_email`)
  met l'invocation en `waiting_approval` ; le workflow Temporal attend durablement le signal `approvalDecided` envoyé par
  l'API (repli : vérification en base toutes les 20 s, expiration à échéance). À la reprise, la gateway revérifie grant,
  kill switch et mode (TOCTOU). Refus/expiration => invocation `rejected`, jamais exécutée. Décision : humains (admin)
  uniquement, terminale, idempotente au double-clic, contraire => CONFLICT.
- **Recrutement (S05)** : action plateforme `propose_agent` (RH) => demande `agent_hire` (aucun agent créé). Approbation
  admin => `agent.created` + `agent.activated` (acteur = l'humain), droits minimaux explicites, budget plafonné, version 1,
  poste libre du département (unicité org+poste) ou salle d'attente de l'accueil. L'avatar apparaît à l'accueil puis
  marche vers son poste ; pas de seconde animation au rechargement.
- **Réunions (S06)** : action `convene_meeting` => salle libre, participants disponibles (un agent occupé n'est pas
  arraché à sa tâche), un siège réservé chacun, `meeting.started` ; synthèse + décisions structurées + délégation,
  `meeting.completed`, retour au poste. Bulle de sujet sur la table, badge « RÉUNION ».
- **Délégation** : `parent_task_id`/`depth`, profondeur ≤ 3, ≤ 5 sous-tâches par parent, cycles d'agents refusés,
  corrélation partagée avec la tâche parente. Assignation automatique : priorité aux agents autorisés pour l'outil requis.
- **Outil « Plateforme »** : actions internes (proposer, réunir, déléguer) passant par la gateway => visibles, auditées.
- **API** : `GET /v1/approvals`, `GET /v1/approvals/:id`, `POST /v1/approvals/:id/decide` (admin, Idempotency-Key, signal
  Temporal), `GET /v1/meetings`, `GET /v1/meetings/:id`.
- **Web** : boîte « À valider » toujours visible, KPI approbations, inspecteurs Validation (aperçu rédigé, motif,
  traçabilité, Approuver/Refuser) et Réunion (participants, sièges, synthèse, décisions, tâches déléguées), badge
  VALIDATION, délégation visible dans l'inspecteur de tâche, nouveaux événements dans la timeline.

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK · `pnpm build` OK.
- `pnpm test` : **85 tests passés** (9 fichiers) dont M3 : action externe approuvée (une seule exécution, séquence
  d'événements exacte), refusée (rejetée, tâche bloquée), décision humaine seulement / double-clic / contraire, S05
  (aucun agent avant décision, poste libre, droits explicites, acteur humain, refus, salle d'attente), S06 (3 sièges
  distincts, décisions, sous-tâche déléguée, participant occupé exclu), délégation (cycle, profondeur, fan-out), signal
  Temporal réel, API (rôles, idempotence). Projection serveur = rejeu client vérifiée à chaque scénario.
- `pnpm e2e` : **10 tests passés** dont S05 (approbation depuis le cockpit + persistance au rechargement), S06 (inspecteur
  de réunion), validation d'email depuis l'inbox.
- Capture : `docs/screenshots/m3-meeting-approvals-1440.png`.

### Écarts connus
- Synthèses et décisions de réunion déterministes (démo) : pas encore de contributions LLM par participant.
- Pas de désactivation/pause d'agent individuelle (`agent.paused/deactivated`) ni de gestion des permissions depuis l'UI.
- Une seule salle de réunion ; si elle est occupée, la réunion échoue (`ROOM_BUSY`) au lieu d'être replanifiée.
- Le cockpit et le worker continus live attendent toujours l'authentification (M5).

### Prochaine tâche exacte
M4 : overlay agent→outil (≤ 5 liens, regroupement), recherche Ctrl+K, filtres de département, santé des outils et
KPI par fenêtre (1h/24h/7j), replay scrubbable sans effet, rôles viewer/operator/admin dans l'UI, pause/désactivation
d'agent, alertes persistées avec acquittement.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build
```

## Session 2026-11-15 (3) — M2 : agent LLM borné, outils sécurisés, coûts, Temporal

**Milestone courant : M2 terminé (parcours LIVE réel non vérifié faute de clé). Prochain : M3.**

### Réalisé
- **Temporal** : service `temporal` dans `docker-compose.yml` (dev server 1.5.1, UI http://localhost:8233). Workflow
  `agentTaskWorkflow` (apps/worker/src/workflows) : la boucle d'agent est déterministe, chaque appel modèle / outil /
  préparation / clôture est une Activity avec timeout et retries. `workflowId = agent-task-<taskId>` (démarrage idempotent).
  Mode `ORCHESTRATOR=inline` conservé pour les tests sans serveur.
- **`packages/agents`** : interface `LLMProvider` ; `AnthropicProvider` (SDK officiel, Messages API + tool use, effort
  explicite, repli serveur `fallbacks: "default"`, outils `strict`, erreurs classées retryable/définitive) ;
  `ScriptedDemoProvider` (démo déterministe, même protocole, zéro appel) ; `MockProvider` (tests). Prompts runtime
  versionnés (docs/13, `PROMPT_VERSION`), sorties d'outils encapsulées `<donnees_non_fiables>`, résultat final via
  `submit_result` validé par Zod (`AgentResult`). Boucle bornée : `maxSteps`, durée, plafond de coût du run, relance unique
  sans résultat, refus modèle, `needs_approval` -> tâche bloquée.
- **`packages/policies`** : rédaction (emails, téléphones, IBAN, cartes, secrets), arithmétique de budget (réserve,
  seuil, pas de division par zéro), tarification depuis `config/llm-pricing.json` (versionnée, datée ; coût = « estimé »).
- **DB (migration `m2_agents_costs_budgets`)** : `agent_versions` (instructions + politique modèle + limites, immuables),
  `llm_usage` (unique par run+étape), `budgets` (org/agent, plafond dur, alerte 80 %), usage cumulé sur `agent_runs`.
  Kill switch (`system.paused/resumed`), `budget.threshold_reached`, usage dans `agent.run.completed`.
- **Gateway** : sorties redigées avant stockage et avant renvoi au modèle ; tout appel d'outil (même non autorisé)
  est audité puis refusé. Fixture d'injection de prompt dans le CRM démo.
- **API** : `POST /v1/system/pause|resume` (admin, Idempotency-Key), `GET /v1/budgets`, détail des runs dans
  `GET /v1/tasks/:id` (fournisseur, modèle, version, workflow, tokens, coût par appel).
- **Web** : KPI coût IA réel (micro-dollars, « estimé » / « aucun appel LLM »), bouton Pause système avec confirmation,
  bannière de pause, carte de run dans l'inspecteur de tâche, budget de l'agent, nouveaux événements dans la timeline.
- `pnpm agent:live-smoke` : exécute UNE tâche avec le vrai modèle Anthropic (org live séparée, outils démo, budget $2).

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK (9 packages) · `pnpm build` OK.
- `pnpm test` : **72 tests passés** (8 fichiers) dont : boucle bornée (maxSteps, coût, refus, résultat invalide),
  requête Anthropic construite via fetch simulé (aucun réseau), parcours live avec MockProvider (coûts estimés, budgets
  imputés, alerte 80 %, plafond dur avant tout appel, fournisseur absent = échec fermé), **injection de prompt** (donnée
  encapsulée, PII rédigée, `send_email` refusé et audité), kill switch, reprise après crash, **workflow sur un vrai
  serveur Temporal** (idempotence du démarrage, activités dans l'historique).
- `pnpm e2e` : **7 tests passés** (stack complète avec orchestration Temporal) dont inspecteur de run et kill switch (S12).
- Constaté manuellement : un worker tué en plein run -> le workflow reprend au redémarrage (tâches terminées sans doublon).
- Capture : `docs/screenshots/m2-run-inspector-1440.png`.
- **Non vérifié** : appel réel à l'API Anthropic (`ANTHROPIC_API_KEY` absente ; `pnpm agent:live-smoke` refuse proprement).

### Écarts connus
- Cockpit et worker continus en mode LIVE non ouverts : nécessitent une vraie authentification (M5). Le live se vérifie
  via `pnpm agent:live-smoke`.
- OpenTelemetry reporté à M5 (logs JSON corrélés en attendant). Pas d'approbations (M3) : toute écriture externe est refusée.
- Si une activité modèle est rejouée après l'appel mais avant l'enregistrement, le second appel n'est pas compté (idempotence
  par étape) : sous-estimation possible, documentée.
- Budgets affichés côté client mis à jour à la fin du run (le contrôle serveur, lui, est fait avant chaque appel).

### Prochaine tâche exacte
M3 : `approval_requests` + `approval.requested/decided` (signal Temporal de reprise), réunions (`meeting.started/completed`,
sièges réservés), proposition RH -> approbation admin -> `agent.created/activated` avec spawn à l'accueil, délégation
bornée (profondeur 3, cycles rejetés), inspecteurs réunion/approbation.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait          # PostgreSQL + Temporal (UI :8233)
pnpm db:migrate && pnpm db:seed
pnpm dev                             # API :4000, worker Temporal, web :3000
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build
ANTHROPIC_API_KEY=... pnpm agent:live-smoke   # optionnel, appel réel payant
```

## Session 2026-11-15 (2) — Alignement M0 sur les specs + M1 (vertical slice)

**Milestone courant : M1 terminé. Prochain : M2.**

### Réalisé
- Pack de specs rangé (`docs/`, `specs/`, `examples/`, `references/`), ADR fusionnés.
- **Contrats** (`packages/contracts`) : enveloppe v1 conforme à `specs/events.schema.json` (eventId, orgId, seq par org,
  aggregate*, correlation/causation, provenance, classification), 14 types de payloads M1 (agent, task, run, tool.invocation),
  statuts + transitions (docs/03 §4), catalogue 8 outils + 7 tâches démo, snapshot bootstrap, protocole Socket, codes d'erreur.
  Test de contrat : enum Zod == enum JSON Schema ; l'exemple `agent-tool-cycle.json` valide l'enveloppe.
- **Monde** (`packages/world`) : carte hq-v1 36×26 (6 départements + réunion + café + accueil, cloisons, portes, mobilier,
  ancres desk/meeting_seat/cafe/entry), A* 4-directions, réducteur idempotent avec détection de trou, KPI, projection visuelle
  (bureau / pause café cosmétique / pose travail-outil), présence « X/Y au poste ».
- **DB** (`packages/db`) : schéma M1 (organizations, users, memberships, departments, agents, agent_tool_grants, tools, tasks,
  agent_runs, tool_invocations, event_log, outbox, idempotency_keys). `withOrgTx` = seul chemin d'écriture (verrou ligne org,
  seq contigu, event_log + outbox dans la même transaction). Services tâches/invocations avec transitions vérifiées et
  concurrence optimiste. Seed relançable : 12 agents, 6 départements, 8 outils, admin local.
- **Outils** (`packages/tools`) : `ToolGateway` (grant explicite, risque : external_write -> APPROVAL_REQUIRED, high_impact refusé,
  kill switch, échec fermé démo, Zod, timeout, retry borné), 9 adaptateurs démo déterministes (ERP fetch_invoice = 503 simulé).
- **Worker** (`apps/worker`) : exécute les tâches sans navigateur, une par agent, concurrence bornée, reprise après crash
  (étapes idempotentes), autopilote démo déterministe et étiqueté (`actor: demo-autopilot`).
- **API** (`apps/api`) : `/health/live`, `/health/ready`, `/v1/me|bootstrap|departments|agents|agents/:id|tasks|tasks/:id|tools|
  tool-invocations|tool-invocations/:id|events`, `POST /v1/tasks` (Idempotency-Key obligatoire, rôle operator+), enveloppes
  `{data,meta}` / `{error:{code,message,requestId}}`, principal de dev limité (dev/test + démo + localhost), Socket.IO
  `events:resume` / `domain:event` / `sync:required`, relais outbox.
- **Web** (`apps/web`) : cockpit 1 écran — topbar (DEMO, 6 KPI), rail (recentrer/zoom), carte Phaser isométrique pixel art
  procédurale (murs, fenêtres, enseigne, cloisons colorées, bureaux avec écrans reflétant l'état réel, plantes, café, accueil),
  12 avatars (8 variantes, marche A* animée, pose travail, chip outil / BLOQUÉ / PAUSE), badges de département, pan/zoom,
  hitbox découplée ; panneau droit inspecteur (agent, tâche, invocation, département, outil) ou liste Équipe (alternative
  HTML) ; mur des outils Actifs/Récents (durées depuis les horodatages persistés) ; timeline live cliquable ; toasts.

### Tests (exécutés le 2026-11-15)
- `pnpm lint` OK · `pnpm typecheck` OK (7 packages) · `pnpm build` OK.
- `pnpm test` : **46 tests passés** (contrats 8, monde 8, DB 9, workflow/worker 9, API 12) — dont S02, S04, S07, S09,
  reprise après crash, seq contigu sous concurrence, projection serveur = rejeu client.
- `pnpm e2e` : **5 tests passés** — S01 premier affichage, clic avatar dans le canvas -> inspecteur, S02 cycle complet + refresh,
  S03 coupure WebSocket en plein run (aucun événement perdu/doublé), S04 erreur ERP visible.
- Captures : `docs/screenshots/m1-cockpit-1440.png`, `docs/screenshots/m1-cockpit-1920.png`.
- CI : `.github/workflows/ci.yml` (lint/typecheck/test/build + job e2e) — **écrit, pas encore exécuté sur GitHub**.

### Écarts connus
- Temporal pas encore branché (frontière : `apps/worker/src/workflows`), prévu M2 avec le vrai agent.
- Pas d'approbations, réunions, création d'agent via RH, replay, overlay agent→outil, recherche Ctrl+K (M3/M4).
- Auth réelle absente : seul le principal de dev local existe (refusé hors démo/dev/localhost).
- Performances (fps, p95) non mesurées. Régression visuelle non outillée.
- Les incidents KPI = tâches bloquées/échouées dans la fenêtre bornée du snapshot (pas encore de fenêtres 1h/24h).

### Prochaine tâche exacte
M2 : `packages/agents` (LLMProvider + adaptateur Anthropic, AgentRunner borné maxSteps/coût/timeout), Temporal dans
docker-compose + workflow `qualifyLead`, table `llm_usage` + coûts mesurés/estimés, budgets hard/soft, redaction et
tests de prompt injection ; tout reste testable en démo sans clé.

### Commandes de reprise
```bash
cp .env.example .env && pnpm install
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
pnpm dev            # API :4000, worker, web :3000
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build
```

## Session 2026-11-15 — M0 (fondations)

### Réalisé

- Monorepo pnpm, TypeScript strict, ESLint (strict, `no-explicit-any`), Prettier, Vitest, Playwright.
- `docker-compose.yml` : PostgreSQL 16 (+ base `companyos_test`).
- `packages/contracts` : événements `agent.spawned`, `agent.moved`, `agent.status_changed` (union discriminée Zod),
  snapshot du monde, protocole Socket.IO, plan du bureau.
- `packages/db` : migration Prisma `init` (Company, Agent, Event, OutboxMessage), `appendEvents` transactionnel
  (verrou par entreprise, validation, état + journal + outbox, idempotency key, séparation demo/live), snapshot
  cohérent, rejeu, relais outbox, seed demo idempotent.
- `apps/api` : `/health`, `GET /api/companies/:id/world|events|agents/:agentId`, Socket.IO `world:subscribe`
  avec rejeu depuis `afterSeq`, relais outbox → rooms.
- `apps/worker` : simulateur demo déterministe (PRNG seedé par `lastSeq`), indépendant du navigateur.
- `apps/web` : QG isométrique Phaser (sol, murs, bureaux avec écrans qui s'allument quand l'agent travaille,
  salle de réunion, café), avatars pixel art animés (marche tuile par tuile, apparition animée), clic avatar →
  inspecteur (état + trace d'actions), roster, KPI, journal temps réel, badge MODE DÉMO, état de connexion.

### Tests (exécutés)

- `pnpm test` : 21 tests passés (contrats, projection, DB/outbox/concurrence/idempotence, API HTTP + Socket.IO, simulateur).
- `pnpm e2e` : 4 tests passés (badge démo, clic avatar dans le canvas → inspecteur, flux temps réel, reprise après coupure WebSocket).
- `pnpm lint`, `pnpm typecheck`, `pnpm build` : OK.
- Capture : `docs/screenshots/m0-hq-1440.png` (1440x900).

### Écarts / non fait

- Docs de spec (`docs/01..09`, `START_HERE.md`, `specs/`, `references/`) absents : M0 interprété depuis `CLAUDE.md`.
- Pas encore de Temporal, de vrais agents LLM, d'outils, de tâches, d'alertes, de politiques, de kill switch ni de mode live.
- Pas de Dockerfiles applicatifs (seul PostgreSQL est conteneurisé).
- Validation visuelle en 1920x1080 non capturée.

> Remplacé par la session M0-alignement + M1 ci-dessous (enveloppe d'événements, schéma et UI refaits selon les specs).
