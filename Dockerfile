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
COPY package.json pnpm-lock.yaml ./
# Install all deps including dev (needed for build)
RUN pnpm install --no-frozen-lockfile --prod=false

# Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
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
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_AUTH_GOOGLE=$NEXT_PUBLIC_AUTH_GOOGLE \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Build Next.js (standalone output)
RUN pnpm run build

# Production runner (standalone — no separate node_modules needed)
FROM node:20-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Copy standalone build (includes server + minimal node_modules)
COPY --from=builder /app/.next/standalone ./
# Copy static assets and public files into standalone
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Create cache dir writable by nextjs user (image optimization, etc.)
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
