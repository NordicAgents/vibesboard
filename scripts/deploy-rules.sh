#!/usr/bin/env bash
# Deploy Firestore rules and indexes only

set -euo pipefail

echo "Deploying Firestore rules and indexes..."

firebase deploy --only firestore:rules,firestore:indexes --project=vibesboard

echo "Firestore rules and indexes deployed."
