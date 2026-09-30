# syntax=docker/dockerfile:1
# Portaless self-hosted -- imagen multi-stage (ADR-004).
#
# builder: compila los modulos nativos (better-sqlite3, isolated-vm) DENTRO de
#          Linux y construye Astro. Nunca se copian node_modules del host.
# runner:  misma base (Node 24 + glibc de bookworm) sin compiladores ni devDeps.
#
# El contenedor arranca como root solo para ajustar el dueno de /data (Railway y
# Render montan los volumenes como root) y enseguida baja a UID 1000 (node).
# Ver scripts/docker-entrypoint.mjs.

FROM node:24-bookworm-slim AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PORTALESS_SQLITE_PATH=/data/portaless.db \
    PORTALESS_RUN_UID=1000 \
    PORTALESS_RUN_GID=1000
WORKDIR /app
COPY --from=builder --chown=node:node /app ./
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "scripts/docker-entrypoint.mjs"]
