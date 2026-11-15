# 11 — Environnements, déploiement, sauvegarde et sécurité opérationnelle

## 1. Environnements
- `local-demo`: Docker Postgres, API/web/worker Node, provider demo, données fictives, aucun outil réel, localhost seulement.
- `local-live`: clés configurées, accès aux outils **lecture seulement** par défaut, approvals actives, contrôles stricte ; réservé développeur.
- `staging`: domaine de test, Postgres propre, secrets distincts, OIDC, tests contractuels et e2e, aucune cible de production connectée.
- `production`: HTTPS/TLS, OIDC, comptes de service distincts, audit, DB managée + backups, Temporal managé ou opéré proprement, métriques, alarmes, quotas.

## 2. Topologie initiale
Docker Compose pour poste développeur avec PostgreSQL et Temporal dev (ou Temporal server + dépendances officielles selon version vérifiée). API/worker/web localement via pnpm. Pour déploiement, choisir plateforme supportant **workers persistants et WebSockets** : ne pas héberger agents/workflows critiques uniquement dans fonctions serverless courtes. Exemple générique : web hébergé, API realtime en service long-running, worker Temporal en service distinct, PostgreSQL managé, object storage S3-compatible.

## 3. Variables d'environnement attendues
Se référer à `.env.example` ; ne jamais commit `.env`. `APP_MODE`, `DATABASE_URL`, `ANTHROPIC_API_KEY` (si runtime provider), `OPENAI_API_KEY` (si adaptateur), `TEMPORAL_ADDRESS`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SOCKET_URL`, `ALLOW_EXTERNAL_SIDE_EFFECTS`, `BUDGET`, OIDC settings et log level. **Les variables `NEXT_PUBLIC_` ne doivent contenir aucun secret.** Config validation au démarrage avec Zod ; production refuse `APP_MODE=live` si secrets, policies ou identity setup sont incomplets.

## 4. Séquence de démarrage
1. Vérifier Node LTS, pnpm, Docker et ports.
2. Copier `.env.example` vers `.env` **local** et ajuster les valeurs de développement.
3. `pnpm install` puis `docker compose up -d`.
4. `pnpm db:migrate` puis `pnpm db:seed` (seeds autorisés en demo uniquement).
5. `pnpm dev`; web sur `localhost:3000`, API sur `localhost:4000` sauf conflit (documenter ports réels).
6. Tester `/health/live`, `/health/ready`, `/v1/bootstrap`, scénario DEMO.
7. Avant LIVE : identity, connecteurs, limites, approvals, sécurité, tests.

Ces commandes sont la **cible à implémenter par Claude Code**, pas un état déjà testé du pack documentaire.

## 5. Continuité
- Backups Postgres automatisés, RPO/RTO définis après choix infra ; test de **restauration**, pas seulement présence des backups.
- Migrations en déploiement contrôlé, versionning API/événements, comportement en cas de mismatch frontend/backend.
- Temporal worker versioning et migration des workflows pour les exécutions longues ; ne pas changer les étapes de workflow incompatiblement en production sans stratégie.
- Export/rotation logs, traces et secrets ; journal d'audit protégé et contrôles d'accès aux consoles d'observabilité.
- Connexion interrompue : UI reconnecte/rejoue, agent continue côté worker. Un redémarrage Phaser ne restart jamais un agent run.

## 6. Mise en sécurité
- Cookies Secure/HttpOnly/SameSite si session ; CSP ; CSRF protection des endpoints mutateurs ; CORS restrictif.
- Auth sur Socket.IO handshake, validation `orgId`, rate-limit, rooms multi-tenant isolées.
- Permissions au point d'appel outil, redaction logs et PII, stockage secrets externe.
- Monitoring vulnérabilités des dépendances et licences des assets.
- Pare-feu sortie pour les tools et limites de réseau; pas d'exécution de code libre par LLM.
- `killSwitch` org (stop nouvelles actions) + mécanisme de reprise admin auditée ; révocation des credentials exposés.

## 7. Guide incident
1. Identifier agent/task/workflow/tool via timeline et correlationId.
2. Suspendre agent/org si risque.
3. Isoler `tool_connection` concernée ; révoquer clé si nécessaire.
4. Vérifier les effets réels déjà produits avant retry.
5. Examiner logs redacted/trace ; créer correction et test de non-régression.
6. Réactiver après accord admin et vérification de l'état external.

## 8. Risques explicitement non résolus par une simple architecture
RGPD, conservation des données, conditions contractuelles des APIs, politiques RH, confidentialité fournisseur modèle et conformité sectorielle doivent être **évalués avant tout branchement réel**. Pour Claude Fable 5.2, vérifier la politique de conservation actuelle du fournisseur, particulièrement pour données sensibles. Le pack ne constitue pas une validation juridique ou sécurité d'une entreprise en production.
