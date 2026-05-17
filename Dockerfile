# syntax=docker/dockerfile:1

# Multi-stage build for Next.js (pnpm) targeting Cloud Run
# Uses standalone output for smaller images

FROM node:20-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable

# Install deps (cached layer)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
# Every workspace package's manifest must be present before `pnpm install`
# resolves the workspace:* refs in apps/web/package.json.
COPY packages/adapter-firebase/package.json ./packages/adapter-firebase/
COPY packages/adapter-google/package.json ./packages/adapter-google/
COPY packages/adapter-openai/package.json ./packages/adapter-openai/
COPY packages/adapter-stripe/package.json ./packages/adapter-stripe/
COPY packages/agents/package.json ./packages/agents/
COPY packages/ai/package.json ./packages/ai/
COPY packages/billing/package.json ./packages/billing/
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
COPY packages/utils/package.json ./packages/utils/
# Install all deps including dev (needed for build)
RUN pnpm install --no-frozen-lockfile --prod=false

# Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
# Workspace packages get their pnpm-managed node_modules from the deps
# stage. The `COPY . .` below would overwrite source, so we layer the
# deps stage's symlinks first, then the source.
COPY --from=deps /app/packages ./packages
COPY . .
# Inject public runtime configuration at build time for client bundles
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_AUTH_GOOGLE
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_META_APP_ID
ARG NEXT_PUBLIC_FB_LOGIN_CONFIG_ID
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_AUTH_GOOGLE=$NEXT_PUBLIC_AUTH_GOOGLE \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_META_APP_ID=$NEXT_PUBLIC_META_APP_ID \
    NEXT_PUBLIC_FB_LOGIN_CONFIG_ID=$NEXT_PUBLIC_FB_LOGIN_CONFIG_ID \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
# Build Next.js (standalone output)
RUN pnpm --filter @vibesboard/web build

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
