// Tailwind wrapper config for /design-sync — reuses the app's real theme/tokens
// but scans the component sources AND the authored previews so the compiled
// stylesheet (apps/web/.ds-tw.css) contains every utility the bundle + cards use.
// Run Tailwind from the repo root so these content globs resolve correctly.
const base = require('../apps/web/tailwind.config.js')

module.exports = {
  ...base,
  content: [
    'apps/web/components/**/*.{ts,tsx}',
    'apps/web/app/**/*.{ts,tsx}',
    '.design-sync/previews/**/*.{ts,tsx}',
  ],
}
