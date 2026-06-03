# syntax=docker/dockerfile:1

# Multi-stage build for Next.js (bun) targeting Cloud Run
# Uses standalone output for smaller images

FROM oven/bun:1.2.18-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apk add --no-cache libc6-compat

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
COPY packages/inbox/package.json ./packages/inbox/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/policy/package.json ./packages/policy/
COPY packages/retrieval/package.json ./packages/retrieval/
COPY packages/scheduling/package.json ./packages/scheduling/
COPY packages/tenants/package.json ./packages/tenants/
COPY packages/utils/package.json ./packages/utils/
# Install all deps including dev (needed for build)
RUN bun install

# Build application
# Start from the deps stage so the installed node_modules + manifests
# are already present, then layer the source on top.
FROM deps AS builder
WORKDIR /app
# Bun 1.2.18 segfaults (SIGILL) running Next's build under musl/alpine on
# larger builds (Bun-on-glibc is fine — that's what CI uses). Deps are still
# installed with Bun above; only the build step's JS runtime switches to Node.
RUN apk add --no-cache nodejs
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
# Build Next.js (standalone output) with Node — see the Bun/musl note above.
RUN cd apps/web && node /app/node_modules/next/dist/bin/next build

# Production runner (standalone — no separate node_modules needed)
FROM node:20-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

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
