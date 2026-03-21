#!/usr/bin/env bash
# VibeAgent — local development setup
# Run once after cloning, or anytime you want to verify your environment.
# Usage: ./setup.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

step=0
errors=0

info()  { echo -e "${CYAN}[$((++step))]${NC} $1"; }
ok()    { echo -e "    ${GREEN}✔${NC} $1"; }
warn()  { echo -e "    ${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "    ${RED}✖${NC} $1"; errors=$((errors + 1)); }

echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo -e "${CYAN}  VibeAgent — Local Development Setup  ${NC}"
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo ""

# ── 1. Check Node.js ──────────────────────────────────────────────────
info "Checking Node.js..."
if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "${NODE_VERSION}" | cut -d. -f1)
  if [ "${NODE_MAJOR}" -ge 20 ]; then
    ok "Node.js v${NODE_VERSION}"
  else
    fail "Node.js v${NODE_VERSION} found — v20+ required"
  fi
else
  fail "Node.js not found. Install v20+ from https://nodejs.org"
fi

# ── 2. Check pnpm ────────────────────────────────────────────────────
info "Checking pnpm..."
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm -v)"
else
  warn "pnpm not found — enabling via corepack..."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    ok "pnpm enabled via corepack"
  else
    fail "Neither pnpm nor corepack found. Run: npm i -g pnpm"
  fi
fi

# ── 3. Install dependencies ──────────────────────────────────────────
info "Installing dependencies..."
pnpm install
ok "Dependencies installed"

# ── 4. Install functions dependencies ─────────────────────────────────
info "Installing Cloud Functions dependencies..."
if [ -d "functions" ] && [ -f "functions/package.json" ]; then
  (cd functions && npm install)
  ok "Functions dependencies installed"
else
  warn "functions/ directory not found — skipping"
fi

# ── 5. Environment file ──────────────────────────────────────────────
info "Checking environment file..."
if [ -f ".env" ]; then
  ok ".env exists"

  # Check for placeholder values
  PLACEHOLDERS=0
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ -z "${key}" || "${key}" =~ ^# ]] && continue
    # Strip inline comments
    value="${value%%#*}"
    value="$(echo "${value}" | xargs)"
    if [[ "${value}" == "XXXXXXXX" || "${value}" == your-* ]]; then
      PLACEHOLDERS=$((PLACEHOLDERS + 1))
    fi
  done < .env

  if [ "${PLACEHOLDERS}" -gt 0 ]; then
    warn "${PLACEHOLDERS} placeholder value(s) still in .env — update before running"
  else
    ok "No placeholder values detected"
  fi
else
  warn ".env not found — copying from .env.example"
  cp .env.example .env
  warn "Created .env from template — fill in your values before running"
fi

# ── 6. Check optional CLI tools ───────────────────────────────────────
info "Checking optional tools..."

if command -v firebase >/dev/null 2>&1; then
  ok "Firebase CLI $(firebase --version 2>/dev/null | head -1)"
else
  warn "Firebase CLI not found (needed for emulators & deploy)"
  warn "  Install: npm i -g firebase-tools"
fi

if command -v gcloud >/dev/null 2>&1; then
  ok "Google Cloud SDK $(gcloud version 2>/dev/null | head -1 | awk '{print $NF}')"
else
  warn "gcloud CLI not found (needed for Cloud Run deploy)"
  warn "  Install: https://cloud.google.com/sdk/docs/install"
fi

# ── 7. Verify TypeScript compilation ──────────────────────────────────
info "Running type check..."
if pnpm run type-check >/dev/null 2>&1; then
  ok "TypeScript compiles cleanly"
else
  warn "TypeScript has errors — run 'pnpm run type-check' for details"
fi

# ── 8. Verify build ──────────────────────────────────────────────────
info "Verifying Next.js build..."
if pnpm run build >/dev/null 2>&1; then
  ok "Next.js builds successfully"
else
  fail "Next.js build failed — run 'pnpm run build' for details"
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}───────────────────────────────────────${NC}"
if [ "${errors}" -eq 0 ]; then
  echo -e "${GREEN}  Setup complete — no errors!${NC}"
else
  echo -e "${RED}  Setup finished with ${errors} error(s)${NC}"
fi
echo -e "${CYAN}───────────────────────────────────────${NC}"
echo ""
echo "  Start dev server:       pnpm dev"
echo "  Start with emulators:   firebase emulators:start"
echo "  Run tests:              pnpm test"
echo "  Lint:                   pnpm lint"
echo ""
