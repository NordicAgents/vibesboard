const LOCAL_APP_URL = 'http://localhost:3000'

export function resolveAppUrl(value: string | undefined): URL {
  return new URL(value?.trim() || LOCAL_APP_URL)
}

/**
 * The canonical origin to build OAuth redirect URIs and outbound links from.
 * Prefers the configured NEXT_PUBLIC_APP_URL so a spoofed x-forwarded-host
 * cannot steer the redirect target; falls back to the request-derived origin
 * only when nothing is configured (dev/local).
 */
export function getCanonicalOrigin(fallback: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // fall through to the request-derived fallback
    }
  }
  return fallback
}
