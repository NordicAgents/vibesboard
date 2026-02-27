# VibeAgent Deployment Guide

Production deployment on Google Cloud Platform using Firebase + Cloud Run.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [GCP Resources](#gcp-resources)
3. [Cost Model](#cost-model)
4. [Prerequisites](#prerequisites)
5. [Deploy From Scratch](#deploy-from-scratch)
6. [Deploying Code Changes](#deploying-code-changes)
7. [Environment Variables](#environment-variables)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
                    +-----------------------+
                    |   Firebase Auth       |
                    |   (Google sign-in)    |
                    +-----------+-----------+
                                |
                                v
+------------------+   +-------+--------+   +-------------------+
|  Cloud Scheduler |-->|   Cloud Run    |-->|   Firestore       |
|  (cron jobs)     |   |   (Next.js)    |   |   (native mode)   |
+------------------+   +---+------+-----+   +-------------------+
                            |      |
                    +-------+      +--------+
                    v                       v
          +---------+------+     +---------+---------+
          | Cloud Storage  |     | Secret Manager    |
          | (file uploads) |     | (API keys, creds) |
          +----------------+     +-------------------+

          +---------------------------------------------+
          |           Cloud Functions (4)                |
          |  onUserCreated | onFileCreated              |
          |  processWhatsAppQueue | onMessageStatusUpdate|
          +---------------------------------------------+
```

**Region:** `europe-north1` (Finland) for all primary resources.

---

## GCP Resources

### Cloud Run Service

| Property        | Value                                    |
|-----------------|------------------------------------------|
| Service name    | `vibeagent`                              |
| Region          | `europe-north1`                          |
| Image           | `gcr.io/vibesboard/vibeagent:latest`     |
| CPU             | 1 vCPU                                   |
| Memory          | 1 GB                                     |
| Min instances   | 0 (scales to zero)                       |
| Max instances   | 3                                        |
| Request timeout | 600s                                     |
| Port            | 8080                                     |
| Auth            | Public (unauthenticated)                 |

### Firestore Database

| Property     | Value            |
|--------------|------------------|
| Mode         | Native           |
| Location     | `europe-north1`  |
| Database     | `(default)`      |

**Composite indexes:**

| Collection           | Scope            | Fields                                |
|----------------------|------------------|---------------------------------------|
| `conversations`      | COLLECTION       | `agentId` ASC, `createdAt` DESC       |
| `message_queue`      | COLLECTION       | `status` ASC, `createdAt` ASC         |
| `files`              | COLLECTION       | `status` ASC, `createdAt` ASC         |
| `file_chunks`        | COLLECTION       | `embedding` (vector, 1536d, flat)     |
| `conversation_chunks`| COLLECTION       | `embedding` (vector, 1536d, flat)     |
| `members`            | COLLECTION_GROUP | `role` ASC, `userId` ASC              |

### Cloud Storage

| Property      | Value              |
|---------------|--------------------|
| Bucket name   | `vibeagent-files`  |
| Location      | `europe-north1`    |
| Access        | Uniform bucket-level |
| CORS origins  | `vibesboard.com`, `localhost:3000` |
| Max file size | 50 MB (enforced by storage rules)  |

### Cloud Functions

| Function                  | Trigger                          | Region          | Runtime  |
|---------------------------|----------------------------------|-----------------|----------|
| `onUserCreated`           | Firebase Auth user creation      | `us-central1`*  | Node 20  |
| `onFileCreated`           | Firestore document create        | `europe-north1` | Node 20  |
| `processWhatsAppQueue`    | Cloud Scheduler (every 1 min)    | `europe-north1` | Node 20  |
| `onMessageStatusUpdate`   | Firestore document update        | `europe-north1` | Node 20  |

*`onUserCreated` uses gen1 Auth triggers which don't support `europe-north1`.

### Cloud Scheduler

| Property    | Value                           |
|-------------|---------------------------------|
| Job name    | `process-whatsapp-queue`        |
| Region      | `europe-west1`*                 |
| Schedule    | `* * * * *` (every minute)      |
| Timezone    | UTC                             |

*Cloud Scheduler doesn't support `europe-north1`. Uses closest European region.

### Secret Manager (5 secrets)

| Secret Name                    | Maps to Env Var               |
|--------------------------------|-------------------------------|
| `openai-api-key`               | `OPENAI_API_KEY`              |
| `firebase-service-account-key` | `FIREBASE_SERVICE_ACCOUNT_KEY`|
| `whatsapp-access-token`        | `WHATSAPP_ACCESS_TOKEN`       |
| `whatsapp-verify-token`        | `VERIFY_TOKEN`                |
| `encryption-key`               | `ENCRYPTION_KEY`              |

### IAM Service Account

| Account                                              | Roles                                                                |
|------------------------------------------------------|----------------------------------------------------------------------|
| `vibeagent-app@vibesboard.iam.gserviceaccount.com`   | `datastore.user`, `storage.objectAdmin`, `secretmanager.secretAccessor` |
| `{PROJECT_NUMBER}-compute@developer.gserviceaccount.com` | `secretmanager.secretAccessor`                                   |

### Firebase Authentication

| Property   | Value                     |
|------------|---------------------------|
| Providers  | Google sign-in            |
| Free tier  | 50,000 MAUs/month         |

---

## Cost Model

### Free Tier Coverage (per month)

| Service            | Free Tier                          | Region Restriction          |
|--------------------|------------------------------------|-----------------------------|
| Firestore reads    | 50,000/day (~1.5M/month)          | All regions                 |
| Firestore writes   | 20,000/day (~600K/month)          | All regions                 |
| Firestore storage  | 1 GiB                             | All regions                 |
| Cloud Functions    | 2M invocations, 400K GB-sec       | All regions                 |
| Secret Manager     | 6 versions, 10K accesses          | All regions                 |
| Cloud Scheduler    | 3 jobs                            | All regions                 |
| Firebase Auth      | 50,000 MAUs                       | All regions                 |
| Cloud Build        | 2,500 build-minutes               | All regions                 |
| Artifact Registry  | 0.5 GB storage                    | All regions                 |
| **Cloud Run**      | **180K vCPU-sec, 2M requests**    | **US regions only**         |
| **Cloud Storage**  | **5 GB**                          | **US regions only**         |

**Important:** Cloud Run and Cloud Storage free tiers only apply to US regions. Since we deploy to `europe-north1`, these are billed from the first unit.

### Estimated Monthly Cost (Low Traffic)

Assuming ~1,000 monthly active users, ~50K page views, light API usage:

| Service             | Estimated Usage              | Estimated Cost  |
|---------------------|------------------------------|-----------------|
| Cloud Run           | ~500K requests, ~100K vCPU-sec | $2-5           |
| Firestore           | Within free tier             | $0              |
| Cloud Storage       | < 1 GB stored                | ~$0.03          |
| Cloud Functions     | ~44K invocations (scheduler) | $0 (free tier)  |
| Secret Manager      | 5 versions, ~100K accesses   | $0 (free tier)  |
| Cloud Scheduler     | 1 job                        | $0 (free tier)  |
| Firebase Auth       | < 1,000 MAUs                 | $0 (free tier)  |
| Artifact Registry   | ~500 MB                      | $0 (free tier)  |
| Cloud Build         | ~10 builds/month             | $0 (free tier)  |
| **Total**           |                              | **~$2-6/month** |

### Estimated Monthly Cost (Medium Traffic)

Assuming ~10,000 MAUs, ~500K page views, active WhatsApp messaging:

| Service             | Estimated Usage              | Estimated Cost  |
|---------------------|------------------------------|-----------------|
| Cloud Run           | ~5M requests, ~1M vCPU-sec   | $20-40          |
| Firestore           | ~3M reads, ~500K writes/day  | $5-15           |
| Cloud Storage       | ~10 GB stored                | ~$0.25          |
| Cloud Functions     | ~2M invocations              | $0 (free tier)  |
| Secret Manager      | ~500K accesses               | ~$1.50          |
| Firebase Auth       | ~10,000 MAUs                 | $0 (free tier)  |
| Cloud Build         | ~30 builds/month             | $0 (free tier)  |
| **Total**           |                              | **~$30-60/month** |

### Cost Optimization Tips

- **Min instances = 0** avoids charges when idle (cold starts ~2-5s)
- **Max instances = 3** prevents runaway scaling
- Firestore free tier resets **daily**, not monthly
- Vector search indexes don't incur extra cost beyond normal read/write ops
- Monitor usage in [GCP Billing Console](https://console.cloud.google.com/billing)

---

## Prerequisites

1. **Google Cloud SDK** (`gcloud`) installed and authenticated
2. **Firebase CLI** (`firebase-tools`) installed globally
3. **Node.js 20+** with `pnpm` enabled
4. **Docker** (for building container images)
5. **GCP Project:** `vibesboard` with billing enabled

```bash
# Install tools
npm install -g firebase-tools
brew install --cask google-cloud-sdk   # macOS

# Authenticate
gcloud auth login
gcloud auth application-default login
gcloud auth application-default set-quota-project vibesboard
firebase login
```

---

## Deploy From Scratch

### Step 1: Set Up Infrastructure (one-time)

```bash
# Creates: APIs, Firestore DB, GCS bucket, service accounts, IAM roles
bash scripts/setup-firebase.sh
```

This enables 9 GCP APIs, creates the Firestore database in native mode, creates the GCS bucket with CORS, sets up service accounts and IAM bindings.

### Step 2: Create Secrets (one-time, or when secrets change)

Ensure `.env` has all required values, then:

```bash
# Creates/updates 5 secrets in Secret Manager from .env values
bash scripts/setup-secrets.sh
```

### Step 3: Deploy Cloud Functions

Cloud Functions are deployed via `gcloud` (not `firebase deploy`) due to a Firebase Extensions API limitation:

```bash
# Build functions
cd functions && npm install && npm run build && cd ..

# Deploy onUserCreated (gen1 auth trigger, us-central1)
gcloud functions deploy onUserCreated \
  --region=us-central1 \
  --runtime=nodejs20 \
  --trigger-event=providers/firebase.auth/eventTypes/user.create \
  --trigger-resource=vibesboard \
  --source=functions \
  --entry-point=onUserCreated \
  --memory=256MB \
  --timeout=60s \
  --env-vars-file=<(cat <<'EOF'
GCLOUD_PROJECT: vibesboard
FIREBASE_CONFIG: '{"projectId":"vibesboard","storageBucket":"vibesboard.firebasestorage.app"}'
EOF
)

# Deploy onFileCreated (gen2 Firestore trigger)
gcloud functions deploy onFileCreated \
  --gen2 \
  --region=europe-north1 \
  --runtime=nodejs20 \
  --trigger-event=google.cloud.firestore.document.v1.created \
  --trigger-filters="database=(default)" \
  --trigger-filters-path-pattern="document=tenants/{tenantId}/agents/{agentId}/files/{fileId}" \
  --source=functions \
  --entry-point=onFileCreated \
  --memory=256MB \
  --timeout=120s

# Deploy processWhatsAppQueue (gen2 HTTP, called by scheduler)
gcloud functions deploy processWhatsAppQueue \
  --gen2 \
  --region=europe-north1 \
  --runtime=nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --source=functions \
  --entry-point=processWhatsAppQueue \
  --memory=512MB \
  --timeout=300s

# Deploy onMessageStatusUpdate (gen2 Firestore trigger)
gcloud functions deploy onMessageStatusUpdate \
  --gen2 \
  --region=europe-north1 \
  --runtime=nodejs20 \
  --trigger-event=google.cloud.firestore.document.v1.updated \
  --trigger-filters="database=(default)" \
  --trigger-filters-path-pattern="document=tenants/{tenantId}/whatsapp_campaigns/{campaignId}/message_queue/{messageId}" \
  --source=functions \
  --entry-point=onMessageStatusUpdate \
  --memory=256MB \
  --timeout=60s
```

### Step 4: Create Cloud Scheduler Job

```bash
FUNCTION_URL=$(gcloud functions describe processWhatsAppQueue \
  --region=europe-north1 --gen2 --format="value(serviceConfig.uri)")

gcloud scheduler jobs create http process-whatsapp-queue \
  --location=europe-west1 \
  --schedule="* * * * *" \
  --uri="$FUNCTION_URL" \
  --http-method=POST \
  --oidc-service-account-email="vibesboard@appspot.gserviceaccount.com" \
  --oidc-token-audience="$FUNCTION_URL" \
  --time-zone="UTC"
```

### Step 5: Deploy Firestore Rules & Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes --force
```

Note: Indexes take 2-5 minutes to build. Check status:
```bash
gcloud firestore indexes composite list --database="(default)"
```

### Step 6: Deploy Cloud Run (the app)

```bash
bash deploy-cloud-run.sh
```

This builds the Docker image, pushes to GCR, and deploys to Cloud Run with secrets from Secret Manager.

### Step 7: Enable Firebase Auth

Go to [Firebase Console > Authentication](https://console.firebase.google.com/project/vibesboard/authentication/providers) and enable the **Google** sign-in provider. Add your domain to authorized domains if needed.

### Step 8: Verify

```bash
# Check service URL
gcloud run services describe vibeagent --region=europe-north1 --format="value(status.url)"

# Check health
curl -s https://vibeagent-319148717246.europe-north1.run.app/api/smoke

# Check secrets
gcloud secrets list --project=vibesboard

# Check indexes
gcloud firestore indexes composite list --database="(default)"

# Check function logs
gcloud functions logs read onUserCreated --region=us-central1 --limit=10
gcloud functions logs read onFileCreated --region=europe-north1 --limit=10

# Check Cloud Run logs
gcloud run services logs read vibeagent --region=europe-north1 --limit=20
```

---

## Deploying Code Changes

### App Code Changes (Next.js)

For any changes to the main Next.js application:

```bash
bash deploy-cloud-run.sh
```

This rebuilds the Docker image and deploys a new Cloud Run revision. Takes ~3-5 minutes. Zero-downtime deployment (traffic shifts to new revision automatically).

### Cloud Functions Changes

```bash
cd functions && npm install && npm run build && cd ..

# Redeploy the specific function that changed:
gcloud functions deploy <functionName> \
  --region=<region> \
  --source=functions \
  ... # (same flags as initial deploy)
```

### Firestore Rules or Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes --force
```

### Storage Rules

```bash
firebase deploy --only storage
```

### Secret Rotation

Update the value in `.env`, then:

```bash
bash scripts/setup-secrets.sh
```

Then redeploy Cloud Run to pick up the new secret version:

```bash
bash deploy-cloud-run.sh
```

### Deploy Everything

```bash
bash scripts/deploy-all.sh
```

Runs functions deploy, rules deploy, and Cloud Run deploy in sequence.

---

## Environment Variables

### Build-Time (baked into client JS bundles)

| Variable                                | Purpose                    |
|-----------------------------------------|----------------------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY`          | Firebase client SDK        |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`      | Firebase Auth domain       |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`       | Firebase project ID        |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`   | Firebase Storage bucket    |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Cloud Messaging |
| `NEXT_PUBLIC_FIREBASE_APP_ID`           | Firebase App ID            |
| `NEXT_PUBLIC_AUTH_GOOGLE`               | Enable Google sign-in      |
| `NEXT_PUBLIC_APP_URL`                   | App base URL               |

### Runtime (injected via Secret Manager or --set-env-vars)

| Variable                        | Source          | Purpose                      |
|---------------------------------|-----------------|------------------------------|
| `OPENAI_API_KEY`                | Secret Manager  | OpenAI API authentication    |
| `FIREBASE_SERVICE_ACCOUNT_KEY`  | Secret Manager  | Firebase Admin SDK (JSON)    |
| `WHATSAPP_ACCESS_TOKEN`         | Secret Manager  | WhatsApp Business API        |
| `VERIFY_TOKEN`                  | Secret Manager  | WhatsApp webhook verification|
| `ENCRYPTION_KEY`                | Secret Manager  | AES encryption for tokens    |
| `OPENAI_MODEL`                  | Env var         | Model name (default: gpt-4o-mini) |
| `GCS_BUCKET_NAME`              | Env var         | Storage bucket name          |
| `WHATSAPP_PHONE_NUMBER_ID`     | Env var         | WhatsApp phone number ID     |

### Local Development

Copy `.env` and set `NEXT_PUBLIC_APP_URL=http://localhost:3000`, then `pnpm dev`. The app connects to production Firestore, Storage, and Auth.

---

## Troubleshooting

### Build fails: "FIREBASE_SERVICE_ACCOUNT_KEY not set"

This is expected during Docker build. The admin SDK uses a no-op proxy at build time. If you see this as a warning (not error), the build is working correctly.

### "The query requires an index"

Firestore is missing a composite index. The error message includes a direct link to create it. Alternatively, add it to `firestore.indexes.json` and redeploy:

```bash
firebase deploy --only firestore:indexes --force
```

### "No document to update" on login

Race condition between `onUserCreated` Cloud Function and the app server. Fixed by using `set({merge: true})` in `ensurePersonalTenant`. If a user has an incomplete document, patch it manually via the Firestore Console.

### onUserCreated function crashes

Ensure `GCLOUD_PROJECT` and `FIREBASE_CONFIG` env vars are set on the function (required when deploying via `gcloud` instead of `firebase`).

### Cold starts

With `min-instances=0`, the first request after idle period takes 2-5 seconds. Set `--min-instances=1` in `deploy-cloud-run.sh` to keep one instance warm (increases cost).

### Viewing logs

```bash
# Cloud Run
gcloud run services logs read vibeagent --region=europe-north1 --limit=50

# Cloud Functions
gcloud functions logs read <functionName> --region=<region> --limit=20

# All logs (Cloud Console)
# https://console.cloud.google.com/logs?project=vibesboard
```
