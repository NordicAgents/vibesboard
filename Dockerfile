# syntax=docker/dockerfile:1

# Multi-stage build for Next.js targeting Cloud Run
# Uses standalone output for smaller images

# Copy the pinned Bun package manager into a real Node 22/glibc build image.
# The oven/bun image's `node` fallback runs Bun, which is not compatible with
# Next.js 16's production metadata build. Next must execute under Node.
FROM oven/bun:1.2.18@sha256:2cdd9c93006af1b433c214016d72a3c60d7aa2c75691cb44dfd5250aa379986b AS bun
FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Install deps (cached layer)
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
# Every workspace package's manifest must be present before `bun install`
# resolves the workspace:* refs in apps/web/package.json. The workspace
# globs themselves live in the root package.json copied above.
COPY packages/adapter-better-auth/package.json ./packages/adapter-better-auth/
COPY packages/adapter-google/package.json ./packages/adapter-google/
COPY packages/adapter-openai/package.json ./packages/adapter-openai/
COPY packages/adapter-postgres/package.json ./packages/adapter-postgres/
COPY packages/adapter-s3/package.json ./packages/adapter-s3/
COPY packages/agents/package.json ./packages/agents/
COPY packages/ai/package.json ./packages/ai/
COPY packages/booking-enquiries/package.json ./packages/booking-enquiries/
COPY packages/channel-chatwoot/package.json ./packages/channel-chatwoot/
COPY packages/channel-instagram/package.json ./packages/channel-instagram/
COPY packages/channel-whatsapp/package.json ./packages/channel-whatsapp/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/data/package.json ./packages/data/
COPY packages/hybrid-memory/package.json ./packages/hybrid-memory/
COPY packages/inbox/package.json ./packages/inbox/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/policy/package.json ./packages/policy/
COPY packages/retrieval/package.json ./packages/retrieval/
COPY packages/scheduling/package.json ./packages/scheduling/
COPY packages/tenants/package.json ./packages/tenants/
COPY packages/test-helpers/package.json ./packages/test-helpers/
COPY packages/utils/package.json ./packages/utils/
# Install all deps including dev (needed for build)
RUN bun install --frozen-lockfile

# Build application
# Start from the deps stage so the installed node_modules + manifests
# are already present, then layer the source on top.
FROM deps AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY . .
# Inject public runtime configuration at build time for client bundles
ARG NEXT_PUBLIC_AUTH_GOOGLE
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_META_APP_ID
ARG NEXT_PUBLIC_FB_LOGIN_CONFIG_ID
ENV NEXT_PUBLIC_AUTH_GOOGLE=$NEXT_PUBLIC_AUTH_GOOGLE \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_META_APP_ID=$NEXT_PUBLIC_META_APP_ID \
    NEXT_PUBLIC_FB_LOGIN_CONFIG_ID=$NEXT_PUBLIC_FB_LOGIN_CONFIG_ID
# Bun orchestrates the workspace script; the `next` executable uses real Node.
RUN bun run --filter @vibesboard/web build

# Production runner (standalone — no separate node_modules needed).
# Debian (glibc) slim to match the glibc build image above.
FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin nextjs

# The standalone server only needs Node. Remove package managers from the
# runtime image to reduce its attack surface (and avoid shipping npm's bundled
# dependency tree, which is not used by the application).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Copy standalone build (includes server + minimal node_modules)
# Next.js standalone in a monorepo places the server under apps/web/
COPY --from=builder /app/apps/web/.next/standalone ./
# Copy static assets and public files into the standalone server root
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Create cache dir writable by nextjs user (image optimization, etc.)
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache

USER nextjs
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
