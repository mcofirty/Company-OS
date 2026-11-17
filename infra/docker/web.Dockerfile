# Cockpit Next.js en sortie « standalone » (image légère, pas de node_modules complet).
#   docker build -f infra/docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com -t company-os-web .
# NEXT_PUBLIC_* est figé au build et ne contient aucun secret.
FROM node:22.22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Proxy d'entreprise : CA optionnelle passée en secret de build (jamais copiée dans l'image) :
#   --secret id=extra_ca,src=/chemin/ca.crt  (+ --build-arg HTTPS_PROXY=… si nécessaire)
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
# true : serveur « réel uniquement » (aucune page ni mention de démonstration).
ARG NEXT_PUBLIC_LIVE_ONLY=false
ENV NEXT_PUBLIC_LIVE_ONLY=$NEXT_PUBLIC_LIVE_ONLY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter @company-os/web...
RUN pnpm --filter @company-os/web build

FROM node:22.22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
