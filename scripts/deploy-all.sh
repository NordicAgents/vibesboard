#!/usr/bin/env bash
# Full deployment: Cloud Functions + Firestore rules/indexes + Cloud Run app

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}/.."

echo "=== VibeAgent Full Deployment ==="
echo ""

# --- 1. Deploy Cloud Functions ---
echo "--- Step 1/3: Cloud Functions ---"
bash "${SCRIPT_DIR}/deploy-functions.sh"
echo ""

# --- 2. Deploy Firestore rules + indexes ---
echo "--- Step 2/3: Firestore Rules & Indexes ---"
bash "${SCRIPT_DIR}/deploy-rules.sh"
echo ""

# --- 3. Deploy Cloud Run app ---
echo "--- Step 3/3: Cloud Run App ---"
bash "${PROJECT_DIR}/deploy-cloud-run.sh"
echo ""

# --- Summary ---
echo "=== Deployment Complete ==="
echo ""
echo "Services:"
SERVICE_URL=$(gcloud run services describe vibeagent --region=europe-north1 --format="value(status.url)" 2>/dev/null || echo "<not available>")
echo "  Cloud Run:  ${SERVICE_URL}"
echo "  Functions:  https://console.firebase.google.com/project/vibesboard/functions"
echo "  Firestore:  https://console.firebase.google.com/project/vibesboard/firestore"
echo ""
