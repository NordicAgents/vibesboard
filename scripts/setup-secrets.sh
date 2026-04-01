#!/usr/bin/env bash
# Create/update secrets in Google Secret Manager from .env file
# Idempotent — safe to re-run. Creates new versions if values change.
#
# Usage:
#   ./scripts/setup-secrets.sh          # reads from .env
#   ./scripts/setup-secrets.sh .env.prod # reads from specific file

set -euo pipefail

PROJECT_ID="vibesboard"

echo "=== Secret Manager Setup ==="
echo "Project: ${PROJECT_ID}"
echo ""

# --- Preflight ---
if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: gcloud not found. Install Google Cloud SDK." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/../.env}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Error: env file not found at ${ENV_FILE}" >&2
  echo "Create a .env file with the required values first." >&2
  exit 1
fi

echo "Reading from: ${ENV_FILE}"
echo ""

gcloud config set project "${PROJECT_ID}" --quiet

# Read a value from .env by key
read_env() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" "${ENV_FILE}" | head -n1 | sed "s/^${key}=//")
  printf '%s' "${val}"
}

# Create or update a secret
upsert_secret() {
  local secret_name="$1"
  local env_var="$2"
  local value
  value=$(read_env "${env_var}")

  if [ -z "${value}" ]; then
    echo "  SKIP ${secret_name} — ${env_var} not found in env file"
    return
  fi

  # Create secret if it doesn't exist
  if ! gcloud secrets describe "${secret_name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "  CREATE ${secret_name}"
    gcloud secrets create "${secret_name}" \
      --project="${PROJECT_ID}" \
      --replication-policy="automatic" \
      --quiet
  fi

  # Add a new version with the current value
  echo "  UPDATE ${secret_name} (new version)"
  printf '%s' "${value}" | gcloud secrets versions add "${secret_name}" \
    --project="${PROJECT_ID}" \
    --data-file=- \
    --quiet
}

# --- Secrets to manage ---
# Format: upsert_secret <secret-manager-name> <env-var-name>

echo "Creating/updating secrets..."
echo ""

# Core
echo "--- Core ---"
upsert_secret "openai-api-key"                "OPENAI_API_KEY"
upsert_secret "firebase-service-account-key"  "FIREBASE_SERVICE_ACCOUNT_KEY"
upsert_secret "encryption-key"                "ENCRYPTION_KEY"
upsert_secret "cron-secret"                   "CRON_SECRET"
echo ""

# WhatsApp / Meta
echo "--- WhatsApp & Meta ---"
upsert_secret "whatsapp-access-token"         "WHATSAPP_ACCESS_TOKEN"
upsert_secret "whatsapp-verify-token"         "VERIFY_TOKEN"
upsert_secret "whatsapp-inbox-verify-token"   "WHATSAPP_INBOX_VERIFY_TOKEN"
upsert_secret "meta-app-secret"               "META_APP_SECRET"
upsert_secret "instagram-inbox-verify-token" "INSTAGRAM_INBOX_VERIFY_TOKEN"
echo ""

# Email
echo "--- Email ---"
upsert_secret "resend-api-key"                "RESEND_API_KEY"
echo ""

# Stripe
echo "--- Stripe ---"
upsert_secret "stripe-secret-key"             "STRIPE_SECRET_KEY"
upsert_secret "stripe-webhook-secret"         "STRIPE_WEBHOOK_SECRET"
upsert_secret "stripe-price-pro-base"         "STRIPE_PRICE_PRO_BASE"
upsert_secret "stripe-price-pro-overage"      "STRIPE_PRICE_PRO_OVERAGE"
upsert_secret "stripe-price-team-base"        "STRIPE_PRICE_TEAM_BASE"
upsert_secret "stripe-price-team-overage"     "STRIPE_PRICE_TEAM_OVERAGE"
echo ""

# Google OAuth (Calendar & Sheets)
echo "--- Google OAuth ---"
upsert_secret "google-calendar-client-id"     "GOOGLE_CALENDAR_CLIENT_ID"
upsert_secret "google-calendar-client-secret" "GOOGLE_CALENDAR_CLIENT_SECRET"
echo ""

# Google Cross-Account Protection (RISC)
echo "--- Google RISC ---"
upsert_secret "google-oauth-client-id"        "GOOGLE_OAUTH_CLIENT_ID"
echo ""

echo "=== Secrets Setup Complete ==="
echo ""
echo "Verify with: gcloud secrets list --project=${PROJECT_ID}"
echo ""
echo "Note: NEXT_PUBLIC_* vars are NOT secrets."
echo "      They are embedded at build time via Dockerfile build args."
echo ""
