# syntax=docker/dockerfile:1
#
# One image: the API server, which also serves the built web app.
#   docker build -t plomba .
#   docker compose up        (see compose.yaml)

ARG NODE_VERSION=24

# Install every workspace's dependencies (layer cached until a manifest changes).
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
RUN npm ci

# Check and build the web app (`npm run build` builds the product site too).
FROM deps AS build
COPY . .
RUN npm run lint && npm run typecheck && npm test && npm run build

# Production dependencies of the server only.
FROM node:${NODE_VERSION}-bookworm-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @plomba/server --include-workspace-root=false

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/contracts/package.json packages/contracts/
COPY packages/contracts/src packages/contracts/src
COPY apps/server/package.json apps/server/
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Node 24 runs the TypeScript sources directly (type stripping): no compile step.
CMD ["node", "apps/server/src/main.ts"]
