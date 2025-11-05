# syntax=docker/dockerfile:1

# Multi-stage build for Next.js (pnpm) targeting Cloud Run

FROM node:20-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable

# Install deps (cached layer)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Install all deps including dev (needed for build)
RUN pnpm install --no-frozen-lockfile --prod=false

# Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Inject public runtime configuration at build time for client bundles
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_AUTH_GITHUB
ARG NEXT_PUBLIC_AUTH_GOOGLE
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_AUTH_GITHUB=$NEXT_PUBLIC_AUTH_GITHUB \
    NEXT_PUBLIC_AUTH_GOOGLE=$NEXT_PUBLIC_AUTH_GOOGLE \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Build Next.js
RUN pnpm run build

# Production runner (no-standalone; use next start)
FROM node:20-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
RUN corepack enable

# Only install production dependencies for runtime
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile --prod

# Copy build artifacts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next

USER nextjs
EXPOSE 8080
# Use next directly; honor Cloud Run's PORT if provided
CMD ["sh", "-c", "node node_modules/next/dist/bin/next start -p ${PORT:-8080} -H 0.0.0.0"]
