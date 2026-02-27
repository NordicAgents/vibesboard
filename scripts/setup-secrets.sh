#!/usr/bin/env bash
# Create/update secrets in Google Secret Manager from .env file
# Idempotent — safe to re-run. Creates new versions if values change.

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
ENV_FILE="${SCRIPT_DIR}/../.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Error: .env file not found at ${ENV_FILE}" >&2
  echo "Create a .env file with the required values first." >&2
  exit 1
fi

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
    echo "  SKIP ${secret_name} — ${env_var} not found in .env"
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

upsert_secret "openai-api-key"                "OPENAI_API_KEY"
upsert_secret "firebase-service-account-key"  "FIREBASE_SERVICE_ACCOUNT_KEY"
upsert_secret "whatsapp-access-token"         "WHATSAPP_ACCESS_TOKEN"
upsert_secret "whatsapp-verify-token"         "VERIFY_TOKEN"
upsert_secret "encryption-key"                "ENCRYPTION_KEY"
upsert_secret "cron-secret"                   "CRON_SECRET"

echo ""
echo "=== Secrets Setup Complete ==="
echo ""
echo "Verify with: gcloud secrets list --project=${PROJECT_ID}"
echo ""
