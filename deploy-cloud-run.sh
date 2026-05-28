#!/usr/bin/env bash

set -euo pipefail

# --- Config ---
PROJECT_ID="vibesboard"
REGION="europe-north1"
SERVICE_NAME="vibeagent"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "Deploying ${SERVICE_NAME} to Cloud Run in ${PROJECT_ID}/${REGION}..."

# --- Preflight ---
if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found. Install Google Cloud SDK." >&2
  exit 1
fi

# Choose container engine (podman preferred, else docker)
ENGINE=""
if command -v podman >/dev/null 2>&1; then
  ENGINE="podman"
elif command -v docker >/dev/null 2>&1; then
  ENGINE="docker"
else
  echo "Neither podman nor docker found in PATH." >&2
  exit 1
fi
echo "Using container engine: ${ENGINE}"

# Auth and project
gcloud auth print-identity-token >/dev/null 2>&1 || {
  echo "Run 'gcloud auth login' and 'gcloud auth application-default login' first." >&2
  exit 1
}
gcloud config set project "${PROJECT_ID}" --quiet >/dev/null

# Validate project exists and you have access
if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Project '${PROJECT_ID}' not found or access denied." >&2
  exit 1
fi

if [ "${ENGINE}" = "docker" ]; then
  gcloud auth configure-docker gcr.io -q
else
  echo "Logging into gcr.io with podman..."
  podman login gcr.io -u oauth2accesstoken -p "$(gcloud auth print-access-token)"
fi

# --- Build args helper ---
BUILD_ARGS=""
add_build_arg() {
  local key="$1"; shift
  local val="${1:-}"
  if [ -n "${val}" ]; then
    BUILD_ARGS+=" --build-arg ${key}=${val}"
  fi
}

# Prefer exported env, fallback to .env file
get_env_value() {
  local key="$1"
  if [ -n "${!key-}" ]; then
    printf '%s' "${!key}"
    return 0
  fi
  if [ -f .env ]; then
    local line
    line=$(grep -E "^${key}=" .env | tail -n1 || true)
    if [ -n "${line}" ]; then
      printf '%s' "${line#${key}=}"
      return 0
    fi
  fi
  return 1
}

# --- Build-time NEXT_PUBLIC_* args ---
for key in \
  NEXT_PUBLIC_AUTH_GOOGLE \
  NEXT_PUBLIC_APP_URL \
  NEXT_PUBLIC_META_APP_ID \
  NEXT_PUBLIC_FB_LOGIN_CONFIG_ID \
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY; do
  val=$(get_env_value "$key" || true)
  add_build_arg "$key" "$val"
done

echo "Using build-time public env: ${BUILD_ARGS:-<none>}"

# --- Build and push image (linux/amd64) ---
${ENGINE} build --platform linux/amd64 -t "${IMAGE_NAME}" ${BUILD_ARGS} .
${ENGINE} push "${IMAGE_NAME}"

# --- Non-sensitive runtime env vars ---
OPENAI_MODEL=$(get_env_value OPENAI_MODEL || echo "gpt-4o-mini")
GCS_BUCKET_NAME=$(get_env_value GCS_BUCKET_NAME || echo "vibeagent-files")
WHATSAPP_PHONE_NUMBER_ID=$(get_env_value WHATSAPP_PHONE_NUMBER_ID || true)
NEXT_PUBLIC_APP_URL_VAL=$(get_env_value NEXT_PUBLIC_APP_URL || echo "https://www.vibesboard.com")

NOTIFICATION_EMAIL_FROM_VAL=$(get_env_value NOTIFICATION_EMAIL_FROM || echo "VibeAgent <notifications@vibeagent.com>")

ENV_VARS="OPENAI_MODEL=${OPENAI_MODEL}"
ENV_VARS+=",GCS_BUCKET_NAME=${GCS_BUCKET_NAME}"
ENV_VARS+=",NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL_VAL}"
ENV_VARS+=",NOTIFICATION_EMAIL_FROM=${NOTIFICATION_EMAIL_FROM_VAL}"
if [ -n "${WHATSAPP_PHONE_NUMBER_ID}" ]; then
  ENV_VARS+=",WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID}"
fi

# --- Deploy to Cloud Run ---
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_NAME}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=3 \
  --timeout=600s \
  --set-env-vars="${ENV_VARS}" \
  --set-secrets="\
OPENAI_API_KEY=openai-api-key:latest,\
WHATSAPP_ACCESS_TOKEN=whatsapp-access-token:latest,\
VERIFY_TOKEN=whatsapp-verify-token:latest,\
ENCRYPTION_KEY=encryption-key:latest,\
CRON_SECRET=cron-secret:latest,\
META_APP_SECRET=meta-app-secret:latest,\
WHATSAPP_INBOX_VERIFY_TOKEN=whatsapp-inbox-verify-token:latest,\
INSTAGRAM_INBOX_VERIFY_TOKEN=instagram-inbox-verify-token:latest,\
RESEND_API_KEY=resend-api-key:latest,\
STRIPE_SECRET_KEY=stripe-secret-key:latest,\
STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest,\
STRIPE_PRICE_PRO_BASE=stripe-price-pro-base:latest,\
STRIPE_PRICE_PRO_OVERAGE=stripe-price-pro-overage:latest,\
STRIPE_PRICE_TEAM_BASE=stripe-price-team-base:latest,\
STRIPE_PRICE_TEAM_OVERAGE=stripe-price-team-overage:latest,\
GOOGLE_CALENDAR_CLIENT_ID=google-calendar-client-id:latest,\
GOOGLE_CALENDAR_CLIENT_SECRET=google-calendar-client-secret:latest,\
GOOGLE_OAUTH_CLIENT_ID=google-oauth-client-id:latest"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)")
echo ""
echo "Service deployed: ${SERVICE_URL}"
echo ""

# --- Cloud Scheduler for WhatsApp queue processing ---
# Cloud Scheduler is not available in all regions; use the nearest supported one.
SCHEDULER_REGION="europe-west1"
JOB_NAME="vibeagent-process-whatsapp-queue"
echo "Setting up Cloud Scheduler cron job: ${JOB_NAME} (location: ${SCHEDULER_REGION})..."

CRON_TOKEN=$(gcloud secrets versions access latest --secret=cron-secret --project="${PROJECT_ID}")

if gcloud scheduler jobs describe "${JOB_NAME}" --location="${SCHEDULER_REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "  Updating existing scheduler job..."
  gcloud scheduler jobs update http "${JOB_NAME}" \
    --location="${SCHEDULER_REGION}" \
    --project="${PROJECT_ID}" \
    --schedule="*/30 * * * *" \
    --uri="${SERVICE_URL}/api/cron/process-whatsapp-queue" \
    --http-method=GET \
    --update-headers="Authorization=Bearer ${CRON_TOKEN}" \
    --attempt-deadline=120s \
    --quiet
else
  echo "  Creating new scheduler job..."
  gcloud scheduler jobs create http "${JOB_NAME}" \
    --location="${SCHEDULER_REGION}" \
    --project="${PROJECT_ID}" \
    --schedule="*/30 * * * *" \
    --uri="${SERVICE_URL}/api/cron/process-whatsapp-queue" \
    --http-method=GET \
    --headers="Authorization=Bearer ${CRON_TOKEN}" \
    --attempt-deadline=120s \
    --quiet
fi

echo "Cloud Scheduler job configured: every 30 minutes"

# --- Cloud Scheduler for billing cycle reset (free plan) ---
BILLING_JOB_NAME="vibeagent-billing-reset"
echo ""
echo "Setting up Cloud Scheduler cron job: ${BILLING_JOB_NAME} (location: ${SCHEDULER_REGION})..."

if gcloud scheduler jobs describe "${BILLING_JOB_NAME}" --location="${SCHEDULER_REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "  Updating existing scheduler job..."
  gcloud scheduler jobs update http "${BILLING_JOB_NAME}" \
    --location="${SCHEDULER_REGION}" \
    --project="${PROJECT_ID}" \
    --schedule="0 2 * * *" \
    --time-zone="UTC" \
    --uri="${SERVICE_URL}/api/cron/billing-reset" \
    --http-method=POST \
    --update-headers="x-cron-secret=${CRON_TOKEN}" \
    --attempt-deadline=120s \
    --quiet
else
  echo "  Creating new scheduler job..."
  gcloud scheduler jobs create http "${BILLING_JOB_NAME}" \
    --location="${SCHEDULER_REGION}" \
    --project="${PROJECT_ID}" \
    --schedule="0 2 * * *" \
    --time-zone="UTC" \
    --uri="${SERVICE_URL}/api/cron/billing-reset" \
    --http-method=POST \
    --headers="x-cron-secret=${CRON_TOKEN}" \
    --attempt-deadline=120s \
    --quiet
fi

echo "Cloud Scheduler billing reset configured: daily at 2:00 AM UTC"
echo ""
echo "Secrets are injected from Google Secret Manager (not env.yaml)."
echo "Non-sensitive config is set via --set-env-vars."
