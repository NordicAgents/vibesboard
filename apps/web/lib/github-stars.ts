import 'server-only'

import { GITHUB_SLUG } from './landing-links'

/**
 * Star count for the header badge.
 *
 * Cached for an hour: the unauthenticated GitHub API allows 60 requests per
 * hour per IP, and a marketing page must never be the reason a deploy starts
 * failing. Every failure path returns null and the caller renders a plain
 * "GitHub" button — a missing number is invisible, a thrown error is not.
 */
export async function getGitHubStars(): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_SLUG}`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(2_000),
        next: { revalidate: 3_600 }
      }
    )

    if (!response.ok) return null

    const data = (await response.json()) as { stargazers_count?: unknown }
    return typeof data.stargazers_count === 'number'
      ? data.stargazers_count
      : null
  } catch {
    return null
  }
}
