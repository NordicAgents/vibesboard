#!/usr/bin/env bash
#
# Apply (or repair) the CORS policy on an object-storage bucket.
#
# Knowledge Base uploads go straight from the browser to the bucket using a
# presigned URL, so the *bucket* has to answer the CORS preflight. The app
# cannot supply those headers on its own responses. A bucket with no CORS
# policy makes every upload fail with an opaque "Failed to fetch".
#
# This is not applied automatically by the deploy workflow: the deploy service
# account holds only roles/storage.objectAdmin, which grants object access but
# not storage.buckets.update. Run this as an operator with bucket-admin rights
# whenever a bucket is created, renamed, or migrated. The deploy workflow
# verifies the result and fails loudly if the policy is missing.
#
# Usage:
#   BUCKET=my-bucket ORIGINS="https://app.example,https://www.app.example" \
#     scripts/apply-bucket-cors.sh
#
# Nothing is hardcoded: this repository is public, so environment-specific
# origins belong in the invocation, not in source.

set -euo pipefail

BUCKET="${BUCKET:-${1:-}}"
ORIGINS="${ORIGINS:-${2:-}}"

if [[ -z "$BUCKET" || -z "$ORIGINS" ]]; then
  echo "Usage: BUCKET=<bucket-name> ORIGINS=<comma-separated-origins> $0" >&2
  echo "Example: BUCKET=example-files ORIGINS=\"https://example.com,https://www.example.com\" $0" >&2
  exit 2
fi

# Comma-separated origins -> JSON array.
origins_json="$(
  printf '%s' "$ORIGINS" | awk -v RS=',' 'NF {gsub(/^[ \t]+|[ \t]+$/, ""); printf "%s\"%s\"", (n++ ? "," : ""), $0}'
)"

cors_file="$(mktemp -t bucket-cors.XXXXXX.json)"
trap 'rm -f "$cors_file"' EXIT

# Scoped to what the browser actually does:
#   - PUT only for writes; deletes are server-side through the API.
#   - No Authorization header: presigned V4 URLs sign via the query string.
#   - GET/HEAD retained for direct reads of stored objects.
cat > "$cors_file" <<JSON
[
  {
    "origin": [${origins_json}],
    "method": ["GET", "HEAD", "PUT"],
    "responseHeader": ["Content-Type", "ETag"],
    "maxAgeSeconds": 3600
  }
]
JSON

echo "Applying CORS policy to gs://${BUCKET}"
echo "  origins: ${ORIGINS}"
gcloud storage buckets update "gs://${BUCKET}" --cors-file="$cors_file"

# Verify against the public endpoint rather than re-reading the config, so the
# check reflects what a browser would actually receive.
first_origin="$(printf '%s' "$ORIGINS" | cut -d',' -f1 | tr -d ' ')"
echo "Verifying preflight from ${first_origin}"

if curl -sS -o /dev/null -D - -X OPTIONS \
     "https://${BUCKET}.storage.googleapis.com/cors-preflight-probe" \
     -H "Origin: ${first_origin}" \
     -H "Access-Control-Request-Method: PUT" \
     -H "Access-Control-Request-Headers: content-type" \
   | grep -qi '^access-control-allow-origin:'; then
  echo "OK: bucket answers the upload preflight."
else
  echo "FAILED: no access-control-allow-origin header returned; uploads will still break." >&2
  exit 1
fi
