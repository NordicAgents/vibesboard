/**
 * 1234 → "1.2k". Below a thousand the exact number is more credible than a
 * rounded one, so it is printed verbatim.
 *
 * Lives apart from `github-stars.ts` because that module is server-only and
 * this is pure formatting the tests can exercise directly.
 */
export function formatStarCount(stars: number): string {
  if (!Number.isFinite(stars) || stars < 0) return '0'
  if (stars < 1_000) return String(Math.floor(stars))

  const thousands = stars / 1_000
  const rounded = thousands.toFixed(thousands < 10 ? 1 : 0)
  return `${rounded.replace(/\.0$/, '')}k`
}
