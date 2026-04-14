#!/usr/bin/env bash
# ============================================================
# VibeAgent Deployment Smoke Test Script
# Usage: ./scripts/smoke-test.sh <BASE_URL>
# Example: ./scripts/smoke-test.sh https://vibeagent-xyz.run.app
# ============================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}" # Remove trailing slash

PASS=0
FAIL=0
WARN=0
RESULTS=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_pass() {
  PASS=$((PASS + 1))
  RESULTS+="  ${GREEN}PASS${NC} $1\n"
}

log_fail() {
  FAIL=$((FAIL + 1))
  RESULTS+="  ${RED}FAIL${NC} $1\n"
}

log_warn() {
  WARN=$((WARN + 1))
  RESULTS+="  ${YELLOW}WARN${NC} $1\n"
}

# ---- Helper: check HTTP status code ----
check_endpoint() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local label="$4"
  local body="${5:-}"

  local url="${BASE_URL}${path}"
  local status

  if [ "$method" = "GET" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null || echo "000")
  elif [ "$method" = "POST" ]; then
    if [ -n "$body" ]; then
      status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
        -X POST -H "Content-Type: application/json" -d "$body" "$url" 2>/dev/null || echo "000")
    else
      status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
        -X POST -H "Content-Type: application/json" "$url" 2>/dev/null || echo "000")
    fi
  elif [ "$method" = "DELETE" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
      -X DELETE "$url" 2>/dev/null || echo "000")
  fi

  if [ "$status" = "$expected_status" ]; then
    log_pass "$label -> $status"
  elif [ "$status" = "502" ] || [ "$status" = "500" ] || [ "$status" = "000" ]; then
    log_fail "$label -> $status (expected $expected_status)"
  else
    log_warn "$label -> $status (expected $expected_status)"
  fi
}

echo ""
echo "============================================"
echo "  VibeAgent Smoke Test"
echo "  Target: $BASE_URL"
echo "  Time:   $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================"
echo ""

# ============================================================
# 1. Health & Infrastructure Checks
# ============================================================
echo "--- 1. Health & Infrastructure ---"

# Smoke endpoint
check_endpoint "GET" "/api/smoke" "200" "GET /api/smoke (health)"

# Auth session (should return 401 without cookie)
check_endpoint "GET" "/api/auth/session" "401" "GET /api/auth/session (no auth -> 401)"

# ============================================================
# 2. Public Endpoints (no auth required)
# ============================================================
echo "--- 2. Public Endpoints ---"

# Webhook verification (should return 403 without valid token)
check_endpoint "GET" "/api/webhooks?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=test" "403" "GET /api/webhooks (invalid token -> 403)"

# ============================================================
# 3. Protected Endpoints (expect 401 without auth)
# ============================================================
echo "--- 3. Protected Endpoints (expect 401 without auth) ---"

check_endpoint "GET"  "/api/agents" "401" "GET /api/agents"
check_endpoint "POST" "/api/agents" "401" "POST /api/agents"
check_endpoint "GET"  "/api/user/active-tenant" "401" "GET /api/user/active-tenant"
check_endpoint "GET"  "/api/tenants/current" "401" "GET /api/tenants/current"
check_endpoint "GET"  "/api/admin/tenants" "401" "GET /api/admin/tenants"
check_endpoint "GET"  "/api/admin/feature-flags" "401" "GET /api/admin/feature-flags"

# ============================================================
# 4. Cron Endpoint (expect 401 without bearer token)
# ============================================================
echo "--- 4. Cron Endpoint ---"

check_endpoint "GET" "/api/cron/process-whatsapp-queue" "401" "GET /api/cron/process-whatsapp-queue (no bearer)"

# ============================================================
# 5. Page Rendering (Next.js pages should return 200 or 307)
# ============================================================
echo "--- 5. Page Rendering ---"

# Public pages
check_endpoint "GET" "/sign-in" "200" "GET /sign-in"
check_endpoint "GET" "/sign-up" "200" "GET /sign-up"
check_endpoint "GET" "/privacy-policy" "200" "GET /privacy-policy"
check_endpoint "GET" "/terms-of-service" "200" "GET /terms-of-service"

# ============================================================
# 6. CORS Preflight Check
# ============================================================
echo "--- 6. CORS ---"

cors_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -X OPTIONS \
  -H "Origin: https://www.vibesboard.com" \
  -H "Access-Control-Request-Method: POST" \
  "${BASE_URL}/api/agents" 2>/dev/null || echo "000")

if [ "$cors_status" = "200" ] || [ "$cors_status" = "204" ]; then
  log_pass "OPTIONS /api/agents CORS preflight -> $cors_status"
else
  log_warn "OPTIONS /api/agents CORS preflight -> $cors_status"
fi

# ============================================================
# 7. Response Body Validation
# ============================================================
echo "--- 7. Response Body Checks ---"

# Check smoke endpoint returns a streaming response (not an error page)
smoke_body=$(curl -s --max-time 20 "${BASE_URL}/api/smoke" 2>/dev/null || echo "ERROR")
if echo "$smoke_body" | grep -qi "error\|502\|500\|Internal Server"; then
  log_fail "Smoke endpoint body contains error: $(echo "$smoke_body" | head -c 200)"
else
  log_pass "Smoke endpoint body looks healthy"
fi

# Check auth session returns proper JSON
auth_body=$(curl -s --max-time 10 "${BASE_URL}/api/auth/session" 2>/dev/null || echo "ERROR")
if echo "$auth_body" | python3 -c "import sys, json; json.load(sys.stdin)" 2>/dev/null; then
  log_pass "Auth session returns valid JSON"
else
  log_warn "Auth session response is not valid JSON"
fi

# ============================================================
# 8. SSL/TLS Check (production only)
# ============================================================
echo "--- 8. SSL/TLS ---"

if [[ "$BASE_URL" == https://* ]]; then
  ssl_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL" 2>/dev/null || echo "000")
  if [ "$ssl_status" != "000" ]; then
    log_pass "HTTPS connection successful -> $ssl_status"
  else
    log_fail "HTTPS connection failed"
  fi

  # Check certificate expiry
  cert_expiry=$(echo | openssl s_client -servername "$(echo "$BASE_URL" | sed 's|https://||')" \
    -connect "$(echo "$BASE_URL" | sed 's|https://||'):443" 2>/dev/null | \
    openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "UNKNOWN")
  if [ "$cert_expiry" != "UNKNOWN" ]; then
    log_pass "SSL cert expires: $cert_expiry"
  else
    log_warn "Could not determine SSL cert expiry"
  fi
else
  log_warn "Skipping SSL checks (not HTTPS)"
fi

# ============================================================
# Report
# ============================================================
echo ""
echo "============================================"
echo "  RESULTS"
echo "============================================"
echo -e "$RESULTS"
echo ""
echo "============================================"
echo -e "  ${GREEN}PASS: $PASS${NC}  ${RED}FAIL: $FAIL${NC}  ${YELLOW}WARN: $WARN${NC}"
echo "============================================"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}DEPLOYMENT SMOKE TEST FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}DEPLOYMENT SMOKE TEST PASSED${NC}"
  exit 0
fi
