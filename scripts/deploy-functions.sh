#!/usr/bin/env bash
# Deploy Cloud Functions only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_DIR="${SCRIPT_DIR}/../functions"

echo "Deploying Cloud Functions..."

cd "${FUNCTIONS_DIR}"
npm install
npm run build

firebase deploy --only functions --project=vibesboard

echo "Cloud Functions deployed."
