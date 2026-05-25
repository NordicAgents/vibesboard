#!/usr/bin/env bash
# Deploy Firebase Storage rules only (Firestore removed in Phase 7d)

set -euo pipefail

echo "Deploying Firebase Storage rules..."

firebase deploy --only storage --project=vibesboard

echo "Firebase Storage rules deployed."
