#!/usr/bin/env bash
# Create/update environment-scoped Google Secret Manager values from an env
# file. Idempotent: a new version is added only when a value is provided.
#
# Usage:
#   ./scripts/setup-secrets.sh staging .env.staging
#   ./scripts/setup-secrets.sh production .env.production

set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <staging|production> [env-file]" >&2
  exit 1
fi

DEPLOY_ENV="$1"
case "${DEPLOY_ENV}" in
  staging) SECRET_SUFFIX="staging" ;;
  production) SECRET_SUFFIX="prod" ;;
  *)
    echo "Error: environment must be 'staging' or 'production'." >&2
    exit 1
    ;;
esac

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: gcloud not found. Install the Google Cloud SDK." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${2:-${SCRIPT_DIR}/../.env.${DEPLOY_ENV}}"
if [ ! -f "${ENV_FILE}" ]; then
  echo "Error: env file not found at ${ENV_FILE}." >&2
  exit 1
fi

read_env() {
  local key="$1"
  local value
  value=$(grep -E "^${key}=" "${ENV_FILE}" | head -n1 | sed "s/^${key}=//" || true)
  if [[ "${value}" == \"*\" ]] || [[ "${value}" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value}"
}

PROJECT_ID="${GCP_PROJECT_ID:-$(read_env GCP_PROJECT_ID)}"
if [ -z "${PROJECT_ID}" ]; then
  echo "Error: GCP_PROJECT_ID is not set." >&2
  exit 1
fi

upsert_secret() {
  local base_name="$1"
  local env_var="$2"
  local secret_name="${base_name}-${SECRET_SUFFIX}"
  local value
  value=$(read_env "${env_var}")

  if [ -z "${value}" ]; then
    echo "SKIP ${secret_name} (${env_var} is unset)"
    return
  fi

  if ! gcloud secrets describe "${secret_name}" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "CREATE ${secret_name}"
    gcloud secrets create "${secret_name}" \
      --project="${PROJECT_ID}" \
      --replication-policy=automatic \
      --quiet
  fi

  echo "UPDATE ${secret_name}"
  printf '%s' "${value}" | gcloud secrets versions add "${secret_name}" \
    --project="${PROJECT_ID}" \
    --data-file=- \
    --quiet
}

echo "Provisioning ${DEPLOY_ENV} secrets in ${PROJECT_ID}..."

upsert_secret "openai-api-key" "OPENAI_API_KEY"
upsert_secret "encryption-key" "ENCRYPTION_KEY"
upsert_secret "rate-limit-salt" "RATE_LIMIT_SALT"
upsert_secret "cron-secret" "CRON_SECRET"
upsert_secret "access-gate-secret" "ACCESS_GATE_SECRET"
upsert_secret "better-auth-secret" "BETTER_AUTH_SECRET"

upsert_secret "database-url" "DATABASE_URL"
upsert_secret "database-migrate-url" "DATABASE_MIGRATE_URL"
upsert_secret "s3-access-key-id" "S3_ACCESS_KEY_ID"
upsert_secret "s3-secret-access-key" "S3_SECRET_ACCESS_KEY"

upsert_secret "whatsapp-inbox-verify-token" "WHATSAPP_INBOX_VERIFY_TOKEN"
upsert_secret "instagram-inbox-verify-token" "INSTAGRAM_INBOX_VERIFY_TOKEN"
upsert_secret "meta-app-secret" "META_APP_SECRET"
upsert_secret "resend-api-key" "RESEND_API_KEY"

upsert_secret "google-calendar-client-id" "GOOGLE_CALENDAR_CLIENT_ID"
upsert_secret "google-calendar-client-secret" "GOOGLE_CALENDAR_CLIENT_SECRET"
upsert_secret "google-oauth-client-id" "GOOGLE_OAUTH_CLIENT_ID"
upsert_secret "auth-google-id" "AUTH_GOOGLE_ID"
upsert_secret "auth-google-secret" "AUTH_GOOGLE_SECRET"

echo "Done. Verify with: gcloud secrets list --project=${PROJECT_ID}"
