# Image API + worker (docs/11 §2) : même code, commande différente ; dépendances de production
# seulement. Une cible séparée « migrate » contient la CLI Prisma pour les migrations contrôlées.
#   docker build -f infra/docker/server.Dockerfile -t company-os-server .
#   docker build -f infra/docker/server.Dockerfile --target migrate -t company-os-migrate .
#   API    : docker run … company-os-server
#   Worker : docker run … company-os-server apps/worker/node_modules/.bin/tsx apps/worker/src/main.ts
# Le TypeScript est exécuté par tsx (dépendance d'exécution déclarée) ; aucun gestionnaire de
# paquets n'est appelé au démarrage (pas de réseau requis). Secrets : environnement d'exécution.
FROM node:22.22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_HOME=/pnpm/corepack
# Proxy d'entreprise : CA optionnelle passée en secret de build (jamais copiée dans l'image) :
#   --secret id=extra_ca,src=/chemin/ca.crt  (+ --build-arg HTTPS_PROXY=… si nécessaire)
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Manifestes seuls : la couche d'installation reste en cache tant que les dépendances ne changent pas.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/agents/package.json packages/agents/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/policies/package.json packages/policies/
COPY packages/tools/package.json packages/tools/
COPY packages/world/package.json packages/world/
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/

# Installation complète : génère le client Prisma et sert de base à la cible « migrate ».
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter @company-os/api... --filter @company-os/worker...

# Dépendances de production uniquement (sans scripts : le client Prisma vient de « deps »).
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
      --filter @company-os/api... --filter @company-os/worker...

FROM deps AS migrate
COPY tsconfig.base.json ./
COPY packages packages
WORKDIR /app/packages/db
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:22.22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app /app
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node config config
COPY --chown=node:node packages packages
COPY --chown=node:node apps/api apps/api
COPY --chown=node:node apps/worker apps/worker
COPY --from=deps --chown=node:node /app/packages/db/src/generated packages/db/src/generated
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["apps/api/node_modules/.bin/tsx", "apps/api/src/server.ts"]
