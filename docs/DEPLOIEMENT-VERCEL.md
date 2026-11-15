# Déployer l'interface (apps/web) sur Vercel

Vercel n'héberge que le **cockpit Next.js**. L'API temps réel (Fastify + Socket.IO), le worker Temporal,
PostgreSQL et Temporal ont besoin de services persistants (docs/11 §2) : ils restent ailleurs
(poste local exposé via Cloudflare Tunnel, VPS…). Sans API joignable, le cockpit affiche
« Backend non joignable » et **ne simule rien** dans le navigateur.

## Import du projet (une fois)
1. vercel.com → **Add New… → Project** → importer `mcofirty/Company-OS`.
2. **Root Directory** : `apps/web` (laisser « Include files outside the root directory » activé : le
   monorepo pnpm est nécessaire). Le fichier `apps/web/vercel.json` fixe le framework, l'installation
   filtrée (`pnpm install --filter @company-os/web...`) et le build.
3. **Production Branch** : la branche de travail actuelle (`claude/charming-fermat-8jkw0y`) tant qu'il n'y a pas de `main`.
4. **Environment Variables** (aucun secret ici, elles sont publiques côté navigateur) :
   - `NEXT_PUBLIC_API_BASE_URL` = URL HTTPS de l'API (ex. `https://api.mon-domaine.fr`)
   - `NEXT_PUBLIC_SOCKET_URL` = même URL (Socket.IO)
5. Deploy. Chaque push sur la branche redéploie automatiquement.

## Côté API (quand elle sera exposée)
- `WEB_ORIGIN` doit valoir l'URL Vercel (CORS).
- L'API refuse tout principal hors développement + démo + localhost : l'exposer publiquement exige
  l'authentification de M5 (ou une protection en amont, ex. Cloudflare Access).

## Vérifié
Install + build reproduits depuis un clone propre, sans `DATABASE_URL` ni backend (2026-11-15).
