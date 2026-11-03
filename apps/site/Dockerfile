# syntax=docker/dockerfile:1
#
# The product website: the built pages and the waitlist server, in one image.
# Build from the repository root, which holds the workspace manifests:
#
#   docker build -f apps/site/Dockerfile -t plomba-site .
#   docker run -p 8080:8080 -v plomba-site-data:/data plomba-site

ARG NODE_VERSION=24

# Everything building the site needs (layer cached until a manifest changes).
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/site/package.json apps/site/
RUN npm ci --workspace @plomba/site --include-workspace-root=false

# Generate the pages. SITE_URL is where the site is published, for canonical
# URLs, link previews and the sitemap.
FROM deps AS build
ARG SITE_URL=https://plomba.lisovate.com
COPY packages/core/src packages/core/src
COPY apps/web/public/icons apps/web/public/icons
COPY apps/site apps/site
RUN SITE_URL=${SITE_URL} npm run build --workspace @plomba/site

# The server's production dependencies only: Hono and zod.
FROM node:${NODE_VERSION}-bookworm-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/site/package.json apps/site/
RUN npm ci --omit=dev --workspace @plomba/site --include-workspace-root=false

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WAITLIST_DB=/data/waitlist.db
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/site/package.json apps/site/
COPY apps/site/server apps/site/server
# The server renders its own pages (the form's answers) with the same layout.
COPY apps/site/src apps/site/src
COPY --from=build /app/apps/site/dist apps/site/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Node 24 runs the TypeScript sources directly: no compile step.
CMD ["node", "apps/site/server/main.ts"]
