#!/usr/bin/env bash

set -euo pipefail

# --- Config ---
# Override via exported env vars; edit defaults as needed
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
  echo "Project '${PROJECT_ID}' not found or access denied. Set PROJECT_ID env or ensure permissions." >&2
  exit 1
fi

if [ "${ENGINE}" = "docker" ]; then
  gcloud auth configure-docker gcr.io -q
else
  echo "Logging into gcr.io with podman..."
  podman login gcr.io -u oauth2accesstoken -p "$(gcloud auth print-access-token)"
fi

# Prepare build-time NEXT_PUBLIC_* args for Next.js client embed
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

# Only include NEXT_PUBLIC_* actually used by the app
for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_AUTH_GITHUB NEXT_PUBLIC_AUTH_GOOGLE NEXT_PUBLIC_APP_URL; do
  val=$(get_env_value "$key" || true)
  add_build_arg "$key" "$val"
done

echo "Using build-time public env: ${BUILD_ARGS:-<none>}"

# Sanity check for required NEXT_PUBLIC_* if no .env.production provided
if [ ! -f .env.production ]; then
  req1=$(get_env_value NEXT_PUBLIC_SUPABASE_URL || true)
  req2=$(get_env_value NEXT_PUBLIC_SUPABASE_ANON_KEY || true)
  if [ -z "${req1}" ] || [ -z "${req2}" ]; then
    echo "Error: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY." >&2
    echo "Provide them via exported env or .env, or create .env.production before building." >&2
    exit 1
  fi
fi

# Build and push image (linux/amd64)
${ENGINE} build --platform linux/amd64 -t "${IMAGE_NAME}" ${BUILD_ARGS} .
${ENGINE} push "${IMAGE_NAME}"

# Prepare runtime env vars
# Prefer env.yaml file (safer for commas and special chars),
# otherwise fall back to concatenating .env for --set-env-vars
ENV_ARGS=""
if [ -f env.yaml ]; then
  echo "Using runtime env file: env.yaml"
  ENV_ARGS="--env-vars-file=env.yaml"
else
  ENV_VARS=""
  if [ -f .env ]; then
    # Properly format env vars: KEY=VALUE pairs separated by commas
    # This handles values with special characters by not splitting on commas within values
    ENV_VARS=$(grep -v '^#' .env | grep -v '^$' | tr '\n' ',' | sed 's/,$//')
  fi
  if [ -n "${ENV_VARS}" ]; then
    echo "Using runtime env vars from .env"
    ENV_ARGS="--set-env-vars=${ENV_VARS}"
  else
    echo "No runtime env configured (env.yaml or .env)"
  fi
fi

# Deploy to Cloud Run
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_NAME}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=600s \
  ${ENV_ARGS}

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)")
echo "Service deployed: ${SERVICE_URL}"

cat <<'EONOTE'
Note:
- Server runtime environment variables are set above via Cloud Run. Client-side
  variables must be prefixed with NEXT_PUBLIC_ and included at build time.
  This script forwards NEXT_PUBLIC_* values from your shell or .env file
  to the Docker build as --build-arg so Next.js can embed them.

- This app sets several routes/pages to runtime = 'edge'. Next.js can run
  these under next start, but behavior may differ from Vercel Edge. Test
  your API routes after deploy.
EONOTE