import * as auth from "firebase-functions/v1/auth";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

// Ensure admin SDK is initialised exactly once
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

// ─── Collection paths (mirrors main app's Collections helper) ────────

const Collections = {
  users: "users",
  tenants: "tenants",
  tenantSlugs: "tenant_slugs",
  branding: (tenantId: string) => `tenants/${tenantId}/branding`,
  members: (tenantId: string) => `tenants/${tenantId}/members`,
};

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert a string into a URL-safe slug.
 * Matches the slugify() helper in lib/utils.ts.
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Return a slug that is not yet claimed in the tenant_slugs collection.
 * Appends a numeric suffix (-2, -3, ...) when collisions are found.
 */
async function uniqueSlug(baseSlug: string): Promise<string> {
  let candidate = baseSlug;
  let attempt = 1;

   
  while (true) {
    const existing = await db
      .collection(Collections.tenantSlugs)
      .doc(candidate)
      .get();

    if (!existing.exists) {
      return candidate;
    }

    attempt++;
    candidate = `${baseSlug}-${attempt}`;
  }
}

// ─── Default branding values ─────────────────────────────────────────

const DEFAULT_BRANDING = {
  primaryColor: "#6366f1",
  secondaryColor: "#a5b4fc",
};

// ─── Cloud Function ──────────────────────────────────────────────────

/**
 * onUserCreated
 *
 * Fires whenever a new Firebase Auth user is created.
 * Creates the user document, a personal tenant, slug reservation,
 * default branding, and tenant membership — all in a single batch
 * write for atomicity.
 */
export const onUserCreated = auth.user().onCreate(async (user, _context) => {
  const uid = user.uid;
  const email = user.email ?? "";
  const name = user.displayName ?? "";
  const image = user.photoURL ?? "";
  const now = new Date().toISOString();

  // Check if user doc already exists (idempotency guard)
  const existingUser = await db.collection(Collections.users).doc(uid).get();
  if (existingUser.exists) {
    console.log(`User document already exists for ${uid}, skipping.`);
    return;
  }

  // Generate a unique slug for the personal workspace
  const rawSlug = slugify(name || email.split("@")[0] || uid.slice(0, 8));
  const slug = await uniqueSlug(rawSlug);

  // Allocate a new tenant document ID
  const tenantRef = db.collection(Collections.tenants).doc();
  const tenantId = tenantRef.id;

  // Build all writes in a single batch for atomicity
  const batch = db.batch();

  // 1. User document  /users/{uid}
  batch.set(db.collection(Collections.users).doc(uid), {
    id: uid,
    email,
    name,
    image,
    isSuperAdmin: false,
    tenantIds: [tenantId],
    createdAt: now,
    updatedAt: now,
  });

  // 2. Tenant document  /tenants/{tenantId}
  const workspaceName = name ? `${name}'s Workspace` : "My Workspace";
  batch.set(tenantRef, {
    id: tenantId,
    name: workspaceName,
    slug,
    status: "active",
    createdBy: uid,
    isPersonal: true,
    createdAt: now,
    updatedAt: now,
  });

  // 3. Slug reservation  /tenant_slugs/{slug}
  batch.set(db.collection(Collections.tenantSlugs).doc(slug), {
    tenantId,
    createdAt: now,
  });

  // 4. Default branding  /tenants/{tenantId}/branding/{tenantId}
  //    overrides: [] means fully inherited from platform base branding
  batch.set(
    db.collection(Collections.branding(tenantId)).doc(tenantId),
    {
      tenantId,
      primaryColor: DEFAULT_BRANDING.primaryColor,
      secondaryColor: DEFAULT_BRANDING.secondaryColor,
      overrides: [],
      createdAt: now,
      updatedAt: now,
    }
  );

  // 5. Membership  /tenants/{tenantId}/members/{uid}
  batch.set(
    db.collection(Collections.members(tenantId)).doc(uid),
    {
      userId: uid,
      tenantId,
      role: "TENANT_ADMIN",
      createdAt: now,
    }
  );

  await batch.commit();

  console.log(
    `Created user ${uid}, personal tenant ${tenantId} (slug: ${slug})`
  );
});
