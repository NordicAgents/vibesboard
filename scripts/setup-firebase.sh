#!/usr/bin/env bash
# One-time Firebase infrastructure setup for VibeAgent
# Idempotent — safe to re-run.

set -euo pipefail

PROJECT_ID="vibesboard"
REGION="europe-north1"
BUCKET_NAME="vibeagent-files"
SERVICE_ACCOUNT_NAME="vibeagent-app"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=== VibeAgent Firebase Setup ==="
echo "Project: ${PROJECT_ID} | Region: ${REGION}"
echo ""

# --- Preflight ---
for cmd in gcloud firebase; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: ${cmd} not found. Install Google Cloud SDK and Firebase CLI." >&2
    exit 1
  fi
done

gcloud config set project "${PROJECT_ID}" --quiet

# --- 1. Enable required APIs ---
echo "Enabling required APIs..."
APIS=(
  firestore.googleapis.com
  cloudfunctions.googleapis.com
  cloudscheduler.googleapis.com
  cloudbuild.googleapis.com
  run.googleapis.com
  artifactregistry.googleapis.com
  identitytoolkit.googleapis.com
  storage.googleapis.com
  secretmanager.googleapis.com
)
gcloud services enable "${APIS[@]}" --quiet
echo "APIs enabled."

# --- 2. Create Firestore database (native mode) if not exists ---
echo "Checking Firestore database..."
if gcloud firestore databases describe --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Firestore database already exists."
else
  echo "Creating Firestore database (native mode) in ${REGION}..."
  gcloud firestore databases create \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --type=firestore-native
  echo "Firestore database created."
fi

# --- 3. Create GCS bucket if not exists ---
echo "Checking GCS bucket gs://${BUCKET_NAME}..."
if gcloud storage buckets describe "gs://${BUCKET_NAME}" >/dev/null 2>&1; then
  echo "Bucket already exists."
else
  echo "Creating bucket gs://${BUCKET_NAME} in ${REGION}..."
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  echo "Bucket created."
fi

# Apply CORS config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORS_FILE="${SCRIPT_DIR}/../cors.json"
if [ -f "${CORS_FILE}" ]; then
  echo "Applying CORS config to gs://${BUCKET_NAME}..."
  gcloud storage buckets update "gs://${BUCKET_NAME}" --cors-file="${CORS_FILE}"
  echo "CORS applied."
else
  echo "Warning: cors.json not found at ${CORS_FILE}, skipping CORS config."
fi

# --- 4. Create/update service account ---
echo "Setting up service account ${SERVICE_ACCOUNT_EMAIL}..."
if gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" >/dev/null 2>&1; then
  echo "Service account already exists."
else
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" \
    --display-name="VibeAgent App Service Account" \
    --project="${PROJECT_ID}"
  echo "Service account created."
fi

# Grant roles to the custom service account
ROLES=(
  roles/datastore.user
  roles/storage.objectAdmin
  roles/secretmanager.secretAccessor
)
for role in "${ROLES[@]}"; do
  echo "  Granting ${role}..."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="${role}" \
    --quiet >/dev/null
done
echo "Service account roles configured."

# --- 5. Grant Cloud Run default SA the secretAccessor role ---
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "Granting secretmanager.secretAccessor to Cloud Run SA (${CLOUD_RUN_SA})..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CLOUD_RUN_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null
echo "Cloud Run SA configured."

# --- 6. Deploy Firebase Storage rules (Firestore removed in Phase 7d) ---
echo "Deploying Firebase Storage rules..."
firebase deploy --only storage --project="${PROJECT_ID}"
echo "Firebase Storage rules deployed."

# --- Done ---
echo ""
echo "=== Setup Complete ==="
echo ""
echo "MANUAL STEPS REQUIRED:"
echo "  1. Enable Firebase Auth providers in the Firebase Console:"
echo "     https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers"
echo "     - Enable Google sign-in"
echo "  2. Run scripts/setup-secrets.sh to create Secret Manager secrets"
echo ""
