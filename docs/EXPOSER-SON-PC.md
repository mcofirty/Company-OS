# Utiliser Living HQ à distance : ton PC + Cloudflare Tunnel (gratuit)

Le backend (API, worker des agents, PostgreSQL, Temporal) tourne sur **ton PC** ; un tunnel Cloudflare
lui donne une adresse HTTPS publique ; le cockpit hébergé sur Vercel
(https://company-os-web-ten.vercel.app) s'y connecte avec un **jeton d'accès**.
Limite : l'application n'est joignable que lorsque ton PC et le tunnel sont allumés.

## 1. Prérequis (une fois)
- Git, **Node.js 22**, **Docker Desktop** (démarré), puis `corepack enable` (active pnpm).
- **cloudflared** :
  - Windows : `winget install --id Cloudflare.cloudflared`
  - macOS : `brew install cloudflared`
  - Linux : paquet `.deb`/`.rpm` sur https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

## 2. Installer le projet (une fois)
```bash
git clone https://github.com/mcofirty/Company-OS.git
cd Company-OS
git checkout claude/charming-fermat-8jkw0y
pnpm install
cp .env.example .env
```
Dans `.env` :
- `API_ACCESS_TOKEN=` : colle un secret long, généré avec
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
  **Garde-le pour toi** : il donne les droits administrateur (validations, pause système).
- `WEB_ORIGIN=http://localhost:3000,https://company-os-web-ten.vercel.app`

Puis :
```bash
docker compose up -d --wait
pnpm db:migrate && pnpm db:seed
```

## 3. Lancer (à chaque session)
Terminal 1 — le backend :
```bash
docker compose up -d --wait
pnpm backend:start
```
Terminal 2 — le tunnel (tunnel rapide, sans compte ni domaine) :
```bash
cloudflared tunnel --url http://localhost:4000
```
Il affiche une adresse du type `https://xxxx-yyyy.trycloudflare.com` (nouvelle à chaque lancement).

## 4. Se connecter depuis n'importe où
1. Ouvre https://company-os-web-ten.vercel.app
2. Bouton **⚙ Connexion au backend** (rail de gauche, ou dans le bandeau rouge).
3. URL = l'adresse `trycloudflare.com`, jeton = ton `API_ACCESS_TOKEN` → **Se connecter**.
Le choix est mémorisé dans ce navigateur seulement ; à chaque nouvelle URL de tunnel, refais l'étape 3.

## Sécurité
- Avec `API_ACCESS_TOKEN` défini, l'API **refuse tout** sans jeton, y compris depuis localhost
  (derrière un tunnel, toutes les requêtes semblent locales) ; le jeton est comparé en temps constant.
- Seul le port 4000 (API) est exposé : PostgreSQL, Temporal et son interface restent locaux.
- Mode DEMO : aucun appel externe, aucune clé LLM nécessaire.
- Adresse stable (optionnel) : un *tunnel nommé* sur ton propre domaine Cloudflare
  (`cloudflared tunnel create`, puis DNS `api.ton-domaine`) ; on peut ajouter Cloudflare Access en plus.

## Dépannage
- Bandeau rouge « Backend non joignable » : backend arrêté, tunnel fermé, URL expirée ou jeton faux.
- `WEB_ORIGIN` doit contenir l'URL Vercel, sinon le navigateur bloque les appels (CORS).
