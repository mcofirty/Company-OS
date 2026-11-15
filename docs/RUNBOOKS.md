# Runbooks d'exploitation

Procédures vérifiées en M5. Chaque commande s'exécute à la racine du dépôt (ou dans les conteneurs
de `infra/docker-compose.prod.yml`). Complète `docs/11-DEPLOIEMENT.md` §7.

## 1. Incident : un agent ou un outil se comporte mal

1. **Identifier** : timeline du cockpit → inspecteur (tâche, invocation, run). Noter le
   `correlationId` ; `GET /v1/tasks/:id` renvoie la tâche, ses invocations et la chaîne complète
   d'événements corrélés.
2. **Contenir**, du plus ciblé au plus large :
   - un agent : inspecteur d'agent → *Suspendre* (`POST /v1/agents/:id/pause`, motif obligatoire).
     La tâche en cours se termine, aucune nouvelle ne démarre ;
   - tout le système : bouton *Pause système* (kill switch). Aucune exécution ni invocation d'outil
     ne démarre ; un run en cours s'arrête au prochain appel modèle ;
   - un accès humain : `pnpm users revoke --sub <sub>` (effet immédiat, le rôle est relu à chaque
     requête).
3. **Vérifier les effets réels** déjà produits (outils externes) avant toute relance. En mode démo,
   aucun effet externe n'existe.
4. **Analyser** : logs JSON (Pino, en-tête `x-request-id`), traces OpenTelemetry (`tool.invoke`,
   `llm.invoke`, `http.request`) filtrées par `run.id` / `tool.invocation_id`.
5. **Corriger** avec un test de non-régression, puis *Reprendre* (agent ou système). La reprise est
   un événement audité (`agent.resumed`, `system.resumed`).

## 2. Accès humains (OIDC)

Côté fournisseur (Keycloak, Auth0, Entra ID, Zitadel…) :
- créer un **client public** (pas de secret) avec *Authorization Code + PKCE (S256)* ;
- URI de redirection : l'URL du cockpit suivie de `/` (ex. `https://hq.example.com/`) ;
- émettre des **jetons d'accès JWT** dont l'audience est `OIDC_AUDIENCE` (ex. l'identifiant de l'API).
  Les jetons opaques ne sont pas acceptés.

Côté plateforme, dans `.env` / `.env.production` : `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`.
Puis accorder les comptes, un par un (aucune création implicite) :

```bash
pnpm users grant --sub <sub du fournisseur> --name "Prénom Nom" --role admin
pnpm users grant --sub <sub> --name "…" --role operator
pnpm users list
pnpm users revoke --sub <sub>
```

Rôles : `viewer` (lecture), `operator` (tâches, suspension d'agent, acquittement d'alertes),
`admin` (validations, désactivation d'agent, pause système). Le serveur revérifie chaque action.

**Jeton unique (usage personnel)** : `API_ACCESS_TOKEN` (≥ 32 caractères). Rotation : générer un
nouveau jeton, redémarrer l'API, le saisir dans « Connexion au backend » ; l'ancien est refusé.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 3. Sauvegarde et restauration PostgreSQL

```bash
pnpm db:backup                       # backups/companyos-<horodatage>.dump (format custom)
pnpm db:verify                       # intégrité du journal (séquence contiguë, last_seq)
```

Restauration : **toujours à côté** de la base en service, vérifier, puis basculer `DATABASE_URL`.

```bash
createdb companyos_restore           # ou CREATE DATABASE via psql
pnpm db:restore --file backups/<fichier>.dump --target-url postgresql://…/companyos_restore --yes
```

La commande refuse la base en service, exige `--yes`, puis lance le contrôle d'intégrité (code de
sortie 2 si le journal est incohérent). Le test `packages/db/src/backup.test.ts` rejoue la procédure
complète en CI (sauvegarde, restauration, état et rejeu identiques). Planifier `pnpm db:backup`
(cron, job du fournisseur cloud) et conserver les fichiers hors de la machine ; ils contiennent des
données métier : jamais dans le dépôt (`backups/` est ignoré par git).

## 4. Déploiement et migrations

```bash
cp infra/prod.env.example .env.production     # remplir ; jamais versionné
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
# démonstration : ajouter --profile demo (organisation fictive)
```

- Le service `migrate` applique les migrations versionnées **avant** l'API et le worker
  (`prisma migrate deploy` : jamais de reset). Une migration en échec bloque le démarrage.
- L'API refuse de démarrer en production sans authentification, avec des origines ou un émetteur
  non HTTPS, ou avec une configuration OIDC partielle. `APP_MODE=live` reste refusé.
- Placer un reverse proxy TLS devant `web` (3000) et `api` (4000) ; WebSocket requis pour l'API.
- Temporal : le serveur de développement embarqué convient à une démo ; en production réelle,
  utiliser Temporal Cloud ou un cluster dédié (`TEMPORAL_ADDRESS`).
- Proxy d'entreprise pour construire les images : `--secret id=extra_ca,src=ca.crt` et
  `--build-arg HTTPS_PROXY=…` (le certificat n'est jamais copié dans l'image).

## 5. Observabilité

- Logs : JSON sur la sortie standard (API : Pino avec `requestId` ; worker : `service: worker`).
  L'en-tête `Authorization` est masqué.
- Traces : définir `OTEL_EXPORTER_OTLP_ENDPOINT` (ex. `http://otel-collector:4318`) et
  éventuellement `OTEL_SERVICE_NAME`. Sans cette variable, aucune trace n'est émise.
  Seuls des identifiants et des mesures sortent (liste blanche `SPAN_ATTRIBUTE_ALLOWLIST`),
  jamais de prompt, d'email ou de contenu métier.
- Santé : `/health/live` (processus), `/health/ready` (base + outbox en attente).
- Coûts : KPI « Coût IA » et `GET /v1/metrics/summary?window=24h` ; budgets à plafond dur.

## 6. Ajouter un outil

1. Déclarer l'outil et ses actions (risque `read`, `internal_write`, `external_write`,
   `high_impact`) dans `TOOL_CATALOG` (`packages/contracts/src/catalog.ts`).
2. Écrire l'adaptateur (schéma Zod d'entrée, exécution, résumé sûr) dans
   `packages/tools/src/adapters.ts`. Démo : aucun appel externe. Live : identité de service propre,
   secrets côté serveur uniquement.
3. Accorder l'outil explicitement aux agents concernés (grants) ; sans grant, la passerelle
   refuse (`POLICY_DENIED`). `external_write` passe toujours par une validation humaine ;
   `high_impact` est refusé.
4. Tests : autorisation, refus, validation, échec (503) ; vérifier qu'il apparaît dans le mur des
   outils et le dock de la carte.

## 7. Ajouter un agent

- En exploitation : l'agent RH propose (`propose_hire`), un **admin** approuve depuis la boîte
  « À valider » ; l'agent est créé avec exactement les droits listés et un budget plafonné.
- En démo : `DEMO_AGENTS` dans `packages/db/src/seed-data.ts` (poste libre de son département).
- Retirer : *Désactiver* (admin) ; refusé tant que des tâches sont ouvertes ; le poste est libéré.

## 8. Charge

- API : `apps/api/src/load.test.ts` (p95 de `/v1/bootstrap` < 500 ms avec 200 tâches).
- Rendu : `/bench?agents=50` (monde synthétique local, compteur d'images/s, aucune requête réseau).
